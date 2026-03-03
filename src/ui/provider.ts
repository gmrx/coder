import * as vscode from 'vscode';
import { ChatMessage } from '../core/types';
import { readConfig, fetchModelsList, saveConfig, sendChatRequest } from '../core/api';
import { isConfigValid } from '../core/utils';
import { EXTENSION_NAME } from '../core/constants';
import { runAgent } from '../agent';
import { getChatViewHtml } from './webviewTemplate';

interface DiffLine {
  type: 'context' | 'add' | 'del' | 'sep' | 'hunk';
  text: string;
  oldNo?: number;
  newNo?: number;
}

function computeUnifiedDiff(oldText: string, newText: string, ctx = 3): DiffLine[] {
  if (oldText === newText) return [];
  if (!oldText && !newText) return [];

  if (!oldText) {
    const lines = newText.split('\n');
    if (lines.length > 300) return lines.slice(0, 300).map((l, i) => ({ type: 'add' as const, text: l, newNo: i + 1 }));
    return lines.map((l, i) => ({ type: 'add' as const, text: l, newNo: i + 1 }));
  }
  if (!newText) {
    const lines = oldText.split('\n');
    if (lines.length > 300) return lines.slice(0, 300).map((l, i) => ({ type: 'del' as const, text: l, oldNo: i + 1 }));
    return lines.map((l, i) => ({ type: 'del' as const, text: l, oldNo: i + 1 }));
  }

  const oldL = oldText.split('\n');
  const newL = newText.split('\n');
  const m = oldL.length, n = newL.length;

  if (m > 2000 || n > 2000) return [];

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldL[i - 1] === newL[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: Array<{ t: 'ctx' | 'del' | 'add'; s: string; o?: number; n?: number }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldL[i - 1] === newL[j - 1]) {
      ops.unshift({ t: 'ctx', s: oldL[i - 1], o: i, n: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ t: 'add', s: newL[j - 1], n: j });
      j--;
    } else {
      ops.unshift({ t: 'del', s: oldL[i - 1], o: i });
      i--;
    }
  }

  const visible = new Set<number>();
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t !== 'ctx') {
      for (let c = Math.max(0, k - ctx); c <= Math.min(ops.length - 1, k + ctx); c++) {
        visible.add(c);
      }
    }
  }
  if (visible.size === 0) return [];

  const result: DiffLine[] = [];
  let prevIncluded = -1;
  let totalLines = 0;

  for (let k = 0; k < ops.length && totalLines < 300; k++) {
    if (!visible.has(k)) {
      prevIncluded = -1;
      continue;
    }
    if (prevIncluded >= 0 && k - prevIncluded > 1) {
      result.push({ type: 'sep', text: '···' });
      totalLines++;
    }
    prevIncluded = k;
    const op = ops[k];
    switch (op.t) {
      case 'ctx': result.push({ type: 'context', text: op.s, oldNo: op.o, newNo: op.n }); break;
      case 'del': result.push({ type: 'del', text: op.s, oldNo: op.o }); break;
      case 'add': result.push({ type: 'add', text: op.s, newNo: op.n }); break;
    }
    totalLines++;
  }
  return result;
}

interface EditorDiffResult {
  addedLines: number[];
  removedRegions: Array<{ afterLine: number; lines: string[] }>;
}

