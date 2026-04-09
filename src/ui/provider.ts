import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { readConfig, saveConfig } from '../core/api';
import { EXTENSION_NAME } from '../core/constants';
import type { ChatMessage } from '../core/types';
import { buildMcpToolKey, normalizeMcpTrustedTools } from '../core/mcpToolAvailability';
import { AgentQueryEngine } from '../agent';
import { applyWorktreeSession, getAgentWorkspaceRootPath } from '../agent/worktreeSession';
import { getTaskFilePath, listTaskRecords, stopTaskProcess, toTaskWorkspaceRelativePath, type AgentTaskRecord } from '../agent/tasks/store';
import { ConversationAgentEngineStore } from './agentEngineStore';
import { CheckpointController, type CheckpointControllerState } from './checkpoints';
import { CheckpointStateStore } from './checkpointStateStore';
import { WorkspaceChangeController, type WorkspaceChangeControllerState } from './changeController';
import { ChangeStateStore } from './changeStateStore';
import { ChatRunController } from './chatRunController';
import { ConversationStore, type StoredConversationSession } from './conversations';
import { AiOriginalContentProvider } from './originalContentProvider';
import { ApprovalController } from './approvals';
import { QuestionController } from './questions';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './protocol/messages';
import type { PersistedChatArtifact } from './protocol/artifacts';
import {
  buildSkippedModelTests,
  loadAvailableModels,
  normalizeSettingsPayload,
  runSelectedModelTests,
  testSettingsConnection,
  type SettingsPayload,
} from './settingsModels';
import { inspectMcpDraft } from './mcpInspector';
import {
  buildMissingChatModelIssueFromCatalog,
  type SettingsModelIssue,
  type SettingsPanelRequest,
  type SettingsSectionId,
} from './modelSelectionIssue';
import { loadMcpSettingsEditorState, saveMcpSettingsEditorState } from './mcpSettings';
import { getChatViewHtml, getSettingsPanelHtml } from './webviewTemplate';

