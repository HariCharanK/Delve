"""CLI entrypoint for notesearch."""

import argparse
import logging
import signal
import sys
import time

from . import indexer
from .monitor import FileMonitor
from .server import run as run_server
from .store import SearchStore

log = logging.getLogger("notesearch")

DEFAULT_DB = "notesearch.db"


def cmd_watch(args):
    """Start file monitor + initial index + HTTP server."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    store = SearchStore(args.db)
    notes_dir = args.directory

    # Initial index
    log.info("Running initial index of %s ...", notes_dir)
    count = indexer.index_directory(store, notes_dir)
    removed = indexer.remove_stale(store, notes_dir)
    log.info("Initial index: %d files indexed, %d stale removed", count, removed)

    # Start file monitor
    monitor = FileMonitor(store, notes_dir)
    monitor.start()

    # Handle graceful shutdown
    def _shutdown(signum, frame):
        log.info("Shutting down...")
        monitor.stop()
        store.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Start HTTP server (blocks)
    log.info("Starting HTTP server on 127.0.0.1:%d", args.port)
    run_server(store, notes_dir, port=args.port)


def cmd_reindex(args):
    """Full re-index of a directory."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    store = SearchStore(args.db)
    notes_dir = args.directory

    count = indexer.index_directory(store, notes_dir)
    removed = indexer.remove_stale(store, notes_dir)
    log.info("Re-index complete: %d files indexed, %d stale removed", count, removed)
    log.info("Total: %d files, %d chunks", store.file_count(), store.chunk_count())
    store.close()


def cmd_search(args):
    """One-shot search from command line."""
    logging.basicConfig(level=logging.WARNING)

    store = SearchStore(args.db)
    query = " ".join(args.query)

    if not query.strip():
        print("Error: empty query", file=sys.stderr)
        sys.exit(1)

    # Embed query
    query_embedding = indexer.embed_chunks([query], task_type="RETRIEVAL_QUERY")[0]

    results = store.search(query, query_embedding, top_k=args.top_k)

    if not results:
        print("No results found.")
    else:
        for i, r in enumerate(results, 1):
            print(f"\n{'='*60}")
            print(f"[{i}] {r.file_path} (chunk {r.chunk_index}, score: {r.score:.4f})")
            print(f"{'='*60}")
            # Show first 300 chars of content
            preview = r.content[:300]
            if len(r.content) > 300:
                preview += "..."
            print(preview)

    store.close()


def main():
    parser = argparse.ArgumentParser(
        prog="notesearch",
        description="Local hybrid search for notes files",
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB,
        help="Path to SQLite database (default: notesearch.db)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # watch
    p_watch = subparsers.add_parser("watch", help="Start monitor + server")
    p_watch.add_argument("directory", help="Notes directory to watch")
    p_watch.add_argument("--port", type=int, default=9120, help="HTTP port (default: 9120)")
    p_watch.set_defaults(func=cmd_watch)

    # reindex
    p_reindex = subparsers.add_parser("reindex", help="Full re-index")
    p_reindex.add_argument("directory", help="Notes directory to index")
    p_reindex.set_defaults(func=cmd_reindex)

    # search
    p_search = subparsers.add_parser("search", help="One-shot search")
    p_search.add_argument("query", nargs="+", help="Search query")
    p_search.add_argument("--top-k", type=int, default=10, help="Number of results")
    p_search.set_defaults(func=cmd_search)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
