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
            # Estimate line number from chunk content position in original file
            line_start = _estimate_line_number(r.file_path, r.content)
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


def _estimate_line_number(file_path: str, chunk_content: str) -> int:
    """Estimate the line number where a chunk starts in the original file."""
    if not _notes_dir:
        return 1
    abs_path = os.path.join(_notes_dir, file_path)
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            full_text = f.read()
        # Find the chunk's first 80 chars in the full text
        snippet = chunk_content[:80]
        pos = full_text.find(snippet)
        if pos == -1:
            return 1
        return full_text[:pos].count("\n") + 1
    except OSError:
        return 1


def run(store: SearchStore, notes_dir: str, host: str = "127.0.0.1", port: int = 9120):
    """Run the Flask server."""
    app = create_app(store, notes_dir)
    log.info("Starting server on %s:%d", host, port)
    app.run(host=host, port=port, debug=False)
