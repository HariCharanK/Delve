# Delve

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

## Setup

### 1. Gemini API key

Delve uses Gemini embeddings for semantic search. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey) and export it:

```bash
export GOOGLE_API_KEY="your-key-here"
```

(Also accepts `GEMINI_API_KEY`. Add to your shell profile to persist.)

### 2. Start the backend

```bash
cd backend
pip install -e .
delve watch ~/notes    # full index on first run + file watcher + HTTP server on :9120
```

### 3. Install the Cursor extension

```bash
cd extension
npm install && node esbuild.js && vsce package --no-dependencies
# In Cursor: Cmd+Shift+P → "Install from VSIX" → pick delve-0.1.0.vsix
```

### 4. Search! (`Cmd+Shift+N`)
