import * as vscode from 'vscode';
import * as path from 'path';
import { getAgentWorkspaceFolder } from '../agent/worktreeSession';
import { computeLineChangeStats, computeLineDiffOperations } from '../core/lineDiff';
import { computeUnifiedDiff } from './diff';
import { EditorDecorationController } from './decorations';
import { guessLanguage } from './language';
import { classifyLineAttribution } from './lineProvenance';
import { AiOriginalContentProvider } from './originalContentProvider';
import type { ChangeMetricsPayload, FileChangeMessagePayload, WebviewMessageSink } from './protocol/messages';
import type { FileSnapshot, PendingChangeSnapshot } from './state';

interface ChangeControllerOptions {
  context: vscode.ExtensionContext;
  originalProvider: AiOriginalContentProvider;
  post: WebviewMessageSink;
}

interface AgentFileChangeMeta {
  changeId?: string;
  step?: string | number;
  filePath?: string;
  changeType?: string;
  tool?: string;
  summary?: string;
  oldSnippet?: string;
  newSnippet?: string;
  fullOldText?: string;
  fullNewText?: string;
  cellIdx?: number;
  fileExistedBefore?: boolean;
}

type SerializedFileStateEntry = [string, FileSnapshot];
type SerializedPendingChangeEntry = [string, PendingChangeSnapshot];

export interface WorkspaceChangeControllerState {
  pendingChanges: SerializedPendingChangeEntry[];
  trackedFiles: string[];
  originalFileStates: SerializedFileStateEntry[];
  manualOriginalFileStates?: SerializedFileStateEntry[];
  manualUserLineKeys?: string[];
}

export class WorkspaceChangeController {
  private pendingChanges = new Map<string, PendingChangeSnapshot>();
  private trackedFiles = new Set<string>();
  private originalFileStates = new Map<string, FileSnapshot>();
  private manualOriginalFileStates = new Map<string, FileSnapshot>();
  private openDocumentTexts = new Map<string, string>();

