"""File monitor with watchdog and per-file debouncing."""

import logging
import os
import threading
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

from . import indexer
from .store import SearchStore

log = logging.getLogger(__name__)

DEFAULT_EXTENSIONS = {".md", ".txt", ".org", ".rst"}
DEBOUNCE_SECONDS = 2.0


class _DebouncedHandler(FileSystemEventHandler):
    """Handles filesystem events with per-file debouncing."""

    def __init__(
        self,
        store: SearchStore,
        notes_dir: str,
        extensions: set[str] | None = None,
    ):
        super().__init__()
        self.store = store
        self.notes_dir = os.path.abspath(notes_dir)
        self.extensions = extensions or DEFAULT_EXTENSIONS
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.Lock()

    def _should_handle(self, path: str) -> bool:
        ext = os.path.splitext(path)[1].lower()
        return ext in self.extensions

    def _debounce(self, file_path: str, action: str):
        """Schedule a debounced action for a file path."""
        with self._lock:
            # Cancel any existing timer for this file
            if file_path in self._timers:
                self._timers[file_path].cancel()

            def _fire():
                with self._lock:
                    self._timers.pop(file_path, None)
                self._handle_action(file_path, action)

            timer = threading.Timer(DEBOUNCE_SECONDS, _fire)
            self._timers[file_path] = timer
            timer.start()

    def _handle_action(self, file_path: str, action: str):
        """Execute the actual indexing/deletion action."""
        rel_path = os.path.relpath(file_path, self.notes_dir)
        try:
            if action == "delete":
                log.info("File deleted, removing from index: %s", rel_path)
                self.store.delete_file(rel_path)
            else:
                log.info("File changed, re-indexing: %s", rel_path)
                indexer.index_file(self.store, rel_path, self.notes_dir)
        except Exception:
            log.exception("Error handling %s for %s", action, rel_path)

    def on_created(self, event: FileSystemEvent):
        if event.is_directory or not self._should_handle(event.src_path):
            return
        self._debounce(event.src_path, "index")

    def on_modified(self, event: FileSystemEvent):
        if event.is_directory or not self._should_handle(event.src_path):
            return
        self._debounce(event.src_path, "index")

    def on_deleted(self, event: FileSystemEvent):
        if event.is_directory or not self._should_handle(event.src_path):
            return
        self._debounce(event.src_path, "delete")

    def on_moved(self, event: FileSystemEvent):
        if event.is_directory:
            return
        # Treat old path as deleted, new path as created
        if self._should_handle(event.src_path):
            self._debounce(event.src_path, "delete")
        if self._should_handle(event.dest_path):
            self._debounce(event.dest_path, "index")

    def cancel_all(self):
        """Cancel all pending timers."""
        with self._lock:
            for timer in self._timers.values():
                timer.cancel()
            self._timers.clear()


class FileMonitor:
    """Watches a directory for file changes and re-indexes automatically."""

    def __init__(
        self,
        store: SearchStore,
        notes_dir: str,
        extensions: set[str] | None = None,
    ):
        self.store = store
        self.notes_dir = os.path.abspath(notes_dir)
        self.extensions = extensions or DEFAULT_EXTENSIONS
        self._handler = _DebouncedHandler(store, notes_dir, self.extensions)
        self._observer = Observer()

    def start(self):
        """Start watching the directory (non-blocking)."""
        self._observer.schedule(self._handler, self.notes_dir, recursive=True)
        self._observer.start()
        log.info("File monitor started for %s", self.notes_dir)

    def stop(self):
        """Stop the file monitor."""
        self._handler.cancel_all()
        self._observer.stop()
        self._observer.join()
        log.info("File monitor stopped")
