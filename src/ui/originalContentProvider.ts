import * as vscode from 'vscode';

export class AiOriginalContentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly contents = new Map<string, string>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  update(filePath: string, content: string) {
    this.contents.set(filePath, content);
    this.onDidChangeEmitter.fire(vscode.Uri.parse(`ai-original:/${filePath}`));
  }

  remove(filePath: string) {
    this.contents.delete(filePath);
    this.onDidChangeEmitter.fire(vscode.Uri.parse(`ai-original:/${filePath}`));
  }

  clear() {
    const filePaths = Array.from(this.contents.keys());
    this.contents.clear();
    for (const filePath of filePaths) {
      this.onDidChangeEmitter.fire(vscode.Uri.parse(`ai-original:/${filePath}`));
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const normalizedPath = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    return this.contents.get(normalizedPath) ?? '';
  }
}