export class AiChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aiAssistant.chatView';
  public static readonly settingsPanelType = 'aiAssistant.settingsPanel';

  private view: vscode.WebviewView | undefined;
  private settingsPanel: vscode.WebviewPanel | undefined;
  private readonly chatHistory: ChatMessage[] = [];
  private readonly conversationStore: ConversationStore;
  private readonly engineStore: ConversationAgentEngineStore;
  private readonly checkpointController: CheckpointController;
  private readonly checkpointStateStore: CheckpointStateStore;
  private readonly changeStateStore: ChangeStateStore;
  private readonly changeController: WorkspaceChangeController;
  private readonly approvalController: ApprovalController;
  private readonly questionController: QuestionController;
  private readonly chatRunController: ChatRunController;
  private readonly checkpointStatesByConversation = new Map<string, CheckpointControllerState>();
  private readonly changeStatesByConversation = new Map<string, WorkspaceChangeControllerState>();
  private activeConversationId: string;
  private activeEngine: AgentQueryEngine;
  private chatArtifacts: PersistedChatArtifact[] = [];
  private artifactPersistTimer: NodeJS.Timeout | null = null;
  private changePersistTimer: NodeJS.Timeout | null = null;
  private changePersistPayload: { conversationId: string; state: WorkspaceChangeControllerState } | null = null;
  private checkpointPersistTimer: NodeJS.Timeout | null = null;
  private checkpointPersistPayload: { conversationId: string; state: CheckpointControllerState } | null = null;
  private tasksPollTimer: NodeJS.Timeout | null = null;
  private tasksRefreshInFlight = false;
  private pendingSettingsSection: SettingsSectionId | undefined;
  private pendingModelSelectionIssue: SettingsModelIssue | null = null;
  private highlightPendingModelSelectionIssue = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    originalProvider: AiOriginalContentProvider,
  ) {
    this.conversationStore = new ConversationStore(context.workspaceState);
    this.engineStore = new ConversationAgentEngineStore((conversationId, kind) => this.handleEngineRuntimeChanged(conversationId, kind));
    this.checkpointStateStore = new CheckpointStateStore(context);
    this.changeStateStore = new ChangeStateStore(context);
    const activeConversation = this.conversationStore.getActiveConversation();
    this.activeConversationId = activeConversation.id;
    this.chatHistory.push(...activeConversation.messages);
    this.chatArtifacts = Array.isArray(activeConversation.artifactEvents)
      ? activeConversation.artifactEvents.map((artifact) => clonePersistedArtifact(artifact))
      : [];
    this.activeEngine = this.engineStore.getOrCreate(activeConversation.id, activeConversation.messages, activeConversation.agentRuntime);
    const appliedInitialWorktree = applyWorktreeSession(activeConversation.agentRuntime?.worktreeSession || null);
    if (!appliedInitialWorktree && activeConversation.agentRuntime?.worktreeSession) {
      this.activeEngine.setWorktreeSession(null);
    }

    this.changeController = new WorkspaceChangeController({
      context,
      originalProvider,
      post: (message) => this.post(message),
    });

    this.approvalController = new ApprovalController((message) => this.post(message));
    this.questionController = new QuestionController((message) => this.post(message));

    this.checkpointController = new CheckpointController({
      getPendingChanges: () => this.changeController.getPendingChanges(),
      setPendingChanges: (value) => {
        this.changeController.setPendingChanges(value);
      },
      getTrackedFiles: () => this.changeController.getTrackedFiles(),
      setTrackedFiles: (value) => {
        this.changeController.setTrackedFiles(value);
      },
      getOriginalFileStates: () => this.changeController.getOriginalFileStates(),
      setOriginalFileStates: (value) => {
        this.changeController.setOriginalFileStates(value);
      },
      getChatHistory: () => this.chatHistory,
      setChatHistory: (value) => {
        this.chatHistory.splice(0, this.chatHistory.length, ...value);
      },
      refreshOriginalProvider: (states) => {
        this.changeController.refreshOriginalProvider(states);
      },
      refreshScm: () => this.changeController.refreshScm(),
      post: (message) => this.post(message),
    });

    this.chatRunController = new ChatRunController({
      chatHistory: this.chatHistory,
      getAgentEngine: () => this.activeEngine,
      checkpointController: this.checkpointController,
      changeController: this.changeController,
      getActiveFileContext: () => this.getActiveFileContext(),
      post: (message) => this.post(message),
      requestApproval: (request, signal) => this.approvalController.request(request, signal),
      cancelApproval: (confirmId, reason) => this.approvalController.cancel(confirmId, reason),
      requestQuestion: (request, signal) => this.questionController.request(request, signal),
      cancelQuestion: (confirmId, reason) => this.questionController.cancel(confirmId, reason),
      persistConversation: () => this.persistActiveConversation(),
      openSettingsPanel: (request) => this.openSettingsPanel(request),
    });

    this.chatRunController.restoreConversationState({
      messages: activeConversation.messages,
      suggestions: activeConversation.suggestions,
      suggestionsState: activeConversation.suggestionsState,
      suggestionsSummary: activeConversation.suggestionsSummary,
      traceRuns: activeConversation.traceRuns,
      artifactEvents: activeConversation.artifactEvents,
    });
    const initialChangeState = this.changeStateStore.read(activeConversation.id);
    if (initialChangeState) {
      this.changeStatesByConversation.set(activeConversation.id, initialChangeState);
      this.changeController.restoreState(initialChangeState);
    }
    const initialCheckpointState = this.checkpointStateStore.read(activeConversation.id);
    if (initialCheckpointState) {
      this.checkpointStatesByConversation.set(activeConversation.id, initialCheckpointState);
      this.checkpointController.restoreState(initialCheckpointState);
    }
  }

  public acceptAllChangesForFile(filePath: string) {
    this.changeController.acceptAllChangesForFile(filePath);
  }

  public async rejectAllChangesForFile(filePath: string) {
    await this.changeController.rejectAllChangesForFile(filePath);
  }

  public acceptAllChanges() {
    this.changeController.acceptAllChanges();
  }

  public async rejectAllChanges() {
    await this.changeController.rejectAllChanges();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = this.getWebviewOptions();
    webviewView.webview.html = getChatViewHtml(webviewView.webview, this.context.extensionUri);
    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.handleWebviewMessage(message as WebviewToExtensionMessage);
    });
    this.startTasksPolling();
    webviewView.onDidDispose(() => {
      this.stopTasksPolling();
      this.view = undefined;
    });
  }

  public openSettingsPanel(request?: SettingsPanelRequest): void {
    this.applyPendingSettingsRequest(request);
    const targetColumn = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active;
    if (this.settingsPanel) {
      this.settingsPanel.reveal(targetColumn, false);
      void this.sendSettings();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AiChatViewProvider.settingsPanelType,
      `${EXTENSION_NAME}: Настройки`,
      targetColumn,
      {
        ...this.getWebviewOptions(),
        retainContextWhenHidden: true,
      },
    );

    panel.webview.html = getSettingsPanelHtml(panel.webview, this.context.extensionUri);
    panel.webview.onDidReceiveMessage(async (message) => {
      await this.handleWebviewMessage(message as WebviewToExtensionMessage);
    });
    panel.onDidDispose(() => {
      if (this.settingsPanel === panel) {
        this.settingsPanel = undefined;
      }
    });

    this.settingsPanel = panel;
    void this.sendSettings();
  }

  private async handleWebviewMessage(message: WebviewToExtensionMessage) {
    switch (message.type) {
      case 'send': {
        const text = (message.text as string).trim();
        if (text && !this.chatRunController.isRunning()) {
          this.commitRevertBranchIfNeeded();
          await this.chatRunController.handleUserMessage(text);
        }
        return;
      }
      case 'openSettingsPanel':
        this.openSettingsPanel();
        return;
      case 'closeSettingsPanel':
        this.settingsPanel?.dispose();
        return;
      case 'stop': {
        this.chatRunController.stop();
        return;
      }
      case 'getSettings':
        await this.sendSettings();
        return;
      case 'getConversationState':
        this.sendConversationSessions();
        this.sendActiveConversationState(false);
        this.sendComposerPermissionsState();
        await this.sendTasksState();
        return;
      case 'getConversationSessions':
        this.sendConversationSessions();
        return;
      case 'getTasksState':
        await this.sendTasksState();
        return;
      case 'createConversation':
        await this.handleCreateConversation();
        return;
      case 'switchConversation':
        await this.handleSwitchConversation(message.conversationId);
        return;
      case 'deleteConversation':
        await this.handleDeleteConversation(message.conversationId);
        return;
      case 'clearConversation':
        await this.handleClearConversation();
        return;
      case 'saveSettings':
        await this.handleSaveSettings(message.data || {});
        return;
      case 'saveComposerPermissions':
        await this.handleSaveComposerPermissions(message.autoApproval);
        return;
      case 'testConnection':
        await this.handleTestConnection(message.data || {});
        return;
      case 'testModels':
        await this.handleTestModels(message.data || {});
        return;
      case 'inspectMcp':
        await this.handleInspectMcp(message.data || {});
        return;
      case 'refreshSuggestions':
        await this.chatRunController.handleRefreshSuggestions();
        return;
      case 'acceptChange':
        this.commitRevertBranchIfNeeded();
        this.changeController.handleAcceptChange(message.changeId);
        return;
      case 'rejectChange':
        this.commitRevertBranchIfNeeded();
        await this.changeController.handleRejectChange(message.changeId);
        return;
      case 'acceptAll':
        this.commitRevertBranchIfNeeded();
        this.acceptAllChanges();
        return;
      case 'rejectAll':
        this.commitRevertBranchIfNeeded();
        await this.rejectAllChanges();
        return;
      case 'openChangedFile':
        await this.changeController.handleOpenFile(message.filePath);
        return;
      case 'showDiff':
        await this.changeController.handleShowDiff(message.changeId);
        return;
      case 'openTaskFile':
        await this.changeController.handleOpenFile(message.filePath);
        return;
      case 'openSessionMemory':
        await this.changeController.handleOpenFile(message.filePath);
        return;
      case 'stopTask': {
        const task = await stopTaskProcess(message.taskId, {
          force: message.force === true,
          rootPath: this.getTasksRootPath(),
        });
        if (!task) {
          this.post({ type: 'error', text: `Задача "${message.taskId}" не найдена.` });
        } else {
          this.post({
            type: 'status',
            text: task.status === 'cancelled'
              ? `Остановка задачи #${task.id} запрошена.`
              : `Для задачи #${task.id} обновлён статус остановки.`,
          });
        }
        await this.sendTasksState();
        return;
      }
      case 'revertToCheckpoint':
        if (this.chatRunController.isRunning()) {
          this.post({ type: 'error', text: 'Сначала дождитесь завершения текущего запуска агента.' });
          return;
        }
        await this.checkpointController.revertToCheckpoint(message.checkpointId);
        this.syncActiveConversationEngine();
        await this.persistActiveConversation();
        this.sendActiveConversationState(true);
        return;
      case 'undoRevert':
        if (this.chatRunController.isRunning()) {
          this.post({ type: 'error', text: 'Сначала дождитесь завершения текущего запуска агента.' });
          return;
        }
        await this.checkpointController.undoRevert();
        this.syncActiveConversationEngine();
        await this.persistActiveConversation();
        this.sendActiveConversationState(true);
        return;
      case 'getCheckpoints':
        this.checkpointController.sendCheckpointsList();
        return;
      case 'approvalResult':
        await this.handleApprovalResult(message.result);
        return;
      case 'questionResult':
        this.questionController.resolve(message.result);
        return;
      case 'fileConfirmResult':
        this.approvalController.resolveLegacyFile(message);
        return;
      case 'shellConfirmResult': {
        this.approvalController.resolveLegacyShell(message);
        return;
      }
      case 'planConfirmResult': {
        this.approvalController.resolveLegacyPlan(message);
        return;
      }
      default:
        return;
    }
  }

  private getActiveFileContext(): { path: string; language: string; content: string } | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const document = editor.document;
    return {
      path: vscode.workspace.asRelativePath(document.uri, false),
      language: document.languageId,
      content: document.getText(),
    };
  }

  private getWebviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules'),
      ],
    };
  }

  private async sendSettings() {
    const config = readConfig();
    const mcp = await loadMcpSettingsEditorState();
    const models = await loadAvailableModels(config);
    const detectedModelIssue = buildMissingChatModelIssueFromCatalog(config, models);
    const modelSelectionIssue = this.pendingModelSelectionIssue || detectedModelIssue;
    const settingsSection = this.pendingSettingsSection || (modelSelectionIssue ? 'models' : undefined);
    const highlightModelSelectionIssue = this.highlightPendingModelSelectionIssue;
    this.pendingSettingsSection = undefined;
    this.pendingModelSelectionIssue = null;
    this.highlightPendingModelSelectionIssue = false;
    this.postSettings({
      type: 'settingsData',
      data: {
        ...config,
        mcpConfigPath: mcp.mcpConfigPath,
        mcpServers: mcp.mcpServers,
        mcpConfigExists: mcp.mcpConfigExists,
        mcpSource: mcp.mcpSource,
        mcpSourceLabel: mcp.mcpSourceLabel,
        mcpLoadError: mcp.mcpLoadError,
        models,
        settingsSection,
        modelSelectionIssue,
        highlightModelSelectionIssue,
      },
    });
  }

  private applyPendingSettingsRequest(request?: SettingsPanelRequest): void {
    if (!request) return;
    if (request.section) {
      this.pendingSettingsSection = request.section;
    }
    if (request.modelSelectionIssue !== undefined) {
      this.pendingModelSelectionIssue = request.modelSelectionIssue || null;
    }
    if (request.highlightModelSelectionIssue) {
      this.highlightPendingModelSelectionIssue = true;
    }
  }

  private async handleSaveSettings(data: SettingsPayload) {
    const config = normalizeSettingsPayload(data);

    try {
      await saveConfig({
        apiBaseUrl: config.apiBaseUrl,
        apiKey: config.apiKey,
        model: config.model,
        embeddingsModel: config.embeddingsModel,
        rerankModel: config.rerankModel,
        systemPrompt: config.systemPrompt,
        mcpDisabledTools: config.mcpDisabledTools,
        mcpTrustedTools: config.mcpTrustedTools,
        webTrustedHosts: config.webTrustedHosts,
        webBlockedHosts: config.webBlockedHosts,
      });
      const savedMcp = await saveMcpSettingsEditorState({
        mcpConfigPath: config.mcpConfigPath,
        mcpServers: config.mcpServers,
      });
      const saved = readConfig();
      if (saved.apiBaseUrl === config.apiBaseUrl && saved.model === config.model) {
        this.resetAgentEngines();
        vscode.window.showInformationMessage(`${EXTENSION_NAME}: настройки сохранены (chat=${config.model || '—'}).`);
        this.postSettings({
          type: 'settingsSaved',
          ...(savedMcp.savedPath ? { mcpSavedPath: savedMcp.savedPath, mcpCreatedFile: savedMcp.created } : {}),
        });
        return;
      }

      const message = `Не удалось сохранить: "${saved.model}" != "${config.model}"`;
      vscode.window.showErrorMessage(`${EXTENSION_NAME}: ${message}`);
      this.postSettings({ type: 'error', text: message });
      this.postSettings({ type: 'settingsSaved' });
    } catch (error: any) {
      const message = `Ошибка: ${error?.message || error}`;
      vscode.window.showErrorMessage(`${EXTENSION_NAME}: ${message}`);
      this.postSettings({ type: 'error', text: message });
      this.postSettings({ type: 'settingsSaved' });
    }
  }

  private async handleSaveComposerPermissions(autoApproval: SettingsPayload['autoApproval']) {
    try {
      await saveConfig({ autoApproval });
      this.sendComposerPermissionsState();
    } catch (error: any) {
      const message = `Не удалось сохранить автодействия: ${error?.message || error}`;
      this.post({ type: 'error', text: message });
    }
  }

  private async handleApprovalResult(result: any) {
    if (result?.kind === 'mcp' && result?.approved && result?.rememberTool) {
      try {
        const server = String(result.server || '').trim();
        const toolName = String(result.mcpToolName || '').trim();
        if (!server || !toolName) {
          this.post({
            type: 'error',
            text: 'Не удалось сохранить авторазрешение MCP tool: не указаны сервер или имя утилиты.',
          });
          this.approvalController.resolve(result);
          return;
        }
        const config = readConfig();
        const nextTrusted = normalizeMcpTrustedTools([
          ...config.mcpTrustedTools,
          buildMcpToolKey(server, toolName),
        ]);
        await saveConfig({ mcpTrustedTools: nextTrusted });
        this.post({
          type: 'status',
          text: `MCP tool ${server} • ${toolName} добавлен в авторазрешение.`,
        });
      } catch (error: any) {
        this.post({
          type: 'error',
          text: `Не удалось сохранить авторазрешение MCP tool: ${error?.message || error}`,
        });
      }
    }
    this.approvalController.resolve(result);
  }

  private async handleTestConnection(data: SettingsPayload) {
    this.postSettings({
      type: 'connectionResult',
      ...(await testSettingsConnection(data)),
    });
  }

  private async handleTestModels(data: SettingsPayload) {
    if (!data.apiBaseUrl || !data.apiKey) {
      this.postSettings({
        type: 'modelTestsResult',
        ok: false,
        summary: 'Сначала проверьте подключение.',
        tests: buildSkippedModelTests(data, 'Нет подключения для запуска теста.'),
      });
      return;
    }

    const tests = await runSelectedModelTests(data);
    const selectedCount = tests.filter((test) => test.state !== 'skipped').length;
    const passedCount = tests.filter((test) => test.state === 'passed').length;
    const ok = selectedCount > 0 && selectedCount === passedCount;
    const summary =
      selectedCount === 0
        ? 'Выберите хотя бы одну модель, чтобы проверить её отдельным запросом.'
        : passedCount === selectedCount
          ? `Все выбранные модели ответили: ${passedCount}/${selectedCount}.`
          : `Проверено ${selectedCount} моделей: успешно ${passedCount}, с ошибкой ${selectedCount - passedCount}.`;

    this.postSettings({
      type: 'modelTestsResult',
      ok,
      summary,
      tests,
    });
  }

  private async handleInspectMcp(data: SettingsPayload) {
    try {
      const config = normalizeSettingsPayload(data);
      const inspection = await inspectMcpDraft({
        mcpServers: config.mcpServers,
        mcpDisabledTools: config.mcpDisabledTools,
      });
      this.postSettings({
        type: 'mcpInspectionResult',
        ...inspection,
      });
    } catch (error: any) {
      this.postSettings({
        type: 'mcpInspectionResult',
        ok: false,
        summary: `Не удалось проверить MCP: ${error?.message || error}`,
        servers: [],
        configErrors: [],
        failures: [],
      });
    }
  }

  private postSettings(message: ExtensionToWebviewMessage) {
    this.settingsPanel?.webview.postMessage(message);
  }

  private post(message: ExtensionToWebviewMessage) {
    this.recordArtifactMessage(message);
    if (shouldPersistChangeState(message)) {
      this.scheduleChangeStatePersist();
    }
    if (shouldPersistCheckpointState(message)) {
      this.scheduleCheckpointStatePersist();
    }
    this.view?.webview.postMessage(message);
  }

  private async persistActiveConversation() {
    this.syncActiveConversationEngine();
    const changeState = this.changeController.snapshotState();
    this.changeStatesByConversation.set(this.activeConversationId, changeState);
    await this.persistChangeStateNow(this.activeConversationId, changeState);
    const checkpointState = this.checkpointController.snapshotState();
    this.checkpointStatesByConversation.set(this.activeConversationId, checkpointState);
    await this.persistCheckpointStateNow(this.activeConversationId, checkpointState);
    await this.conversationStore.updateActiveConversation({
      ...this.chatRunController.snapshotConversationState(),
      artifactEvents: this.chatArtifacts.map((artifact) => clonePersistedArtifact(artifact)),
      agentRuntime: this.activeEngine.snapshotRuntime(),
    });
    this.sendConversationSessions();
  }

  private sendConversationSessions() {
    this.post({
      type: 'conversationSessions',
      activeId: this.conversationStore.getActiveId(),
      sessions: this.conversationStore.listSummaries(),
    });
  }

  private sendActiveConversationState(replace: boolean) {
    const active = this.conversationStore.getActiveConversation();
    const runtime = this.activeEngine.snapshotRuntime();
    const config = readConfig();
    const pendingChangeIds = Array.from(this.changeController.getPendingChanges().keys());
    this.post({
      type: 'conversationState',
      sessionId: active.id,
      title: active.title,
      replace,
      messages: active.messages.map((message) => ({ role: message.role, content: message.content })),
      suggestions: active.suggestions,
      suggestionsState: active.suggestionsState,
      suggestionsSummary: active.suggestionsSummary,
      traceRuns: active.traceRuns,
      artifactEvents: active.artifactEvents,
      agentMode: runtime.mode,
      awaitingPlanApproval: runtime.awaitingPlanApproval,
      pendingApproval: runtime.pendingApproval,
      pendingQuestion: runtime.pendingQuestion,
      todos: runtime.todos,
      progress: runtime.progress,
      sessionMemory: runtime.sessionMemory,
      autoApproval: config.autoApproval,
      pendingChangeIds,
    });
    void this.sendTasksState();
  }

  private canSwitchConversation(): boolean {
    if (this.chatRunController.isRunning()) {
      this.post({ type: 'error', text: 'Сначала дождитесь завершения текущего запуска агента.' });
      return false;
    }
    if (this.changeController.hasPendingChanges()) {
      this.post({ type: 'error', text: 'Сначала примите или отклоните изменения файлов, затем переключайте чат.' });
      return false;
    }
    if (this.checkpointController.hasActiveRevert()) {
      this.post({ type: 'error', text: 'Сначала завершите текущий откат, затем переключайте чат.' });
      return false;
    }
    return true;
  }

  private async handleCreateConversation() {
    if (!this.canSwitchConversation()) return;
    await this.persistActiveConversation();
    const created = await this.conversationStore.createConversation();
    this.activateConversation(created);
  }

  private async handleSwitchConversation(conversationId: string) {
    if (!this.canSwitchConversation()) return;
    await this.persistActiveConversation();
    const conversation = await this.conversationStore.switchConversation(conversationId);
    if (!conversation) {
      this.post({ type: 'error', text: 'Чат не найден.' });
      return;
    }
    this.activateConversation(conversation);
  }

  private async handleClearConversation() {
    if (!this.canSwitchConversation()) return;
    const cleared = await this.conversationStore.clearActiveConversation();
    this.changeStatesByConversation.delete(cleared.id);
    await this.changeStateStore.delete(cleared.id);
    this.checkpointStatesByConversation.delete(cleared.id);
    await this.checkpointStateStore.delete(cleared.id);
    this.activateConversation(cleared);
  }

  private async handleDeleteConversation(conversationId: string) {
    if (!conversationId) return;
    const deletingActive = conversationId === this.conversationStore.getActiveId();
    if (deletingActive && !this.canSwitchConversation()) return;

    await this.persistActiveConversation();
    const nextActive = await this.conversationStore.deleteConversation(conversationId);
    if (!nextActive) {
      this.post({ type: 'error', text: 'Чат не найден.' });
      return;
    }
    this.engineStore.delete(conversationId);
    this.changeStatesByConversation.delete(conversationId);
    await this.changeStateStore.delete(conversationId);
    this.checkpointStatesByConversation.delete(conversationId);
    await this.checkpointStateStore.delete(conversationId);

    if (deletingActive) {
      this.activateConversation(nextActive);
      return;
    }

    this.sendConversationSessions();
  }

  private activateConversation(conversation: StoredConversationSession) {
    this.activeConversationId = conversation.id;
    this.activeEngine = this.engineStore.getOrCreate(conversation.id, conversation.messages, conversation.agentRuntime);
    const appliedWorktree = applyWorktreeSession(conversation.agentRuntime?.worktreeSession || null);
    if (!appliedWorktree && conversation.agentRuntime?.worktreeSession) {
      this.activeEngine.setWorktreeSession(null);
    }
    this.changeController.refreshWorkspaceContext();
    const changeState = this.changeStatesByConversation.get(conversation.id) || this.changeStateStore.read(conversation.id);
    if (changeState) {
      this.changeStatesByConversation.set(conversation.id, changeState);
    }
    this.changeController.restoreState(changeState || null);
    this.chatHistory.splice(0, this.chatHistory.length, ...conversation.messages);
    this.chatArtifacts = Array.isArray(conversation.artifactEvents)
      ? conversation.artifactEvents.map((artifact) => clonePersistedArtifact(artifact))
      : [];
    this.chatRunController.restoreConversationState({
      messages: conversation.messages,
      suggestions: conversation.suggestions,
      suggestionsState: conversation.suggestionsState,
      suggestionsSummary: conversation.suggestionsSummary,
      traceRuns: conversation.traceRuns,
      artifactEvents: conversation.artifactEvents,
    });
    const checkpointState = this.checkpointStatesByConversation.get(conversation.id) || this.checkpointStateStore.read(conversation.id);
    if (checkpointState) {
      this.checkpointStatesByConversation.set(conversation.id, checkpointState);
    }
    this.checkpointController.restoreState(checkpointState || null);
    this.sendConversationSessions();
    this.sendActiveConversationState(true);
    this.sendRuntimeState();
    this.checkpointController.sendCheckpointsList();
  }

  private commitRevertBranchIfNeeded() {
    const committedBranch = this.checkpointController.commitRevertBranch();
    if (committedBranch) {
      this.scheduleChangeStatePersist();
      this.scheduleCheckpointStatePersist();
      this.post({ type: 'checkpointBranchCommitted', ...committedBranch });
    }
  }

  private scheduleChangeStatePersist() {
    const conversationId = this.activeConversationId;
    const state = this.changeController.snapshotState();
    this.changeStatesByConversation.set(conversationId, state);
    this.changePersistPayload = { conversationId, state };
    if (this.changePersistTimer) return;
    this.changePersistTimer = setTimeout(() => {
      const payload = this.changePersistPayload;
      this.changePersistTimer = null;
      this.changePersistPayload = null;
      if (!payload) return;
      void this.persistChangeStateNow(payload.conversationId, payload.state);
    }, 250);
  }

  private async persistChangeStateNow(conversationId: string, state: WorkspaceChangeControllerState) {
    this.changeStatesByConversation.set(conversationId, state);
    await this.changeStateStore.write(conversationId, state);
  }

  private scheduleCheckpointStatePersist() {
    const conversationId = this.activeConversationId;
    const state = this.checkpointController.snapshotState();
    this.checkpointStatesByConversation.set(conversationId, state);
    this.checkpointPersistPayload = { conversationId, state };
    if (this.checkpointPersistTimer) return;
    this.checkpointPersistTimer = setTimeout(() => {
      const payload = this.checkpointPersistPayload;
      this.checkpointPersistTimer = null;
      this.checkpointPersistPayload = null;
      if (!payload) return;
      void this.persistCheckpointStateNow(payload.conversationId, payload.state);
    }, 250);
  }

  private async persistCheckpointStateNow(conversationId: string, state: CheckpointControllerState) {
    this.checkpointStatesByConversation.set(conversationId, state);
    await this.checkpointStateStore.write(conversationId, state);
  }

  private syncActiveConversationEngine() {
    this.engineStore.sync(this.activeConversationId, this.chatHistory, this.activeEngine.snapshotRuntime());
  }

  private resetAgentEngines() {
    this.engineStore.clear();
    this.activeEngine = this.engineStore.getOrCreate(this.activeConversationId, this.chatHistory, null);
  }

  private async persistConversationRuntime(conversationId: string) {
    if (conversationId === this.activeConversationId) {
      await this.conversationStore.updateConversationRuntime(conversationId, this.activeEngine.snapshotRuntime());
      return;
    }

    const engine = this.engineStore.get(conversationId);
    if (!engine) return;
    await this.conversationStore.updateConversationRuntime(conversationId, engine.snapshotRuntime());
  }

  private async handleEngineRuntimeChanged(conversationId: string, kind: 'runtime' | 'progress' = 'runtime') {
    if (kind !== 'progress') {
      await this.persistConversationRuntime(conversationId);
    }
    if (conversationId === this.activeConversationId) {
      const appliedWorktree = applyWorktreeSession(this.activeEngine.snapshotRuntime().worktreeSession || null);
      if (!appliedWorktree && this.activeEngine.snapshotRuntime().worktreeSession) {
        this.activeEngine.setWorktreeSession(null);
      }
      this.changeController.refreshWorkspaceContext();
      this.sendRuntimeState();
      void this.sendTasksState();
    }
  }

  private sendRuntimeState() {
    const runtime = this.activeEngine.snapshotRuntime();
    const config = readConfig();
    this.post({
      type: 'runtimeState',
      mode: runtime.mode,
      awaitingPlanApproval: runtime.awaitingPlanApproval,
      pendingApproval: runtime.pendingApproval,
      pendingQuestion: runtime.pendingQuestion,
      todos: runtime.todos,
      progress: runtime.progress,
      sessionMemory: runtime.sessionMemory,
      autoApproval: config.autoApproval,
    });
  }

  private sendComposerPermissionsState() {
    this.post({
      type: 'composerPermissionsState',
      autoApproval: readConfig().autoApproval,
    });
  }

  private recordArtifactMessage(message: ExtensionToWebviewMessage): void {
    const artifact = toPersistedArtifact(message);
    if (!artifact) return;
    const runId = this.chatRunController.getActiveTraceRunId();
    if (runId && !artifact.runId) {
      artifact.runId = runId;
    }
    this.chatArtifacts.push(artifact);
    if (this.chatArtifacts.length > 240) {
      this.chatArtifacts = this.chatArtifacts.slice(-240);
    }
    this.scheduleArtifactPersist();
  }

  private scheduleArtifactPersist(): void {
    if (this.artifactPersistTimer) return;
    this.artifactPersistTimer = setTimeout(() => {
      this.artifactPersistTimer = null;
      void this.persistActiveConversation();
    }, 250);
  }

  private getTasksRootPath(): string {
    return getAgentWorkspaceRootPath()
      || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      || process.cwd();
  }

  private startTasksPolling(): void {
    this.stopTasksPolling();
    this.tasksPollTimer = setInterval(() => {
      void this.sendTasksState();
    }, 4000);
  }

  private stopTasksPolling(): void {
    if (!this.tasksPollTimer) return;
    clearInterval(this.tasksPollTimer);
    this.tasksPollTimer = null;
  }

  private async sendTasksState(): Promise<void> {
    if (!this.view || this.tasksRefreshInFlight) return;
    this.tasksRefreshInFlight = true;
    try {
      const rootPath = this.getTasksRootPath();
      const tasks = await listTaskRecords(rootPath);
      const activeTasks = tasks.filter(isActiveTask);
      const historyTasks = tasks.filter((task) => !isActiveTask(task));
      const activeCount = activeTasks.length;
      const totalCount = tasks.length;
      const activeShown = activeTasks.slice(0, 12);
      const historyShown = historyTasks.slice(0, Math.max(0, 12 - activeShown.length));
      const items = await Promise.all([...activeShown, ...historyShown].map((task) => this.toTaskMessage(task, rootPath)));
      const shownCount = items.length;
      const historyCount = Math.max(0, totalCount - activeCount);
      const summary = totalCount === 0
        ? 'Нет фоновых задач'
        : activeCount > 0
          ? historyCount > 0
            ? shownCount < totalCount
              ? `${activeCount} активных • ${historyCount} в истории • показано ${shownCount} из ${totalCount}`
              : `${activeCount} активных • ${historyCount} в истории`
            : `${activeCount} активных задач`
          : shownCount < totalCount
            ? `${totalCount} задач в истории • показано ${shownCount}`
            : `${totalCount} задач в истории`;

      this.post({
        type: 'tasksState',
        tasks: items,
        summary,
        activeCount,
        totalCount,
        shownCount,
        updatedAt: Date.now(),
      });
    } finally {
      this.tasksRefreshInFlight = false;
    }
  }

  private async toTaskMessage(task: AgentTaskRecord, rootPath: string) {
    const preview = await buildTaskPreview(task);
    return {
      id: task.id,
      kind: task.kind,
      subject: task.subject,
      description: task.description,
      ...(task.activeForm ? { activeForm: task.activeForm } : {}),
      status: task.status,
      ...(task.command ? { command: task.command } : {}),
      ...(task.cwd ? { cwd: task.cwd } : {}),
      ...(task.note ? { note: task.note } : {}),
      taskFilePath: toTaskWorkspaceRelativePath(getTaskFilePath(task.id, rootPath), rootPath),
      ...(task.stdoutPath ? { stdoutPath: toTaskWorkspaceRelativePath(task.stdoutPath, rootPath) } : {}),
      ...(task.stderrPath ? { stderrPath: toTaskWorkspaceRelativePath(task.stderrPath, rootPath) } : {}),
      ...(preview.stdout ? { stdoutPreview: preview.stdout } : {}),
      ...(preview.stderr ? { stderrPreview: preview.stderr } : {}),
      ...(typeof task.exitCode === 'number' ? { exitCode: task.exitCode } : {}),
      ...(task.signal !== undefined ? { signal: task.signal || null } : {}),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      ...(task.startedAt ? { startedAt: task.startedAt } : {}),
      ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
      ...(task.stopRequestedAt ? { stopRequestedAt: task.stopRequestedAt } : {}),
      ...(preview.combined ? { preview: preview.combined } : {}),
    };
  }
}

