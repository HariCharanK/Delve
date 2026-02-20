import * as vscode from "vscode";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchChunk {
  file_path: string;
  content: string;
  chunk_index: number;
  line_start: number;
  score: number;
}

// ---------------------------------------------------------------------------
// Tree items
// ---------------------------------------------------------------------------

/** A collapsible file-level group shown in the results tree. */
export class FileItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly matchCount: number,
    public readonly children: SnippetItem[],
    notesDir: string,
  ) {
    const basename = path.basename(filePath);
    super(basename, vscode.TreeItemCollapsibleState.Expanded);

    const relPath = filePath.startsWith(notesDir)
      ? filePath.slice(notesDir.length).replace(/^\//, "")
      : filePath;

    this.description = relPath !== basename ? relPath : "";
    this.iconPath = vscode.ThemeIcon.File;
    this.contextValue = "delve.fileItem";

    // Badge showing match count
    this.resourceUri = vscode.Uri.file(filePath);

    // Show match count as a description suffix
    this.description = `${this.description ? this.description + "  " : ""}${matchCount}`;
  }
}

/** A single matching snippet within a file, shown as a child of FileItem. */
export class SnippetItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly lineStart: number,
    content: string,
  ) {
    const snippet = truncateSnippet(content, 200);
    super(snippet, vscode.TreeItemCollapsibleState.None);

    this.description = `L${lineStart}`;
    this.tooltip = content.trim();
    this.contextValue = "delve.snippetItem";

    // Click to open file at line
    this.command = {
      title: "Open match",
      command: "delve.openMatch",
      arguments: [filePath, lineStart],
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateSnippet(text: string, max = 200): string {
  const oneLine = text.replace(/\n+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return oneLine.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

// ---------------------------------------------------------------------------
// TreeDataProvider
// ---------------------------------------------------------------------------

export class SearchResultsProvider
  implements vscode.TreeDataProvider<FileItem | SnippetItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    FileItem | SnippetItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private fileItems: FileItem[] = [];
  private totalResults = 0;
  private treeView: vscode.TreeView<FileItem | SnippetItem> | undefined;

  /** Bind the TreeView so we can update its title dynamically. */
  setTreeView(view: vscode.TreeView<FileItem | SnippetItem>): void {
    this.treeView = view;
  }

  /** Replace results with new data and refresh the tree. */
  update(results: SearchChunk[], notesDir: string): void {
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

    this.totalResults = results.length;
    this.fileItems = [];

    for (const [filePath, chunks] of grouped) {
      const snippets = chunks.map(
        (c) => new SnippetItem(c.file_path, c.line_start, c.content),
      );
      this.fileItems.push(
        new FileItem(filePath, chunks.length, snippets, notesDir),
      );
    }

    // Update view title with counts.
    if (this.treeView) {
      if (this.totalResults > 0) {
        this.treeView.message = `${this.totalResults} result${this.totalResults !== 1 ? "s" : ""} in ${this.fileItems.length} file${this.fileItems.length !== 1 ? "s" : ""}`;
      } else {
        this.treeView.message = undefined;
      }
    }

    this._onDidChangeTreeData.fire();
  }

  /** Show a status/error message instead of results. */
  showMessage(msg: string): void {
    this.fileItems = [];
    this.totalResults = 0;
    if (this.treeView) {
      this.treeView.message = msg;
    }
    this._onDidChangeTreeData.fire();
  }

  /** Clear all results. */
  clear(): void {
    this.fileItems = [];
    this.totalResults = 0;
    if (this.treeView) {
      this.treeView.message = undefined;
    }
    this._onDidChangeTreeData.fire();
  }

  // -- TreeDataProvider interface -------------------------------------------

  getTreeItem(element: FileItem | SnippetItem): vscode.TreeItem {
    return element;
  }

  getChildren(
    element?: FileItem | SnippetItem,
  ): vscode.ProviderResult<(FileItem | SnippetItem)[]> {
    if (!element) {
      return this.fileItems;
    }
    if (element instanceof FileItem) {
      return element.children;
    }
    return [];
  }

  getParent(
    element: FileItem | SnippetItem,
  ): vscode.ProviderResult<FileItem | SnippetItem> {
    if (element instanceof SnippetItem) {
      return this.fileItems.find((f) => f.filePath === element.filePath);
    }
    return undefined;
  }
}