function computeEditorDiff(oldText: string, newText: string): EditorDiffResult {
  const result: EditorDiffResult = { addedLines: [], removedRegions: [] };
  if (oldText === newText) return result;
  if (!oldText && !newText) return result;
  if (!oldText) {
    result.addedLines = newText.split('\n').map((_, i) => i);
    return result;
  }
  if (!newText) {
    result.removedRegions = [{ afterLine: -1, lines: oldText.split('\n') }];
    return result;
  }

  const oldL = oldText.split('\n');
  const newL = newText.split('\n');
  const m = oldL.length, n = newL.length;
  if (m > 2000 || n > 2000) return result;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) dp[i] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldL[i - 1] === newL[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  const ops: Array<{ t: 'ctx' | 'del' | 'add'; s: string; o?: number; n?: number }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldL[i - 1] === newL[j - 1]) {
      ops.unshift({ t: 'ctx', s: oldL[i - 1], o: i, n: j }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ t: 'add', s: newL[j - 1], n: j }); j--;
    } else {
      ops.unshift({ t: 'del', s: oldL[i - 1], o: i }); i--;
    }
  }

  let lastNewLine = -1;
  let curRemoved: string[] = [];
  let removedAfter = -1;

  for (const op of ops) {
    if (op.t === 'ctx') {
      if (curRemoved.length) {
        result.removedRegions.push({ afterLine: removedAfter, lines: [...curRemoved] });
        curRemoved = [];
      }
      lastNewLine = op.n! - 1;
    } else if (op.t === 'add') {
      if (curRemoved.length) {
        result.removedRegions.push({ afterLine: removedAfter, lines: [...curRemoved] });
        curRemoved = [];
      }
      result.addedLines.push(op.n! - 1);
      lastNewLine = op.n! - 1;
    } else {
      if (!curRemoved.length) removedAfter = lastNewLine;
      curRemoved.push(op.s);
    }
  }
  if (curRemoved.length) {
    result.removedRegions.push({ afterLine: removedAfter, lines: [...curRemoved] });
  }
  return result;
}

interface FileSnapshot { content: string; existed: boolean; }
interface PendingChangeSnapshot { filePath: string; oldText: string; newText: string; }

interface Checkpoint {
  id: string;
  index: number;
  timestamp: number;
  userMessage: string;
  files: Map<string, FileSnapshot>;
  savedPendingChanges: Map<string, PendingChangeSnapshot>;
  savedTrackedFiles: Set<string>;
  savedOriginalFileStates: Map<string, FileSnapshot>;
}

export class AiOriginalContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;
  private contents = new Map<string, string>();

  update(filePath: string, content: string) {
    this.contents.set(filePath, content);
    this._onDidChange.fire(vscode.Uri.parse(`ai-original:/${filePath}`));
  }

  remove(filePath: string) {
    this.contents.delete(filePath);
  }

  clear() {
    this.contents.clear();
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const p = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
    return this.contents.get(p) ?? '';
  }
}