function toPersistedArtifact(message: ExtensionToWebviewMessage): PersistedChatArtifact | null {
  if (message.type === 'status') {
    return { kind: 'statusMessage', payload: { text: sanitizeArtifactPayload(message.text) as string } };
  }

  if (message.type === 'error') {
    return { kind: 'errorMessage', payload: { text: sanitizeArtifactPayload(message.text) as string } };
  }

  if (message.type === 'fileChange') {
    return {
      kind: 'fileChange',
      payload: {
        changeId: message.changeId,
        ...(message.step !== undefined ? { step: String(message.step) } : {}),
        filePath: message.filePath,
        changeType: message.changeType,
        tool: message.tool,
        ...(message.summary ? { summary: message.summary } : {}),
        ...(message.stats ? { stats: { ...message.stats } } : {}),
        oldSnippet: message.oldSnippet,
        newSnippet: message.newSnippet,
        cellIdx: message.cellIdx,
        diffLines: Array.isArray(message.diffLines) ? message.diffLines.map((line) => ({ ...line })) : [],
      },
    };
  }

  if (message.type === 'changeAccepted' || message.type === 'changeRejected') {
    return {
      kind: 'changeStatus',
      payload: {
        type: message.type,
        changeId: message.changeId,
        ...(message.error ? { error: message.error } : {}),
      },
    };
  }

  if (message.type === 'approvalRequest') {
    return { kind: 'approvalRequest', payload: sanitizeArtifactPayload(message.request) as any };
  }

  if (message.type === 'approvalResolved') {
    return { kind: 'approvalResolved', payload: sanitizeArtifactPayload(message.result) as any };
  }

  if (message.type === 'questionRequest') {
    return { kind: 'questionRequest', payload: sanitizeArtifactPayload(message.request) as any };
  }

  if (message.type === 'questionResolved') {
    return { kind: 'questionResolved', payload: sanitizeArtifactPayload(message.result) as any };
  }

  if (message.type === 'checkpoint') {
    return { kind: 'checkpoint', payload: sanitizeArtifactPayload(message) as any };
  }

  if (message.type === 'checkpointUpdated') {
    return { kind: 'checkpointUpdated', payload: sanitizeArtifactPayload(message) as any };
  }

  if (message.type === 'checkpointReverted') {
    return { kind: 'checkpointReverted', payload: sanitizeArtifactPayload(message) as any };
  }

  if (message.type === 'undoRevertDone') {
    return { kind: 'undoRevertDone', payload: sanitizeArtifactPayload(message) as any };
  }

  if (message.type === 'checkpointBranchCommitted') {
    return { kind: 'checkpointBranchCommitted', payload: sanitizeArtifactPayload(message) as any };
  }

  return null;
}

