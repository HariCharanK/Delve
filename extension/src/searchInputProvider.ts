import * as vscode from "vscode";

/**
 * WebviewViewProvider that renders a search input box at the top of the
 * Delve sidebar. Typing in the input fires a debounced "search" message
 * back to the extension host.
 */
export class SearchInputProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = "delve.searchInput";

  private _view: vscode.WebviewView | undefined;
  private readonly _onDidSearch = new vscode.EventEmitter<string>();

  /** Fires when the user types a query (already debounced in the webview). */
  readonly onDidSearch: vscode.Event<string> = this._onDidSearch.event;

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: { type: string; query?: string }) => {
      if (msg.type === "search" && typeof msg.query === "string") {
        this._onDidSearch.fire(msg.query);
      }
    });
  }

  /** Focus the search input (called from the focusSearch command). */
  focus(): void {
    if (this._view) {
      this._view.show(true);
      this._view.webview.postMessage({ type: "focus" });
    }
  }

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      padding: 8px 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
    }
    .search-container {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-icon {
      position: absolute;
      left: 8px;
      color: var(--vscode-input-placeholderForeground);
      font-size: 14px;
      pointer-events: none;
    }
    input {
      width: 100%;
      padding: 4px 8px 4px 28px;
      border: 1px solid var(--vscode-input-border, transparent);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font-family: inherit;
      font-size: inherit;
      border-radius: 2px;
      outline: none;
    }
    input:focus {
      border-color: var(--vscode-focusBorder);
    }
    input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
  </style>
</head>
<body>
  <div class="search-container">
    <span class="search-icon">&#x1F50D;</span>
    <input
      id="searchInput"
      type="text"
      placeholder="Search your notes..."
      spellcheck="false"
      autocomplete="off"
    />
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('searchInput');
    let debounceTimer;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        vscode.postMessage({ type: 'search', query: input.value });
      }, 300);
    });

    // Allow the extension to focus the input programmatically
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'focus') {
        input.focus();
      }
    });

    // Auto-focus on load
    input.focus();
  </script>
</body>
</html>`;
  }
}
