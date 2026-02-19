import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchChunk {
  file_path: string;
  content: string;
  chunk_index: number;
  line_start: number;
  score: number;
}

interface SearchResponse {
  query: string;
  results: SearchChunk[];
}

interface SearchQuickPickItem extends vscode.QuickPickItem {
  filePath: string;
  lineStart: number;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function getServerUrl(): string {
  return vscode.workspace
    .getConfiguration("notesearch")
    .get<string>("serverUrl", "http://127.0.0.1:9120");
}

/** Simple POST helper that works with Node's built-in http/https modules. */
function post(url: string, body: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const data = JSON.stringify(body);
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString()));
        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

/** Truncate a content snippet to roughly `max` characters on a word boundary. */
function truncateSnippet(text: string, max = 120): string {
  const oneLine = text.replace(/\n+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return oneLine.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * Group flat search results by file and build QuickPick items.
 *
 * Layout mirrors VS Code's native search panel:
 *   ▸ Separator per file (with match count badge)
 *   ▸ One item per chunk showing a content snippet
 */
function buildQuickPickItems(
  results: SearchChunk[],
  notesDir: string,
): SearchQuickPickItem[] {
  // Group by file path, preserving first-seen order.
  const grouped = new Map<string, SearchChunk[]>();
  for (const r of results) {
    const existing = grouped.get(r.file_path);
    if (existing) {
      existing.push(r);
    } else {
      grouped.set(r.file_path, [r]);
    }
  }

  const items: SearchQuickPickItem[] = [];

  for (const [filePath, chunks] of grouped) {
    const basename = path.basename(filePath);
    const relPath = filePath.startsWith(notesDir)
      ? filePath.slice(notesDir.length).replace(/^\//, "")
      : filePath;

    // Separator line for the file.
    items.push({
      label: `$(file) ${basename}`,
      description: relPath,
      detail: `${chunks.length} match${chunks.length > 1 ? "es" : ""}`,
      kind: vscode.QuickPickItemKind.Separator,
      filePath,
      lineStart: chunks[0].line_start,
    });

    // One item per matching chunk.
    for (const chunk of chunks) {
      const snippet = truncateSnippet(chunk.content);
      items.push({
        label: `    $(search) ${snippet}`,
        description: `L${chunk.line_start}`,
        detail: "",
        filePath: chunk.file_path,
        lineStart: chunk.line_start,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Debounce utility
// ---------------------------------------------------------------------------

function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function searchCommand(): Promise<void> {
  const serverUrl = getServerUrl();
  const notesDir: string = vscode.workspace
    .getConfiguration("notesearch")
    .get<string>("notesDir", "~/notes")
    .replace(/^~/, process.env.HOME ?? "~");

  const qp = vscode.window.createQuickPick<SearchQuickPickItem>();
  qp.placeholder = "Search your notes...";
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.busy = false;

  // Track the latest request so we can discard stale responses.
  let requestSeq = 0;

  const doSearch = debounce(async (...args: unknown[]) => {
    const query = args[0] as string;
    if (!query || query.trim().length === 0) {
      qp.items = [];
      qp.busy = false;
      return;
    }

    const seq = ++requestSeq;
    qp.busy = true;

    try {
      const raw = await post(`${serverUrl}/search`, { query, top_k: 20 });
      // Discard if a newer query has been issued.
      if (seq !== requestSeq) {
        return;
      }

      const data: SearchResponse = JSON.parse(raw);
      qp.items = buildQuickPickItems(data.results ?? [], notesDir);
    } catch (err: unknown) {
      if (seq !== requestSeq) {
        return;
      }
      const msg =
        err instanceof Error ? err.message : String(err);
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("ECONNRESET") ||
        msg.includes("timed out")
      ) {
        qp.items = [
          {
            label: "$(warning) NoteSearch server is not running",
            description: "Start notesearch server first",
            detail: serverUrl,
            filePath: "",
            lineStart: 0,
          },
        ];
      } else {
        qp.items = [
          {
            label: `$(error) Search failed: ${msg}`,
            description: "",
            detail: "",
            filePath: "",
            lineStart: 0,
          },
        ];
      }
    } finally {
      if (seq === requestSeq) {
        qp.busy = false;
      }
    }
  }, 300);

  qp.onDidChangeValue((value) => {
    doSearch(value);
  });

  qp.onDidAccept(async () => {
    const selected = qp.selectedItems[0];
    if (!selected || !selected.filePath) {
      return;
    }

    qp.hide();

    try {
      const uri = vscode.Uri.file(selected.filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);

      // Reveal the relevant line.
      const line = Math.max(0, selected.lineStart - 1);
      const range = new vscode.Range(line, 0, line, 0);
      editor.selection = new vscode.Selection(range.start, range.start);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch {
      vscode.window.showErrorMessage(
        `Could not open file: ${selected.filePath}`,
      );
    }
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function reindexCommand(): Promise<void> {
  const serverUrl = getServerUrl();

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "NoteSearch: Reindexing notes…",
        cancellable: false,
      },
      async () => {
        await post(`${serverUrl}/reindex`, {});
      },
    );
    vscode.window.showInformationMessage("NoteSearch: Reindex complete.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED")) {
      vscode.window.showErrorMessage(
        "NoteSearch: Server is not running. Start notesearch server first.",
      );
    } else {
      vscode.window.showErrorMessage(`NoteSearch: Reindex failed — ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("notesearch.search", searchCommand),
    vscode.commands.registerCommand("notesearch.reindex", reindexCommand),
  );

  // Status bar item.
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.text = "$(search) NoteSearch";
  statusBar.command = "notesearch.search";
  statusBar.tooltip = "Search your notes";
  statusBar.show();
  context.subscriptions.push(statusBar);
}

export function deactivate(): void {
  // Nothing to clean up.
}