export class AiChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aiAssistant.chatView';

  private view: vscode.WebviewView | undefined;
  private chatHistory: ChatMessage[] = [];
  private pendingChanges = new Map<string, { filePath: string; oldText: string; newText: string }>();

  private checkpoints: Checkpoint[] = [];
  private trackedFiles = new Set<string>();
  private originalFileStates = new Map<string, FileSnapshot>();

  private scm: vscode.SourceControl | undefined;
  private scmGroup: vscode.SourceControlResourceGroup | undefined;
  private originalProvider: AiOriginalContentProvider;
  private shellConfirmResolvers = new Map<string, (result: { approved: boolean; command: string }) => void>();
  private preRevertSnapshot: {
    checkpointId: string;
    pendingChanges: Map<string, { filePath: string; oldText: string; newText: string }>;
    trackedFiles: Set<string>;
    originalFileStates: Map<string, FileSnapshot>;
    fileContents: Map<string, { content: string; existed: boolean }>;
  } | null = null;

  private addedDeco: vscode.TextEditorDecorationType;
  private removedDeco: vscode.TextEditorDecorationType;
  private decoTimer: ReturnType<typeof setTimeout> | undefined;
  private runningAbort: AbortController | null = null;

  constructor(private readonly context: vscode.ExtensionContext, originalProvider: AiOriginalContentProvider) {
    this.originalProvider = originalProvider;

    this.addedDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(35, 134, 54, 0.18)',
      overviewRulerColor: 'rgba(35, 134, 54, 0.6)',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    this.removedDeco = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: '2px 0 0 0',
      borderStyle: 'dashed',
      borderColor: 'rgba(218, 54, 51, 0.6)',
      overviewRulerColor: 'rgba(218, 54, 51, 0.6)',
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    context.subscriptions.push(
      this.addedDeco,
      this.removedDeco,
      vscode.window.onDidChangeActiveTextEditor(e => { if (e) this.scheduleDecoUpdate(e); }),
      vscode.workspace.onDidChangeTextDocument(e => {
        const ed = vscode.window.activeTextEditor;
        if (ed && ed.document.uri.toString() === e.document.uri.toString()) this.scheduleDecoUpdate(ed);
      })
    );

    this.initScm();
  }

  private scheduleDecoUpdate(editor: vscode.TextEditor) {
    if (this.decoTimer) clearTimeout(this.decoTimer);
    this.decoTimer = setTimeout(() => this.updateEditorDecorations(editor), 250);
  }

  private updateEditorDecorations(editor: vscode.TextEditor) {
    if (editor.document.uri.scheme !== 'file') {
      return;
    }

    const filePath = vscode.workspace.asRelativePath(editor.document.uri, false);

    let hasPending = false;
    for (const [, c] of this.pendingChanges) {
      if (c.filePath === filePath) { hasPending = true; break; }
    }

    if (!hasPending) {
      editor.setDecorations(this.addedDeco, []);
      editor.setDecorations(this.removedDeco, []);
      return;
    }

    const orig = this.originalFileStates.get(filePath);
    if (!orig) {
      editor.setDecorations(this.addedDeco, []);
      editor.setDecorations(this.removedDeco, []);
      return;
    }

    const diff = computeEditorDiff(orig.content, editor.document.getText());

    const addedRanges: vscode.DecorationOptions[] = diff.addedLines
      .filter(ln => ln < editor.document.lineCount)
      .map(ln => ({ range: new vscode.Range(ln, 0, ln, editor.document.lineAt(ln).text.length) }));

    const removedRanges: vscode.DecorationOptions[] = diff.removedRegions.map(region => {
      const ln = Math.min(Math.max(0, region.afterLine + 1), editor.document.lineCount - 1);
      const hover = new vscode.MarkdownString();
      hover.isTrusted = true;
      hover.appendMarkdown(`**Удалено ${region.lines.length} строк:**\n`);
      hover.appendCodeblock(region.lines.join('\n'), this.guessLanguage(filePath));
      return {
        range: new vscode.Range(ln, 0, ln, 0),
        hoverMessage: hover,
      };
    });

    editor.setDecorations(this.addedDeco, addedRanges);
    editor.setDecorations(this.removedDeco, removedRanges);
  }

  private initScm() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    this.scm = vscode.scm.createSourceControl('ai-agent', 'AI Agent', folder.uri);
    this.scm.inputBox.placeholder = 'Нажмите ✓ чтобы принять все изменения';
    this.scm.acceptInputCommand = { title: 'Accept All', command: 'ai-assistant.acceptAllChanges' };
    this.scmGroup = this.scm.createResourceGroup('pending', 'Ожидают принятия');
    this.scmGroup.hideWhenEmpty = true;
    this.context.subscriptions.push(this.scm);
  }

  private refreshScm() {
    if (!this.scmGroup || !this.scm) return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    const pendingFiles = new Map<string, string[]>();
    for (const [cid, change] of this.pendingChanges) {
      const arr = pendingFiles.get(change.filePath) || [];
      arr.push(cid);
      pendingFiles.set(change.filePath, arr);
    }

    const resources: vscode.SourceControlResourceState[] = [];
    for (const [filePath] of pendingFiles) {
      const fileUri = vscode.Uri.joinPath(folders[0].uri, filePath);
      const originalUri = vscode.Uri.parse(`ai-original:/${filePath}`);

      const orig = this.originalFileStates.get(filePath);
      this.originalProvider.update(filePath, orig?.content ?? '');

      const isNew = !orig || !orig.existed;
      resources.push({
        resourceUri: fileUri,
        decorations: {
          tooltip: isNew ? 'AI: новый файл' : 'AI: изменено агентом',
          iconPath: new vscode.ThemeIcon(
            isNew ? 'diff-added' : 'diff-modified',
            new vscode.ThemeColor(isNew ? 'charts.green' : 'charts.yellow')
          )
        },
        command: {
          title: 'Show Diff',
          command: 'ai-assistant.showScmDiff',
          arguments: [filePath]
        }
      });
    }

    this.scmGroup.resourceStates = resources;
    this.scm.count = resources.length;

    const editor = vscode.window.activeTextEditor;
    if (editor) this.scheduleDecoUpdate(editor);
  }

  public acceptAllChangesForFile(filePath: string) {
    const toRemove: string[] = [];
    for (const [cid, change] of this.pendingChanges) {
      if (change.filePath === filePath) toRemove.push(cid);
    }
    for (const cid of toRemove) {
      this.pendingChanges.delete(cid);
      this.post({ type: 'changeAccepted', changeId: cid });
    }
    this.originalProvider.remove(filePath);
    this.refreshScm();
  }

  public async rejectAllChangesForFile(filePath: string) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;
    const orig = this.originalFileStates.get(filePath);
    try {
      const uri = vscode.Uri.joinPath(folders[0].uri, filePath);
      if (orig && orig.existed) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(orig.content, 'utf-8'));
      } else {
        try { await vscode.workspace.fs.delete(uri); } catch { /* didn't exist originally */ }
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Ошибка отката: ${e?.message || e}`);
      return;
    }
    const toRemove: string[] = [];
    for (const [cid, change] of this.pendingChanges) {
      if (change.filePath === filePath) toRemove.push(cid);
    }
    for (const cid of toRemove) {
      this.pendingChanges.delete(cid);
      this.post({ type: 'changeRejected', changeId: cid });
    }
    this.originalProvider.remove(filePath);
    this.refreshScm();
  }

  public acceptAllChanges() {
    for (const [cid] of this.pendingChanges) {
      this.post({ type: 'changeAccepted', changeId: cid });
    }
    this.pendingChanges.clear();
    this.originalProvider.clear();
    this.refreshScm();
  }

  public async rejectAllChanges() {
    const files = new Set<string>();
    for (const [, change] of this.pendingChanges) files.add(change.filePath);
    for (const fp of files) await this.rejectAllChangesForFile(fp);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    webviewView.webview.html = getChatViewHtml(webviewView.webview, this.context.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'send': {
          const t = (message.text as string).trim();
          if (t && !this.runningAbort) await this.handleUserMessage(t);
          break;
        }
        case 'stop': {
          if (this.runningAbort) {
            this.runningAbort.abort();
            this.runningAbort = null;
          }
          break;
        }
        case 'getSettings': await this.sendSettings(); break;
        case 'saveSettings': await this.handleSaveSettings(message.data || {}); break;
        case 'testConnection': await this.handleTestConnection(message.data || {}); break;
        case 'loadModels': await this.handleLoadModels(message.data || {}); break;
        case 'acceptChange': this.handleAcceptChange(message.changeId); break;
        case 'rejectChange': await this.handleRejectChange(message.changeId); break;
        case 'acceptAll': this.acceptAllChanges(); break;
        case 'rejectAll': await this.rejectAllChanges(); break;
        case 'openChangedFile': await this.handleOpenFile(message.filePath); break;
        case 'showDiff': await this.handleShowDiff(message.changeId); break;
        case 'revertToCheckpoint': await this.handleRevertToCheckpoint(message.checkpointId); break;
        case 'undoRevert': await this.handleUndoRevert(); break;
        case 'getCheckpoints': this.sendCheckpointsList(); break;
        case 'shellConfirmResult': {
          const resolver = this.shellConfirmResolvers.get(message.confirmId);
          if (resolver) {
            resolver({ approved: !!message.approved, command: message.command || '' });
            this.shellConfirmResolvers.delete(message.confirmId);
          }
          break;
        }
      }
    });
  }

  private async handleUserMessage(text: string) {
    this.chatHistory.push({ role: 'user', content: text });
    this.post({ type: 'traceReset' });
    const cfg = readConfig();
    if (!isConfigValid(cfg)) {
      this.post({ type: 'error', text: 'Настройте API и модель во вкладке Settings.' });
      this.post({ type: 'agentDone' });
      return;
    }

    const cp = await this.createCheckpoint(text);
    this.post({
      type: 'checkpoint',
      id: cp.id,
      index: cp.index,
      timestamp: cp.timestamp,
      userMessage: text.slice(0, 80),
      fileCount: cp.files.size,
      trackedTotal: this.trackedFiles.size
    });

    const abort = new AbortController();
    this.runningAbort = abort;

    const loading = vscode.window.setStatusBarMessage(`${EXTENSION_NAME}: агент работает...`);
    try {
      let activeFile: { path: string; language: string; content: string } | null = null;
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const doc = editor.document;
        activeFile = { path: vscode.workspace.asRelativePath(doc.uri, false), language: doc.languageId, content: doc.getText() };
      }
      const answer = await runAgent(text, this.chatHistory, activeFile, (phase, msg, meta): void | Promise<any> => {
        if (abort.signal.aborted) return;
        if (phase === 'shell-confirm' && meta?.confirmId) {
          return new Promise<{ approved: boolean; command: string }>((resolve) => {
            this.shellConfirmResolvers.set(meta.confirmId, resolve);
            this.post({
              type: 'shellConfirm',
              confirmId: meta.confirmId,
              command: meta.command || '',
              cwd: meta.cwd || ''
            });
          });
        }
        if (phase === 'file-change' && meta?.changeId) {
          const fp = meta.filePath as string;
          if (!this.trackedFiles.has(fp)) {
            this.trackedFiles.add(fp);
            const existed = (meta.fullOldText || '') !== '' || meta.changeType !== 'create';
            this.originalFileStates.set(fp, {
              content: meta.fullOldText || '',
              existed: existed && (meta.fullOldText || '') !== ''
            });
          }
          this.pendingChanges.set(meta.changeId, {
            filePath: fp,
            oldText: meta.fullOldText || '',
            newText: meta.fullNewText || ''
          });
          const diffLines = computeUnifiedDiff(meta.fullOldText || '', meta.fullNewText || '');
          this.post({
            type: 'fileChange',
            changeId: meta.changeId,
            filePath: fp,
            changeType: meta.changeType,
            tool: meta.tool,
            oldSnippet: meta.oldSnippet || '',
            newSnippet: meta.newSnippet || '',
            cellIdx: meta.cellIdx,
            diffLines
          });
          this.refreshScm();
          return;
        }
        this.post({ type: 'traceEvent', phase, text: msg, data: meta || {} });
      }, abort.signal);
      this.chatHistory.push({ role: 'assistant', content: answer });
      this.post({ type: 'assistant', text: answer });
      if (!abort.signal.aborted) {
        await this.generateSuggestions(cfg);
      }
    } catch (error: any) {
      if (!abort.signal.aborted) {
        this.post({ type: 'error', text: error?.message || String(error) });
      }
    } finally {
      this.runningAbort = null;
      loading.dispose();
      this.post({ type: 'agentDone' });
    }
  }

  private async generateSuggestions(cfg: { apiBaseUrl: string; apiKey: string; model: string }) {
    try {
      const recentHistory = this.chatHistory.slice(-6);
      if (recentHistory.length === 0) return;

      const summaryParts: string[] = [];
      for (const m of recentHistory) {
        const preview = (m.content || '').slice(0, 150).replace(/\n/g, ' ');
        summaryParts.push(`${m.role}: ${preview}`);
      }

      const messages: ChatMessage[] = [
        {
          role: 'user',
          content:
            'Based on this conversation between a developer and an AI assistant, generate exactly 5 follow-up suggestions.\n\n' +
            'Conversation:\n' +
            summaryParts.join('\n') + '\n\n' +
            'Reply with ONLY a raw JSON array (no markdown fences, no explanation):\n' +
            '[{"label":"short text (3-5 words)","query":"full request"},...]'
        }
      ];
      const raw = await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, messages, { temperature: 0.8, maxTokens: 600 });
      let jsonStr = raw.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const bracketStart = jsonStr.indexOf('[');
      const bracketEnd = jsonStr.lastIndexOf(']');
      if (bracketStart >= 0 && bracketEnd > bracketStart) {
        jsonStr = jsonStr.slice(bracketStart, bracketEnd + 1);
      }
      const arr = JSON.parse(jsonStr);
      if (!Array.isArray(arr)) return;
      const suggestions = arr
        .filter((s: any) => s && typeof s.label === 'string' && typeof s.query === 'string' && s.label.trim() && s.query.trim())
        .slice(0, 5)
        .map((s: any) => ({ label: s.label.trim().slice(0, 40), query: s.query.trim().slice(0, 200) }));
      if (suggestions.length > 0) {
        this.post({ type: 'updateSuggestions', suggestions });
      }
    } catch (e: any) {
      console.error('[AI-Assistant] generateSuggestions error:', e?.message || e);
    }
  }

  private async createCheckpoint(userMessage: string): Promise<Checkpoint> {
    const folders = vscode.workspace.workspaceFolders;
    const files = new Map<string, FileSnapshot>();

    if (folders?.length) {
      for (const filePath of this.trackedFiles) {
        try {
          const uri = vscode.Uri.joinPath(folders[0].uri, filePath);
          const content = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
          files.set(filePath, { content, existed: true });
        } catch {
          files.set(filePath, { content: '', existed: false });
        }
      }
    }

    const checkpoint: Checkpoint = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      index: this.checkpoints.length,
      timestamp: Date.now(),
      userMessage,
      files,
      savedPendingChanges: new Map(
        Array.from(this.pendingChanges).map(([k, v]) => [k, { ...v }])
      ),
      savedTrackedFiles: new Set(this.trackedFiles),
      savedOriginalFileStates: new Map(
        Array.from(this.originalFileStates).map(([k, v]) => [k, { ...v }])
      ),
    };

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  private async handleRevertToCheckpoint(checkpointId: string) {
    const idx = this.checkpoints.findIndex(c => c.id === checkpointId);
    if (idx < 0) {
      this.post({ type: 'error', text: 'Чекпоинт не найден.' });
      return;
    }

    const cp = this.checkpoints[idx];
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    const savedContents = new Map<string, { content: string; existed: boolean }>();
    const allPaths = new Set([...this.trackedFiles]);
    for (const [fp] of cp.files) allPaths.add(fp);
    for (const fp of allPaths) {
      try {
        const uri = vscode.Uri.joinPath(folders[0].uri, fp);
        const data = await vscode.workspace.fs.readFile(uri);
        savedContents.set(fp, { content: Buffer.from(data).toString('utf-8'), existed: true });
      } catch {
        savedContents.set(fp, { content: '', existed: false });
      }
    }

    this.preRevertSnapshot = {
      checkpointId,
      pendingChanges: new Map(Array.from(this.pendingChanges).map(([k, v]) => [k, { ...v }])),
      trackedFiles: new Set(this.trackedFiles),
      originalFileStates: new Map(Array.from(this.originalFileStates).map(([k, v]) => [k, { ...v }])),
      fileContents: savedContents,
    };

    const restored: string[] = [];
    const deleted: string[] = [];
    const errors: string[] = [];

    for (const [filePath, snapshot] of cp.files) {
      try {
        const uri = vscode.Uri.joinPath(folders[0].uri, filePath);
        if (snapshot.existed) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(snapshot.content, 'utf-8'));
          restored.push(filePath);
        } else {
          try { await vscode.workspace.fs.delete(uri); deleted.push(filePath); } catch { /* didn't exist */ }
        }
      } catch (e: any) {
        errors.push(`${filePath}: ${e?.message || e}`);
      }
    }

    const allTrackedAtRevert = new Set([...this.trackedFiles, ...cp.savedTrackedFiles]);
    for (const filePath of allTrackedAtRevert) {
      if (cp.files.has(filePath)) continue;
      const origFromCp = cp.savedOriginalFileStates.get(filePath);
      const origCurrent = this.originalFileStates.get(filePath);
      const orig = origFromCp || origCurrent;
      try {
        const uri = vscode.Uri.joinPath(folders[0].uri, filePath);
        if (orig && orig.existed) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(orig.content, 'utf-8'));
          restored.push(filePath);
        } else {
          try { await vscode.workspace.fs.delete(uri); deleted.push(filePath); } catch { /* ignore */ }
        }
      } catch (e: any) {
        errors.push(`${filePath}: ${e?.message || e}`);
      }
    }

    this.pendingChanges = new Map(
      Array.from(cp.savedPendingChanges).map(([k, v]) => [k, { ...v }])
    );
    this.trackedFiles = new Set(cp.savedTrackedFiles);
    this.originalFileStates = new Map(
      Array.from(cp.savedOriginalFileStates).map(([k, v]) => [k, { ...v }])
    );

    this.originalProvider.clear();
    for (const [fp, snap] of this.originalFileStates) {
      this.originalProvider.update(fp, snap.content);
    }
    this.refreshScm();

    const restoredPendingIds = Array.from(this.pendingChanges.keys());

    this.post({
      type: 'checkpointReverted',
      checkpointId,
      index: cp.index,
      restored: restored.length,
      deleted: deleted.length,
      errors,
      restoredPendingIds
    });

    vscode.window.showInformationMessage(
      `${EXTENSION_NAME}: откат к чекпоинту #${cp.index} — ` +
      `восстановлено ${restored.length} файлов` +
      (deleted.length ? `, удалено ${deleted.length}` : '') +
      (errors.length ? `, ошибок: ${errors.length}` : '')
    );
  }

  private async handleUndoRevert() {
    const snap = this.preRevertSnapshot;
    if (!snap) {
      this.post({ type: 'error', text: 'Нет сохранённого состояния для отмены отката.' });
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    const errors: string[] = [];
    for (const [fp, saved] of snap.fileContents) {
      try {
        const uri = vscode.Uri.joinPath(folders[0].uri, fp);
        if (saved.existed) {
          await vscode.workspace.fs.writeFile(uri, Buffer.from(saved.content, 'utf-8'));
        } else {
          try { await vscode.workspace.fs.delete(uri); } catch { /* didn't exist */ }
        }
      } catch (e: any) {
        errors.push(`${fp}: ${e?.message || e}`);
      }
    }

    this.pendingChanges = new Map(Array.from(snap.pendingChanges).map(([k, v]) => [k, { ...v }]));
    this.trackedFiles = new Set(snap.trackedFiles);
    this.originalFileStates = new Map(Array.from(snap.originalFileStates).map(([k, v]) => [k, { ...v }]));

    this.originalProvider.clear();
    for (const [fp, s] of this.originalFileStates) {
      this.originalProvider.update(fp, s.content);
    }
    this.refreshScm();

    const restoredPendingIds = Array.from(this.pendingChanges.keys());
    this.post({
      type: 'undoRevertDone',
      checkpointId: snap.checkpointId,
      restoredPendingIds,
      errors,
    });

    this.preRevertSnapshot = null;
    vscode.window.showInformationMessage(`${EXTENSION_NAME}: откат отменён, состояние восстановлено.`);
  }

  private sendCheckpointsList() {
    const list = this.checkpoints.map(cp => ({
      id: cp.id,
      index: cp.index,
      timestamp: cp.timestamp,
      userMessage: cp.userMessage.slice(0, 80),
      fileCount: cp.files.size,
      trackedTotal: this.trackedFiles.size
    }));
    this.post({ type: 'checkpointsList', checkpoints: list });
  }

  private handleAcceptChange(changeId: string) {
    if (!changeId) return;
    this.pendingChanges.delete(changeId);
    this.post({ type: 'changeAccepted', changeId });
    this.refreshScm();
  }

  private async handleRejectChange(changeId: string) {
    if (!changeId) return;
    const change = this.pendingChanges.get(changeId);
    if (!change) {
      this.post({ type: 'changeRejected', changeId, error: 'Изменение не найдено' });
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;
    try {
      if (change.oldText === '' && change.newText !== '') {
        const uri = vscode.Uri.joinPath(folders[0].uri, change.filePath);
        await vscode.workspace.fs.delete(uri);
      } else {
        const uri = vscode.Uri.joinPath(folders[0].uri, change.filePath);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(change.oldText, 'utf-8'));
      }
      this.pendingChanges.delete(changeId);
      this.post({ type: 'changeRejected', changeId });
      this.refreshScm();
    } catch (e: any) {
      this.post({ type: 'error', text: `Ошибка отката: ${e?.message || e}` });
    }
  }

  private async handleOpenFile(filePath: string) {
    if (!filePath) return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;
    try {
      const uri = vscode.Uri.joinPath(folders[0].uri, filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Не удалось открыть "${filePath}": ${e?.message || e}`);
    }
  }

  private async handleShowDiff(changeId: string) {
    if (!changeId) return;
    const change = this.pendingChanges.get(changeId);
    if (!change) return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;
    try {
      const oldUri = vscode.Uri.parse(`untitled:${change.filePath}.before`);
      const newFileUri = vscode.Uri.joinPath(folders[0].uri, change.filePath);
      const oldDoc = await vscode.workspace.openTextDocument({ content: change.oldText, language: this.guessLanguage(change.filePath) });
      const newDoc = await vscode.workspace.openTextDocument(newFileUri);
      await vscode.commands.executeCommand('vscode.diff', oldDoc.uri, newDoc.uri, `${change.filePath}: до → после`);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Не удалось показать diff: ${e?.message || e}`);
    }
  }

  private guessLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
      py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp', cpp: 'cpp',
      c: 'c', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', dart: 'dart',
      html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml', yml: 'yaml',
      md: 'markdown', sql: 'sql', sh: 'shellscript', ipynb: 'json'
    };
    return map[ext] || 'plaintext';
  }

  private async sendSettings() {
    const cfg = readConfig();
    let models: string[] = [];
    if (cfg.apiBaseUrl && cfg.apiKey) { try { models = await fetchModelsList(cfg.apiBaseUrl, cfg.apiKey); } catch {} }
    this.post({ type: 'settingsData', data: { ...cfg, models } });
  }

  private async handleSaveSettings(data: any) {
    const d = { apiBaseUrl: data.apiBaseUrl || '', apiKey: data.apiKey || '', model: data.model || '', embeddingsModel: data.embeddingsModel || '', rerankModel: data.rerankModel || '' };
    try {
      await saveConfig(d);
      const check = readConfig();
      if (check.apiBaseUrl === d.apiBaseUrl && check.model === d.model) {
        vscode.window.showInformationMessage(`${EXTENSION_NAME}: настройки сохранены (chat=${d.model || '—'}).`);
        this.post({ type: 'settingsSaved' });
      } else {
        const msg = `Не удалось сохранить: "${check.model}" != "${d.model}"`;
        vscode.window.showErrorMessage(`${EXTENSION_NAME}: ${msg}`);
        this.post({ type: 'error', text: msg }); this.post({ type: 'settingsSaved' });
      }
    } catch (err: any) {
      const msg = `Ошибка: ${err?.message || err}`;
      vscode.window.showErrorMessage(`${EXTENSION_NAME}: ${msg}`);
      this.post({ type: 'error', text: msg }); this.post({ type: 'settingsSaved' });
    }
  }

  private async handleTestConnection(data: any) {
    if (!data.apiBaseUrl || !data.apiKey) { this.post({ type: 'connectionResult', ok: false, error: 'Укажите URL и API Key' }); return; }
    try {
      const models = await fetchModelsList(data.apiBaseUrl, data.apiKey);
      this.post({ type: 'connectionResult', ok: true, modelsCount: models.length });
    } catch (err: any) { this.post({ type: 'connectionResult', ok: false, error: err?.message || String(err) }); }
  }

  private async handleLoadModels(data: any) {
    let models: string[] = [];
    try { if (data.apiBaseUrl && data.apiKey) models = await fetchModelsList(data.apiBaseUrl, data.apiKey); } catch {}
    this.post({ type: 'modelsLoaded', models });
  }

  private post(msg: any) { this.view?.webview.postMessage(msg); }
}
