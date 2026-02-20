import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { SearchInputProvider } from "./searchInputProvider";
import {
  SearchResultsProvider,
  type SearchChunk,
} from "./searchResultsProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
    .getConfiguration("delve")
    .get<string>("serverUrl", "http://127.0.0.1:9120");
}

function getNotesDir(): string {
  return vscode.workspace
    .getConfiguration("delve")
    .get<string>("notesDir", "~/notes")
    .replace(/^~/, process.env.HOME ?? "~");
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
// Result formatting (QuickPick)
// ---------------------------------------------------------------------------

function truncateSnippet(text: string, max = 120): string {
  const oneLine = text.replace(/\n+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return oneLine.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

function buildQuickPickItems(
  results: SearchChunk[],
  notesDir: string,
): SearchQuickPickItem[] {
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

    items.push({
      label: `$(file) ${basename}`,
      description: relPath,
      detail: `${chunks.length} match${chunks.length > 1 ? "es" : ""}`,
      kind: vscode.QuickPickItemKind.Separator,
      filePath,
      lineStart: chunks[0].line_start,
    });

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
// Open-match helper (used by both QuickPick and TreeView)
// ---------------------------------------------------------------------------

async function openFileAtLine(
  filePath: string,
  lineStart: number,
): Promise<void> {
  try {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);

    const line = Math.max(0, lineStart - 1);
    const range = new vscode.Range(line, 0, line, 0);
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  } catch {
    vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// QuickPick search command (preserved as alternative)
// ---------------------------------------------------------------------------

async function searchCommand(): Promise<void> {
  const serverUrl = getServerUrl();
  const notesDir = getNotesDir();

  const qp = vscode.window.createQuickPick<SearchQuickPickItem>();
  qp.placeholder = "Search your notes...";
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.busy = false;

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
      if (seq !== requestSeq) {
        return;
      }

      const data: SearchResponse = JSON.parse(raw);
      qp.items = buildQuickPickItems(data.results ?? [], notesDir);
    } catch (err: unknown) {
      if (seq !== requestSeq) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("ECONNRESET") ||
        msg.includes("timed out")
      ) {
        qp.items = [
          {
            label: "$(warning) Delve server is not running",
            description: "Start delve server first",
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
    await openFileAtLine(selected.filePath, selected.lineStart);
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

// ---------------------------------------------------------------------------
// Reindex command
// ---------------------------------------------------------------------------

async function reindexCommand(): Promise<void> {
  const serverUrl = getServerUrl();

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Delve: Reindexing notes…",
        cancellable: false,
      },
      async () => {
        await post(`${serverUrl}/reindex`, {});
      },
    );
    vscode.window.showInformationMessage("Delve: Reindex complete.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ECONNREFUSED")) {
      vscode.window.showErrorMessage(
        "Delve: Server is not running. Start delve server first.",
      );
    } else {
      vscode.window.showErrorMessage(`Delve: Reindex failed — ${msg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Sidebar search (WebView input + TreeView results)
// ---------------------------------------------------------------------------

function setupSidebarSearch(
  _context: vscode.ExtensionContext,
  searchInput: SearchInputProvider,
  searchResults: SearchResultsProvider,
): void {
  let requestSeq = 0;

  searchInput.onDidSearch(async (query: string) => {
    const serverUrl = getServerUrl();
    const notesDir = getNotesDir();

    if (!query || query.trim().length === 0) {
      searchResults.clear();
      return;
    }

    const seq = ++requestSeq;

    try {
      const raw = await post(`${serverUrl}/search`, { query, top_k: 20 });
      if (seq !== requestSeq) {
        return;
      }

      const data: SearchResponse = JSON.parse(raw);
      searchResults.update(data.results ?? [], notesDir);
    } catch (err: unknown) {
      if (seq !== requestSeq) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("ECONNREFUSED") ||
        msg.includes("ECONNRESET") ||
        msg.includes("timed out")
      ) {
        searchResults.showMessage(
          "⚠ Delve server is not running. Start the server first.",
        );
      } else {
        searchResults.showMessage(`✕ Search failed: ${msg}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext): void {
  // -- Sidebar providers ----------------------------------------------------
  const searchInput = new SearchInputProvider();
  const searchResults = new SearchResultsProvider();

  // Register the WebView for the search input box
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SearchInputProvider.viewId,
      searchInput,
    ),
  );

  // Register the TreeView for search results
  const resultsTreeView = vscode.window.createTreeView("delve.results", {
    treeDataProvider: searchResults,
    showCollapseAll: true,
  });
  searchResults.setTreeView(resultsTreeView);
  context.subscriptions.push(resultsTreeView);

  // Wire up the sidebar search
  setupSidebarSearch(context, searchInput, searchResults);

  // -- Commands -------------------------------------------------------------
  context.subscriptions.push(
    // QuickPick search (Cmd+Shift+N still works)
    vscode.commands.registerCommand("delve.search", searchCommand),

    // Reindex
    vscode.commands.registerCommand("delve.reindex", reindexCommand),

    // Open a match from TreeView click
    vscode.commands.registerCommand(
      "delve.openMatch",
      (filePath: string, lineStart: number) =>
        openFileAtLine(filePath, lineStart),
    ),

    // Focus the sidebar search input (also reveals the sidebar)
    vscode.commands.registerCommand("delve.focusSearch", async () => {
      await vscode.commands.executeCommand(
        "workbench.view.extension.delve",
      );
      searchInput.focus();
    }),
  );

  // -- Status bar item ------------------------------------------------------
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.text = "$(search) Delve";
  statusBar.command = "delve.focusSearch";
  statusBar.tooltip = "Search your notes";
  statusBar.show();
  context.subscriptions.push(statusBar);
}

export function deactivate(): void {
  // Nothing to clean up.
}
