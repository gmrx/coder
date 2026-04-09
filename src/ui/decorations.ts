import * as vscode from 'vscode';
import { computeEditorDiff } from './diff';
import { guessLanguage } from './language';
import type { FileSnapshot, PendingChangeSnapshot } from './state';

interface EditorDecorationControllerOptions {
  context: vscode.ExtensionContext;
  getPendingChanges: () => Map<string, PendingChangeSnapshot>;
  getOriginalFileStates: () => Map<string, FileSnapshot>;
}

export class EditorDecorationController {
  private readonly addedDeco: vscode.TextEditorDecorationType;
  private readonly removedDeco: vscode.TextEditorDecorationType;
  private readonly removedDecoTop: vscode.TextEditorDecorationType;
  private decoTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: EditorDecorationControllerOptions) {
    this.addedDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(35, 134, 54, 0.18)',
      overviewRulerColor: 'rgba(35, 134, 54, 0.6)',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.removedDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.removedDecoTop = vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    options.context.subscriptions.push(
      this.addedDeco,
      this.removedDeco,
      this.removedDecoTop,
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.scheduleUpdate(editor);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === event.document.uri.toString()) {
          this.scheduleUpdate(editor);
        }
      }),
    );
  }

  refreshActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    if (editor) this.scheduleUpdate(editor);
  }

  private scheduleUpdate(editor: vscode.TextEditor) {
    if (this.decoTimer) clearTimeout(this.decoTimer);
    this.decoTimer = setTimeout(() => this.update(editor), 250);
  }

  private update(editor: vscode.TextEditor) {
    if (editor.document.uri.scheme !== 'file') {
      return;
    }

    const filePath = vscode.workspace.asRelativePath(editor.document.uri, false);
    const hasPending = Array.from(this.options.getPendingChanges().values()).some((change) => change.filePath === filePath);
    if (!hasPending) {
      editor.setDecorations(this.addedDeco, []);
      editor.setDecorations(this.removedDeco, []);
      editor.setDecorations(this.removedDecoTop, []);
      return;
    }

    const originalState = this.options.getOriginalFileStates().get(filePath);
    if (!originalState) {
      editor.setDecorations(this.addedDeco, []);
      editor.setDecorations(this.removedDeco, []);
      editor.setDecorations(this.removedDecoTop, []);
      return;
    }

    const diff = computeEditorDiff(originalState.content, editor.document.getText());
    const addedRanges: vscode.DecorationOptions[] = diff.addedLines
      .filter((lineNumber) => lineNumber < editor.document.lineCount)
      .map((lineNumber) => ({
        range: new vscode.Range(lineNumber, 0, lineNumber, editor.document.lineAt(lineNumber).text.length),
      }));

    const removedRanges: vscode.DecorationOptions[] = [];
    const removedTopRanges: vscode.DecorationOptions[] = [];
    for (const region of diff.removedRegions) {
      if (editor.document.lineCount <= 0) continue;
      const hover = new vscode.MarkdownString();
      hover.isTrusted = true;
      hover.appendMarkdown(`**Удалено ${region.lines.length} строк:**\n`);
      hover.appendCodeblock(region.lines.join('\n'), guessLanguage(filePath));

      const contentText = formatRemovedRegion(region.lines);
      if (!contentText) continue;

      if (region.afterLine < 0) {
        removedTopRanges.push({
          range: new vscode.Range(0, 0, 0, 0),
          hoverMessage: hover,
          renderOptions: {
            before: buildRemovedAttachment(contentText, 'before'),
          },
        });
        continue;
      }

      const anchorLine = Math.min(Math.max(0, region.afterLine), Math.max(0, editor.document.lineCount - 1));
      const anchorCharacter = editor.document.lineAt(anchorLine).range.end.character;
      removedRanges.push({
        range: new vscode.Range(anchorLine, anchorCharacter, anchorLine, anchorCharacter),
        hoverMessage: hover,
        renderOptions: {
          after: buildRemovedAttachment(contentText, 'after'),
        },
      });
    }

    editor.setDecorations(this.addedDeco, addedRanges);
    editor.setDecorations(this.removedDeco, removedRanges);
    editor.setDecorations(this.removedDecoTop, removedTopRanges);
  }
}

function formatRemovedRegion(lines: string[]): string {
  const normalized = (Array.isArray(lines) ? lines : []).map((line) => {
    const raw = String(line == null ? '' : line).replace(/\t/g, '    ');
    return raw.length > 0 ? raw : '\u00a0';
  });
  if (!normalized.length) return '';
  return normalized.join('\n');
}

function buildRemovedAttachment(
  contentText: string,
  position: 'before' | 'after',
): NonNullable<vscode.DecorationInstanceRenderOptions['before']> {
  return {
    contentText: position === 'before' ? `${contentText}\n` : `\n${contentText}`,
    color: new vscode.ThemeColor('editor.foreground'),
    backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('diffEditor.removedTextBorder'),
    fontStyle: 'normal',
    fontWeight: 'normal',
    margin: position === 'before' ? '0 0 4px 0' : '4px 0 0 0',
    width: '100%',
    textDecoration: [
      'none',
      'display: block',
      'white-space: pre',
      'box-sizing: border-box',
      'padding: 2px 10px',
      'font-family: var(--vscode-editor-font-family)',
      'font-size: var(--vscode-editor-font-size)',
      'line-height: 1.55',
      'border-radius: 0',
    ].join('; '),
  };
}
