"""Indexing pipeline: read files, chunk, embed, store."""

import logging
import os
from pathlib import Path

from google import genai
from google.genai.types import EmbedContentConfig

from .chunker import chunk_text
from .store import SearchStore

log = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".md", ".txt", ".org", ".rst"}

# Gemini embedding client (module-level singleton)
_genai_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _genai_client
    if _genai_client is None:
        _genai_client = genai.Client()
    return _genai_client


def embed_chunks(chunks: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Embed a list of text chunks using Gemini embedding model."""
    if not chunks:
        return []

    client = _get_client()
    config = EmbedContentConfig(task_type=task_type)
    response = client.models.embed_content(
        model="gemini-embedding-001",
        contents=chunks,
        config=config,
    )
    return [list(e.values) for e in response.embeddings]


def index_file(store: SearchStore, file_path: str, notes_dir: str) -> bool:
    """Index a single file. Returns True if file was indexed, False if skipped."""
    abs_path = os.path.join(notes_dir, file_path) if not os.path.isabs(file_path) else file_path
    rel_path = os.path.relpath(abs_path, notes_dir)

    if not os.path.isfile(abs_path):
        log.warning("File not found: %s", abs_path)
        return False

    # Check if file extension is supported
    ext = os.path.splitext(abs_path)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return False

    # Skip unchanged files
    mtime = os.path.getmtime(abs_path)
    stored_mtime = store.get_file_mtime(rel_path)
    if stored_mtime is not None and stored_mtime >= mtime:
        log.debug("Skipping unchanged file: %s", rel_path)
        return False

    # Read and chunk
    try:
        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except OSError as e:
        log.error("Failed to read %s: %s", abs_path, e)
        return False

    chunks = chunk_text(text)
    if not chunks:
        log.debug("No chunks produced for %s", rel_path)
        return False

    # Embed
    log.info("Embedding %d chunks from %s", len(chunks), rel_path)
    embeddings = embed_chunks(chunks, task_type="RETRIEVAL_DOCUMENT")

    # Store
    store.upsert_file(rel_path, chunks, embeddings, mtime)
    log.info("Indexed %s (%d chunks)", rel_path, len(chunks))
    return True


def index_directory(store: SearchStore, notes_dir: str) -> int:
    """Walk directory and index all supported files. Returns count of newly indexed files."""
    notes_dir = os.path.abspath(notes_dir)
    indexed = 0

    for root, _dirs, files in os.walk(notes_dir):
        for fname in sorted(files):
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SUPPORTED_EXTENSIONS:
                continue
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, notes_dir)
            if index_file(store, rel_path, notes_dir):
                indexed += 1

    return indexed


def remove_stale(store: SearchStore, notes_dir: str) -> int:
    """Remove chunks for files that no longer exist on disk. Returns count removed."""
    notes_dir = os.path.abspath(notes_dir)
    removed = 0

    for file_path in store.all_file_paths():
        abs_path = os.path.join(notes_dir, file_path)
        if not os.path.isfile(abs_path):
            log.info("Removing stale file from index: %s", file_path)
            store.delete_file(file_path)
            removed += 1

    return removed
