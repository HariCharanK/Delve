"""Flask HTTP server for note search."""

import logging
import os
import time

from flask import Flask, jsonify, request

from . import indexer
from .store import SearchStore

log = logging.getLogger(__name__)

# Module-level state set by `create_app` or `run`
_store: SearchStore | None = None
_notes_dir: str | None = None
_last_indexed: float | None = None


def create_app(store: SearchStore, notes_dir: str) -> Flask:
    """Create and configure the Flask app."""
    global _store, _notes_dir
    _store = store
    _notes_dir = os.path.abspath(notes_dir)

    app = Flask(__name__)

    @app.route("/search", methods=["POST"])
    def search():
        data = request.get_json(force=True)
        query = data.get("query", "").strip()
        top_k = data.get("top_k", 10)

        if not query:
            return jsonify({"error": "query is required"}), 400

        # Embed query with RETRIEVAL_QUERY task type
        query_embedding = indexer.embed_chunks([query], task_type="RETRIEVAL_QUERY")[0]

        results = _store.search(query, query_embedding, top_k=top_k)

        response = []
        for r in results:
            # chunk_index is the 0-based index among non-empty lines;
            # use it to find the exact file line number (handles duplicates).
            line_start = _find_line_number(r.file_path, r.chunk_index)
            # Extension needs absolute paths for vscode.Uri.file()
            abs_path = os.path.join(_notes_dir, r.file_path)
            response.append({
                "file_path": abs_path,
                "chunk_index": r.chunk_index,
                "content": r.content,
                "score": r.score,
                "line_start": line_start,
            })

        return jsonify({"query": query, "results": response})

    @app.route("/status", methods=["GET"])
    def status():
        return jsonify({
            "file_count": _store.file_count(),
            "chunk_count": _store.chunk_count(),
            "last_indexed": _last_indexed,
            "notes_dir": _notes_dir,
        })

    @app.route("/reindex", methods=["POST"])
    def reindex():
        global _last_indexed
        count = indexer.index_directory(_store, _notes_dir)
        removed = indexer.remove_stale(_store, _notes_dir)
        _last_indexed = time.time()
        return jsonify({
            "indexed": count,
            "removed": removed,
            "file_count": _store.file_count(),
            "chunk_count": _store.chunk_count(),
        })

    return app


def _find_line_number(file_path: str, chunk_index: int) -> int:
    """Return the 1-based file line number for the chunk_index-th non-empty line.

    chunk_index is 0-based and counts only non-empty lines (matching how
    chunker.py builds chunks). This is more reliable than searching by
    content, which breaks when duplicate lines exist.
    """
    if not _notes_dir:
        return 1
    abs_path = os.path.join(_notes_dir, file_path)
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            nonempty = 0
            for file_line, text in enumerate(f, 1):
                if text.strip():
                    if nonempty == chunk_index:
                        return file_line
                    nonempty += 1
        return 1
    except OSError:
        return 1


def run(store: SearchStore, notes_dir: str, host: str = "127.0.0.1", port: int = 9120):
    """Run the Flask server."""
    app = create_app(store, notes_dir)
    log.info("Starting server on %s:%d", host, port)
    app.run(host=host, port=port, debug=False)