  private scm: vscode.SourceControl | undefined;
  private scmGroup: vscode.SourceControlResourceGroup | undefined;
  private readonly decorationController: EditorDecorationController;
  private metricsTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ChangeControllerOptions) {
    this.decorationController = new EditorDecorationController({
      context: options.context,
      getPendingChanges: () => this.pendingChanges,
      getOriginalFileStates: () => this.originalFileStates,
    });

    options.context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        this.rememberOpenDocumentText(document);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.scheme !== 'file') return;
        const filePath = vscode.workspace.asRelativePath(event.document.uri, false);
        const markedManualChange = this.markManualDocumentChange(event);
        this.rememberOpenDocumentText(event.document);
        if (markedManualChange || this.trackedFiles.has(filePath) || this.hasPendingChangesForFile(filePath)) {
          this.scheduleMetricsPost();
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme !== 'file') return;
        const filePath = vscode.workspace.asRelativePath(document.uri, false);
        if (this.trackedFiles.has(filePath) || this.hasPendingChangesForFile(filePath)) {
          this.scheduleMetricsPost();
        }
        this.openDocumentTexts.delete(document.uri.toString());
      }),
    );
    for (const document of vscode.workspace.textDocuments) {
      this.rememberOpenDocumentText(document);
    }

    this.refreshWorkspaceContext();
  }

  getPendingChanges(): Map<string, PendingChangeSnapshot> {
    return this.pendingChanges;
  }

  hasPendingChanges(): boolean {
    return this.pendingChanges.size > 0;
  }

  snapshotState(): WorkspaceChangeControllerState {
    return {
      pendingChanges: Array.from(this.pendingChanges, ([key, value]) => [key, { ...value }]),
      trackedFiles: Array.from(this.trackedFiles),
      originalFileStates: Array.from(this.originalFileStates, ([key, value]) => [key, { ...value }]),
      manualOriginalFileStates: Array.from(this.manualOriginalFileStates, ([key, value]) => [key, { ...value }]),
    };
  }

  restoreState(state: WorkspaceChangeControllerState | null | undefined) {
    if (!state) {
      this.pendingChanges.clear();
      this.trackedFiles.clear();
      this.originalFileStates.clear();
      this.manualOriginalFileStates.clear();
      this.options.originalProvider.clear();
      this.refreshScm();
      return;
    }

    this.pendingChanges = new Map(
      (Array.isArray(state.pendingChanges) ? state.pendingChanges : [])
        .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object')
        .map(([key, value]) => [key, {
          filePath: typeof value.filePath === 'string' ? value.filePath : '',
          oldText: typeof value.oldText === 'string' ? value.oldText : '',
          newText: typeof value.newText === 'string' ? value.newText : '',
          existedBefore: !!value.existedBefore,
        }] as [string, PendingChangeSnapshot]),
    );

    this.trackedFiles = new Set(
      (Array.isArray(state.trackedFiles) ? state.trackedFiles : [])
        .filter((entry) => typeof entry === 'string'),
    );

    this.originalFileStates = new Map(
      (Array.isArray(state.originalFileStates) ? state.originalFileStates : [])
        .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object')
        .map(([key, value]) => [key, {
          content: typeof value.content === 'string' ? value.content : '',
          existed: !!value.existed,
        }] as [string, FileSnapshot]),
    );

    this.manualOriginalFileStates = new Map(
      (Array.isArray(state.manualOriginalFileStates) ? state.manualOriginalFileStates : [])
        .filter((entry) => Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object')
        .map(([key, value]) => [key, {
          content: typeof value.content === 'string' ? value.content : '',
          existed: !!value.existed,
        }] as [string, FileSnapshot]),
    );

    this.refreshOriginalProvider();
    this.refreshScm();
  }

  setPendingChanges(value: Map<string, PendingChangeSnapshot>) {
    this.pendingChanges = value;
  }

  getTrackedFiles(): Set<string> {
    return this.trackedFiles;
  }

  setTrackedFiles(value: Set<string>) {
    this.trackedFiles = value;
  }

  getOriginalFileStates(): Map<string, FileSnapshot> {
    return this.originalFileStates;
  }

  setOriginalFileStates(value: Map<string, FileSnapshot>) {
    this.originalFileStates = value;
  }

  refreshOriginalProvider(states: Map<string, FileSnapshot> = this.originalFileStates) {
    this.options.originalProvider.clear();
    for (const [filePath, snapshot] of states) {
      this.options.originalProvider.update(filePath, snapshot.content);
    }
  }

  refreshScm() {
    this.scheduleMetricsPost();
    if (!this.scm || !this.scmGroup) return;
    const folder = getAgentWorkspaceFolder();
    if (!folder) return;

    const pendingFiles = new Set<string>();
    for (const change of this.pendingChanges.values()) {
      pendingFiles.add(change.filePath);
    }

    const resources: vscode.SourceControlResourceState[] = [];
    for (const filePath of pendingFiles) {
      const originalState = this.originalFileStates.get(filePath);
      this.options.originalProvider.update(filePath, originalState?.content ?? '');

      const isNew = !originalState || !originalState.existed;
      resources.push({
        resourceUri: vscode.Uri.joinPath(folder.uri, filePath),
        decorations: {
          tooltip: isNew ? 'ИИ: новый файл' : 'ИИ: изменено агентом',
          iconPath: new vscode.ThemeIcon(
            isNew ? 'diff-added' : 'diff-modified',
            new vscode.ThemeColor(isNew ? 'charts.green' : 'charts.yellow'),
          ),
        },
        command: {
          title: 'Показать diff',
          command: 'ai-assistant.showScmDiff',
          arguments: [filePath],
        },
      });
    }

    this.scmGroup.resourceStates = resources;
    this.scm.count = resources.length;

    this.decorationController.refreshActiveEditor();
  }

  recordFileChange(meta: AgentFileChangeMeta): FileChangeMessagePayload | null {
    const changeId = meta.changeId || '';
    const filePath = meta.filePath || '';
    if (!changeId || !filePath) return null;

    const existedBefore = typeof meta.fileExistedBefore === 'boolean'
      ? meta.fileExistedBefore
      : meta.changeType !== 'create';
    const fullOldText = meta.fullOldText || '';
    const fullNewText = meta.fullNewText || '';

    if (!this.originalFileStates.has(filePath)) {
      this.trackedFiles.add(filePath);
      this.manualOriginalFileStates.delete(filePath);
      this.originalFileStates.set(filePath, {
        content: fullOldText,
        existed: existedBefore,
      });
    }

    this.pendingChanges.set(changeId, {
      filePath,
      oldText: fullOldText,
      newText: fullNewText,
      existedBefore,
    });

    this.refreshScm();

    const diffLines = computeUnifiedDiff(fullOldText, fullNewText);

    return {
      changeId,
      ...(meta.step !== undefined && meta.step !== null ? { step: String(meta.step) } : {}),
      filePath,
      changeType: meta.changeType || 'edit',
      tool: meta.tool || 'unknown',
      summary: meta.summary || '',
      stats: computeLineChangeStats(fullOldText, fullNewText),
      oldSnippet: meta.oldSnippet || '',
      newSnippet: meta.newSnippet || '',
      cellIdx: meta.cellIdx,
      diffLines,
    };
  }

  acceptAllChangesForFile(filePath: string) {
    const removedIds: string[] = [];
    for (const [changeId, change] of this.pendingChanges) {
      if (change.filePath !== filePath) continue;
      this.pendingChanges.delete(changeId);
      removedIds.push(changeId);
    }

    for (const changeId of removedIds) {
      this.options.post({ type: 'changeAccepted', changeId });
    }

    this.cleanupResolvedFile(filePath);
    this.refreshScm();
  }

  async rejectAllChangesForFile(filePath: string) {
    const folder = getAgentWorkspaceFolder();
    if (!folder) return;

    const originalState = this.originalFileStates.get(filePath);
    if (!originalState) return;

    try {
      const fileUri = vscode.Uri.joinPath(folder.uri, filePath);
      if (originalState.existed) {
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(originalState.content, 'utf-8'));
      } else {
        try {
          await vscode.workspace.fs.delete(fileUri);
        } catch {
          // Ignore already missing files.
        }
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Ошибка отката: ${error?.message || error}`);
      return;
    }

    const removedIds: string[] = [];
    for (const [changeId, change] of this.pendingChanges) {
      if (change.filePath !== filePath) continue;
      this.pendingChanges.delete(changeId);
      removedIds.push(changeId);
    }

    for (const changeId of removedIds) {
      this.options.post({ type: 'changeRejected', changeId });
    }

    this.cleanupResolvedFile(filePath);
    this.refreshScm();
  }

  acceptAllChanges() {
    for (const changeId of this.pendingChanges.keys()) {
      this.options.post({ type: 'changeAccepted', changeId });
    }

    this.pendingChanges.clear();
    this.trackedFiles.clear();
    this.originalFileStates.clear();
    this.options.originalProvider.clear();
    this.refreshScm();
  }

  async rejectAllChanges() {
    const filePaths = new Set<string>();
    for (const change of this.pendingChanges.values()) {
      filePaths.add(change.filePath);
    }

    for (const filePath of filePaths) {
      await this.rejectAllChangesForFile(filePath);
    }
  }

  handleAcceptChange(changeId: string) {
    if (!changeId) return;

    const change = this.pendingChanges.get(changeId);
    if (!change) return;

    this.pendingChanges.delete(changeId);
    this.options.post({ type: 'changeAccepted', changeId });
    this.cleanupResolvedFile(change.filePath);
    this.refreshScm();
  }

  async handleRejectChange(changeId: string) {
    if (!changeId) return;

    const change = this.pendingChanges.get(changeId);
    if (!change) {
      this.options.post({ type: 'changeRejected', changeId, error: 'Изменение не найдено' });
      return;
    }

    const folder = getAgentWorkspaceFolder();
    if (!folder) return;

    try {
      const fileUri = vscode.Uri.joinPath(folder.uri, change.filePath);
      if (change.existedBefore) {
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(change.oldText, 'utf-8'));
      } else {
        try {
          await vscode.workspace.fs.delete(fileUri);
        } catch {
          // Ignore already missing files.
        }
      }

      this.pendingChanges.delete(changeId);
      this.options.post({ type: 'changeRejected', changeId });
      this.cleanupResolvedFile(change.filePath);
      this.refreshScm();
    } catch (error: any) {
      this.options.post({ type: 'error', text: `Ошибка отката: ${error?.message || error}` });
    }
  }

  async handleOpenFile(filePath: string) {
    if (!filePath) return;

    try {
      const normalizedPath = String(filePath).trim();
      const folder = getAgentWorkspaceFolder();
      const fileUri = path.isAbsolute(normalizedPath)
        ? vscode.Uri.file(normalizedPath)
        : folder
          ? vscode.Uri.joinPath(folder.uri, normalizedPath)
          : vscode.Uri.file(path.resolve(normalizedPath));
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error: any) {
      vscode.window.showErrorMessage(`Не удалось открыть "${filePath}": ${error?.message || error}`);
    }
  }

  async handleShowDiff(changeId: string) {
    if (!changeId) return;

    const change = this.pendingChanges.get(changeId);
    if (!change) return;

    try {
      const language = guessLanguage(change.filePath);
      const beforeDoc = await vscode.workspace.openTextDocument({ content: change.oldText, language });
      const afterDoc = await vscode.workspace.openTextDocument({ content: change.newText, language });
      await vscode.commands.executeCommand('vscode.diff', beforeDoc.uri, afterDoc.uri, `${change.filePath}: до → после`);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Не удалось показать diff: ${error?.message || error}`);
    }
  }

  async collectChangeMetrics(): Promise<ChangeMetricsPayload> {
    const metrics: ChangeMetricsPayload = {
      pendingFiles: 0,
      pendingChanges: this.pendingChanges.size,
      agentLines: 0,
      agentModifiedByUserLines: 0,
      agentRemovedLines: 0,
      agentDeletedByUserLines: 0,
      userOnlyLines: 0,
      userRemovedLines: 0,
      unknownFiles: 0,
    };

    const changesByFile = new Map<string, PendingChangeSnapshot[]>();
    for (const change of this.pendingChanges.values()) {
      if (!change.filePath) continue;
      const fileChanges = changesByFile.get(change.filePath) || [];
      fileChanges.push(change);
      changesByFile.set(change.filePath, fileChanges);
    }

    metrics.pendingFiles = changesByFile.size;

    for (const [filePath, changes] of changesByFile) {
      const original = this.originalFileStates.get(filePath);
      const originalText = original?.content || '';
      const latestAgentText = changes.length > 0 ? changes[changes.length - 1].newText : originalText;
      const currentText = await this.readCurrentFileText(filePath, latestAgentText);
      const attribution = classifyLineAttribution(originalText, changes, currentText);

      metrics.agentLines += attribution.agentLines.size;
      metrics.agentModifiedByUserLines += attribution.agentModifiedByUserLines.size;
      metrics.agentRemovedLines += attribution.agentRemovedLines;
      metrics.agentDeletedByUserLines += attribution.agentDeletedByUserLines;
      metrics.userOnlyLines += attribution.userOnlyLines.size;
      metrics.userRemovedLines += attribution.userRemovedLines;
      if (attribution.unknown) metrics.unknownFiles += 1;
    }

    for (const [filePath, original] of this.manualOriginalFileStates) {
      if (!filePath || changesByFile.has(filePath) || this.trackedFiles.has(filePath)) continue;
      const currentText = await this.readCurrentFileText(filePath, original.content);
      const manualStats = computeManualUserLineMetrics(original.content, currentText);
      metrics.userOnlyLines += manualStats.added;
      metrics.userRemovedLines += manualStats.removed;
      if (manualStats.unknown) metrics.unknownFiles += 1;
    }

    return metrics;
  }

  private cleanupResolvedFile(filePath: string) {
    if (this.hasPendingChangesForFile(filePath)) return;

    this.trackedFiles.delete(filePath);
    this.originalFileStates.delete(filePath);
    this.options.originalProvider.remove(filePath);
  }

  private hasPendingChangesForFile(filePath: string): boolean {
    for (const change of this.pendingChanges.values()) {
      if (change.filePath === filePath) return true;
    }
    return false;
  }

  private markManualDocumentChange(event: vscode.TextDocumentChangeEvent): boolean {
    const filePath = this.toWorkspaceFilePath(event.document.uri);
    if (!filePath) return false;
    if (this.trackedFiles.has(filePath) || this.hasPendingChangesForFile(filePath)) return false;

    if (!this.manualOriginalFileStates.has(filePath)) {
      this.manualOriginalFileStates.set(filePath, {
        content: this.openDocumentTexts.get(event.document.uri.toString()) ?? event.document.getText(),
        existed: true,
      });
    }
    return true;
  }

  private toWorkspaceFilePath(uri: vscode.Uri): string {
    if (!vscode.workspace.getWorkspaceFolder(uri)) return '';
    return vscode.workspace.asRelativePath(uri, false);
  }

  private rememberOpenDocumentText(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file') return;
    if (!vscode.workspace.getWorkspaceFolder(document.uri)) return;
    this.openDocumentTexts.set(document.uri.toString(), document.getText());
  }

  private scheduleMetricsPost() {
    if (this.metricsTimer) clearTimeout(this.metricsTimer);
    this.metricsTimer = setTimeout(() => {
      this.metricsTimer = undefined;
      void this.postChangeMetrics();
    }, 200);
  }

  private async postChangeMetrics(): Promise<void> {
    try {
      this.options.post({ type: 'changeMetrics', metrics: await this.collectChangeMetrics() });
    } catch {
      // Метрики не должны ломать основной сценарий чата.
    }
  }

  private async readCurrentFileText(filePath: string, fallback: string): Promise<string> {
    const uri = this.resolveFileUri(filePath);
    if (!uri) return fallback;

    const openDocument = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    if (openDocument) return openDocument.getText();

    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf-8');
    } catch {
      return '';
    }
  }

  private resolveFileUri(filePath: string): vscode.Uri | null {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) return null;
    if (path.isAbsolute(normalizedPath)) return vscode.Uri.file(normalizedPath);
    const folder = getAgentWorkspaceFolder();
    return folder ? vscode.Uri.joinPath(folder.uri, normalizedPath) : vscode.Uri.file(path.resolve(normalizedPath));
  }

  refreshWorkspaceContext() {
    const folder = getAgentWorkspaceFolder();
    if (this.scm && (!folder || this.scm.rootUri?.toString() !== folder.uri.toString())) {
      this.scm.dispose();
      this.scm = undefined;
      this.scmGroup = undefined;
    }

    if (!this.scm && folder) {
      this.scm = vscode.scm.createSourceControl('ai-agent', 'ИИ Кодогенератор', folder.uri);
      this.scm.inputBox.placeholder = 'Нажмите , чтобы принять все изменения';
      this.scm.acceptInputCommand = { title: 'Принять все', command: 'ai-assistant.acceptAllChanges' };
      this.scmGroup = this.scm.createResourceGroup('pending', 'Ожидают принятия');
      this.scmGroup.hideWhenEmpty = true;
      this.options.context.subscriptions.push(this.scm);
    }

    this.refreshScm();
  }
}

function computeManualUserLineMetrics(originalText: string, currentText: string): { added: number; removed: number; unknown: boolean } {
  if (originalText === currentText) {
    return { added: 0, removed: 0, unknown: false };
  }

  const operations = computeLineDiffOperations(originalText, currentText);
  if (!operations) {
    const stats = computeLineChangeStats(originalText, currentText);
    return { added: stats.added, removed: stats.removed, unknown: true };
  }

  let added = 0;
  let removed = 0;
  for (const operation of operations) {
    if (operation.type === 'add') added += 1;
    else if (operation.type === 'del') removed += 1;
  }
  return { added, removed, unknown: false };
}
