"""SQLite search store with FTS5 trigram + sqlite-vec hybrid search."""

import json
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path

import sqlite_vec


@dataclass
class SearchResult:
    file_path: str
    chunk_index: int
    content: str
    score: float


class SearchStore:
    """SQLite-backed store with FTS5 trigram and vec0 vector search."""

    EMBEDDING_DIM = 3072

    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self._lock = threading.Lock()
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self._load_extensions()
        self._setup_pragmas()
        self._create_schema()

    def _load_extensions(self):
        self.db.enable_load_extension(True)
        sqlite_vec.load(self.db)
        self.db.enable_load_extension(False)

    def _setup_pragmas(self):
        self.db.executescript("""
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA cache_size = -64000;
            PRAGMA mmap_size = 268435456;
            PRAGMA temp_store = MEMORY;
            PRAGMA busy_timeout = 5000;
        """)

    def _create_schema(self):
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS chunks (
                rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                file_mtime REAL NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chunks_file_path
                ON chunks(file_path);
        """)

        # FTS5 with trigram tokenizer, content-synced to chunks table
        self.db.executescript("""
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                content,
                content='chunks',
                content_rowid='rowid',
                tokenize='trigram'
            );
        """)

        # sqlite-vec vec0 virtual table for vector search
        self.db.execute(f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
                rowid INTEGER PRIMARY KEY,
                embedding float[{self.EMBEDDING_DIM}]
            );
        """)

        # Triggers to keep FTS5 in sync with chunks table
        self.db.executescript("""
            CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
                INSERT INTO chunks_fts(rowid, content)
                VALUES (new.rowid, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
                INSERT INTO chunks_fts(chunks_fts, rowid, content)
                VALUES ('delete', old.rowid, old.content);
            END;

            CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
                INSERT INTO chunks_fts(chunks_fts, rowid, content)
                VALUES ('delete', old.rowid, old.content);
                INSERT INTO chunks_fts(rowid, content)
                VALUES (new.rowid, new.content);
            END;
        """)

        self.db.commit()

    def upsert_file(
        self,
        file_path: str,
        chunks: list[str],
        embeddings: list[list[float]],
        mtime: float,
    ):
        """Insert or replace all chunks for a file."""
        with self._lock:
            self.delete_file(file_path, _already_locked=True)

            for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
                cursor = self.db.execute(
                    "INSERT INTO chunks (file_path, chunk_index, content, file_mtime) "
                    "VALUES (?, ?, ?, ?)",
                    (file_path, i, chunk, mtime),
                )
                rowid = cursor.lastrowid
                self.db.execute(
                    "INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)",
                    (rowid, json.dumps(emb)),
                )

            self.db.commit()

    def delete_file(self, file_path: str, *, _already_locked: bool = False):
        """Delete all chunks for a file (triggers keep FTS5 in sync)."""
        if _already_locked:
            self._delete_file_impl(file_path)
        else:
            with self._lock:
                self._delete_file_impl(file_path)

    def _delete_file_impl(self, file_path: str):
        """Internal delete implementation (caller must hold self._lock)."""
        rowids = self.db.execute(
            "SELECT rowid FROM chunks WHERE file_path = ?", (file_path,)
        ).fetchall()
        for row in rowids:
            self.db.execute(
                "DELETE FROM chunks_vec WHERE rowid = ?", (row["rowid"],)
            )

        self.db.execute("DELETE FROM chunks WHERE file_path = ?", (file_path,))
        self.db.commit()

    def get_file_mtime(self, file_path: str) -> float | None:
        """Get stored mtime for a file, or None if not indexed."""
        row = self.db.execute(
            "SELECT file_mtime FROM chunks WHERE file_path = ? LIMIT 1",
            (file_path,),
        ).fetchone()
        return row["file_mtime"] if row else None

    def search(
        self,
        query_text: str,
        query_embedding: list[float],
        top_k: int = 10,
    ) -> list[SearchResult]:
        """Hybrid search: FTS5 trigram + vec0, merged via RRF."""
        k = 60  # RRF constant

        # --- FTS5 trigram search ---
        fts_results = self.db.execute(
            """
            SELECT c.rowid, c.file_path, c.chunk_index, c.content,
                   rank AS fts_rank
            FROM chunks_fts
            JOIN chunks c ON c.rowid = chunks_fts.rowid
            WHERE chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            ('"' + query_text.replace('"', '""') + '"', top_k * 5),
        ).fetchall()

        # --- Vector search ---
        vec_results = self.db.execute(
            """
            SELECT v.rowid, c.file_path, c.chunk_index, c.content,
                   v.distance AS vec_distance
            FROM chunks_vec v
            JOIN chunks c ON c.rowid = v.rowid
            WHERE v.embedding MATCH ?
                AND k = ?
            ORDER BY v.distance
            """,
            (json.dumps(query_embedding), top_k * 5),
        ).fetchall()

        # --- RRF merge ---
        # Build per-rowid scores
        scores: dict[int, float] = {}
        meta: dict[int, dict] = {}

        for rank_pos, row in enumerate(fts_results):
            rid = row["rowid"]
            scores[rid] = scores.get(rid, 0) + 0.3 * (1.0 / (k + rank_pos + 1))
            meta[rid] = {
                "file_path": row["file_path"],
                "chunk_index": row["chunk_index"],
                "content": row["content"],
            }

        for rank_pos, row in enumerate(vec_results):
            rid = row["rowid"]
            scores[rid] = scores.get(rid, 0) + 0.7 * (1.0 / (k + rank_pos + 1))
            meta[rid] = {
                "file_path": row["file_path"],
                "chunk_index": row["chunk_index"],
                "content": row["content"],
            }

        # Sort by RRF score descending
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

        return [
            SearchResult(
                file_path=meta[rid]["file_path"],
                chunk_index=meta[rid]["chunk_index"],
                content=meta[rid]["content"],
                score=round(score, 6),
            )
            for rid, score in ranked
        ]

    def file_count(self) -> int:
        row = self.db.execute(
            "SELECT COUNT(DISTINCT file_path) AS cnt FROM chunks"
        ).fetchone()
        return row["cnt"]

    def chunk_count(self) -> int:
        row = self.db.execute("SELECT COUNT(*) AS cnt FROM chunks").fetchone()
        return row["cnt"]

    def all_file_paths(self) -> list[str]:
        rows = self.db.execute(
            "SELECT DISTINCT file_path FROM chunks"
        ).fetchall()
        return [r["file_path"] for r in rows]

    def close(self):
        self.db.close()