function clonePersistedArtifact(artifact: PersistedChatArtifact): PersistedChatArtifact {
  return {
    kind: artifact.kind,
    ...(typeof artifact.runId === 'string' && artifact.runId.trim() ? { runId: artifact.runId.trim().slice(0, 80) } : {}),
    payload: sanitizeArtifactPayload(artifact.payload) as any,
  };
}

function sanitizeArtifactPayload(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitizeArtifactPayload(item));
  if (typeof value !== 'object') return String(value).slice(0, 400);
  const output: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 80)) {
    output[key] = sanitizeArtifactPayload(entry);
  }
  return output;
}

function shouldPersistCheckpointState(message: ExtensionToWebviewMessage): boolean {
  return message.type === 'fileChange'
    || message.type === 'checkpoint'
    || message.type === 'checkpointUpdated'
    || message.type === 'checkpointReverted'
    || message.type === 'undoRevertDone'
    || message.type === 'checkpointBranchCommitted';
}

function shouldPersistChangeState(message: ExtensionToWebviewMessage): boolean {
  return message.type === 'fileChange'
    || message.type === 'changeAccepted'
    || message.type === 'changeRejected'
    || message.type === 'checkpointReverted'
    || message.type === 'undoRevertDone';
}

function isActiveTask(task: AgentTaskRecord): boolean {
  return task.status === 'pending' || task.status === 'in_progress';
}

async function buildTaskPreview(task: AgentTaskRecord): Promise<{
  stdout?: string;
  stderr?: string;
  combined?: string;
}> {
  const stdout = await readTaskTail(task.stdoutPath);
  const stderr = await readTaskTail(task.stderrPath);
  const parts = [
    stdout ? `stdout\n${stdout}` : '',
    stderr ? `stderr\n${stderr}` : '',
  ].filter(Boolean);
  return {
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {}),
    ...(parts.length > 0 ? { combined: parts.join('\n\n') } : {}),
  };
}

async function readTaskTail(filePath: string | undefined, maxBytes = 3200): Promise<string> {
  if (!filePath) return '';
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(filePath, 'r');
    const stat = await handle.stat();
    const size = Number(stat.size || 0);
    const start = Math.max(0, size - maxBytes);
    const length = Math.max(0, size - start);
    if (length === 0) return '';
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const text = buffer.toString('utf8').trim();
    const lines = text.split('\n');
    return lines.slice(-12).join('\n').trim();
  } catch {
    return '';
  } finally {
    try {
      await handle?.close();
    } catch {
      // Ignore close errors.
    }
  }
}
