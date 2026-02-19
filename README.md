# notesearch

Local hybrid search for your notes — powered by SQLite.

## Architecture

```
┌─────────────────┐     HTTP/JSON      ┌──────────────────────┐
│  Cursor/VSCode  │ ◄────────────────► │   Python Backend     │
│   Extension     │                    │                      │
│  (QuickPick UI) │                    │  ┌────────────────┐  │
└─────────────────┘                    │  │  SearchStore    │  │
                                       │  │  SQLite + FTS5  │  │
                                       │  │  + sqlite-vec   │  │
                                       │  └────────────────┘  │
                                       │                      │
                                       │  ┌────────────────┐  │
                                       │  │  FileMonitor    │  │
                                       │  │  watchdog +     │  │
                                       │  │  debounce       │  │
                                       │  └────────────────┘  │
                                       │                      │
                                       │  ┌────────────────┐  │
                                       │  │  Indexer        │  │
                                       │  │  chunk + embed  │  │
                                       │  └────────────────┘  │
                                       └──────────────────────┘
```

## Search

Hybrid search combining two strategies via Reciprocal Rank Fusion (RRF):

- **Trigram FTS5** — substring matching (e.g., "inter" → "interesting", "internal", "winter")
- **Vector search** — semantic similarity via Gemini embeddings + sqlite-vec

## Chunking

OpenClaw-style: ~400 tokens per chunk, 80-token overlap, paragraph-boundary-aware.

## Stack

| Component | Technology |
|-----------|-----------|
| Storage | SQLite |
| Keyword search | FTS5 (trigram tokenizer) |
| Vector search | sqlite-vec |
| Embeddings | Gemini embedding-001 (768-dim) |
| File monitoring | watchdog + debounce |
| Frontend | VS Code / Cursor extension (QuickPick) |
| Backend server | Flask |
