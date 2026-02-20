import * as vscode from "vscode";
import * as http from "http";
import * as https from "https";
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
// Open-match helper
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

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SearchInputProvider.viewId,
      searchInput,
    ),
  );

  const resultsTreeView = vscode.window.createTreeView("delve.results", {
    treeDataProvider: searchResults,
    showCollapseAll: true,
  });
  searchResults.setTreeView(resultsTreeView);
  context.subscriptions.push(resultsTreeView);

  setupSidebarSearch(searchInput, searchResults);

  // -- Commands -------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand("delve.reindex", reindexCommand),

    vscode.commands.registerCommand(
      "delve.openMatch",
      (filePath: string, lineStart: number) =>
        openFileAtLine(filePath, lineStart),
    ),

    vscode.commands.registerCommand("delve.focusSearch", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.delve");
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
