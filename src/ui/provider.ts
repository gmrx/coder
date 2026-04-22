import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
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
import {
  ConversationStore,
  type ConversationSource,
  type ConversationSummaryDto,
  type StoredConversationSession,
} from './conversations';
import { AiOriginalContentProvider } from './originalContentProvider';
import { ApprovalController } from './approvals';
import { QuestionController } from './questions';
import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from './protocol/messages';
import type { JiraTaskContextViewState } from './protocol/conversations';
import type { PersistedChatArtifact } from './protocol/artifacts';
import {
  buildSkippedModelTests,
  normalizeSettingsPayload,
  runSelectedModelTests,
  testSettingsConnection,
  type SettingsPayload,
} from './settingsModels';
import { inspectMcpDraft } from './mcpInspector';
import {
  checkJiraSettings,
  getSavedJiraTaskDetails,
  listSavedJiraProjectTasks,
  listSavedJiraProjects,
  type JiraTaskDetails,
  type JiraProjectOption,
  type JiraTaskSummary,
} from './jiraSettings';
import {
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
  private settingsModelsLoadSeq = 0;
  private selectedJiraProjectKey = '';
  private jiraProjects: JiraProjectOption[] = [];
  private jiraProjectTasks = new Map<string, JiraTaskSummary[]>();
  private jiraAuthOk = false;
  private jiraAuthUser = '';
  private jiraError = '';
  private jiraProjectsLoading = false;
  private jiraTasksLoading = false;
  private jiraTasksError = '';
  private jiraRefreshSeq = 0;
  private readonly jiraTaskContexts = new Map<string, JiraTaskContextSnapshot>();
  private readonly jiraTaskContextLoads = new Map<string, Promise<JiraTaskContextSnapshot>>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    originalProvider: AiOriginalContentProvider,
  ) {
    this.conversationStore = new ConversationStore(context.workspaceState);
    this.selectedJiraProjectKey = normalizeJiraKey(context.workspaceState.get<string>('aiAssistant.selectedJiraProjectKey') || '');
    this.engineStore = new ConversationAgentEngineStore((conversationId, kind) => this.handleEngineRuntimeChanged(conversationId, kind));
    this.checkpointStateStore = new CheckpointStateStore(context);
    this.changeStateStore = new ChangeStateStore(context);
    const activeConversation = this.conversationStore.getActiveConversation();
    this.activeConversationId = activeConversation.id;
    const initialMessages = activeConversation.source.type === 'jira'
      ? filterGeneratedJiraContextChatMessages(activeConversation.messages, activeConversation.source.issueKey)
      : activeConversation.messages;
    const initialArtifacts = activeConversation.source.type === 'jira'
      ? filterJiraContextStatusArtifacts(activeConversation.artifactEvents, activeConversation.source.issueKey)
      : activeConversation.artifactEvents;
    this.chatHistory.push(...initialMessages);
    this.chatArtifacts = Array.isArray(initialArtifacts)
      ? initialArtifacts.map((artifact) => clonePersistedArtifact(artifact))
      : [];
    if (initialMessages.length !== activeConversation.messages.length) {
      void this.conversationStore.removeGeneratedJiraContextMessages(activeConversation.id);
    }
    this.activeEngine = this.engineStore.getOrCreate(activeConversation.id, initialMessages, activeConversation.agentRuntime);
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
      getConversationContext: () => this.getActiveConversationContext(),
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
        void this.refreshJiraConversationProjects();
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
      case 'refreshJiraProjects':
        await this.refreshJiraConversationProjects({ force: true });
        return;
      case 'selectJiraProject':
        await this.handleSelectJiraProject(message.projectKey || '');
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
      case 'checkJira':
        await this.handleCheckJira(message.data || {});
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
    const modelSelectionIssue = this.pendingModelSelectionIssue || null;
    const settingsSection = this.pendingSettingsSection || (modelSelectionIssue ? 'models' : undefined);
    const highlightModelSelectionIssue = this.highlightPendingModelSelectionIssue;
    const modelsLoadSeq = ++this.settingsModelsLoadSeq;
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
        models: [],
        settingsSection,
        modelSelectionIssue,
        highlightModelSelectionIssue,
      },
    });

    if (config.apiBaseUrl && config.apiKey) {
      void this.sendSettingsModels(config, modelsLoadSeq);
    }
  }

  private async sendSettingsModels(config: SettingsPayload, seq: number): Promise<void> {
    const result = await testSettingsConnection(config);
    if (seq !== this.settingsModelsLoadSeq) return;
    this.postSettings({
      type: 'connectionResult',
      silent: true,
      ...result,
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
        jiraBaseUrl: config.jiraBaseUrl,
        jiraUsername: config.jiraUsername,
        jiraPassword: config.jiraPassword,
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
        void this.refreshJiraConversationProjects({ force: true });
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

  private async handleCheckJira(data: SettingsPayload) {
    this.postSettings({
      type: 'jiraCheckResult',
      ...(await checkJiraSettings(data)),
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
    const jiraMode = !!this.selectedJiraProjectKey;
    this.post({
      type: 'conversationSessions',
      activeId: this.getSessionListActiveId(),
      sessions: jiraMode
        ? this.buildJiraConversationSummaries()
        : this.conversationStore.listSummaries({ type: 'free' }),
      mode: jiraMode ? 'jira' : 'free',
      jira: this.buildJiraConversationScopeState(),
    });
  }

  private sendActiveConversationState(replace: boolean) {
    const active = this.conversationStore.getActiveConversation();
    const runtime = this.activeEngine.snapshotRuntime();
    const config = readConfig();
    const pendingChangeIds = Array.from(this.changeController.getPendingChanges().keys());
    const messages = active.source.type === 'jira'
      ? filterGeneratedJiraContextChatMessages(active.messages, active.source.issueKey)
      : active.messages;
    const artifactEvents = active.source.type === 'jira'
      ? filterJiraContextStatusArtifacts(active.artifactEvents, active.source.issueKey)
      : active.artifactEvents;
    this.post({
      type: 'conversationState',
      sessionId: active.id,
      title: active.title,
      source: active.source,
      jiraContext: this.buildJiraContextView(active.source),
      replace,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      suggestions: active.suggestions,
      suggestionsState: active.suggestionsState,
      suggestionsSummary: active.suggestionsSummary,
      traceRuns: active.traceRuns,
      artifactEvents,
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

  private getSessionListActiveId(): string {
    const active = this.conversationStore.getActiveConversation();
    if (!this.selectedJiraProjectKey) {
      return active.source.type === 'free' ? active.id : '';
    }
    return active.source.type === 'jira'
      && normalizeJiraKey(active.source.projectKey) === this.selectedJiraProjectKey
      ? active.id
      : '';
  }

  private buildJiraConversationScopeState() {
    const selectedProject = this.getSelectedJiraProject();
    return {
      selectedProjectKey: this.selectedJiraProjectKey,
      selectedProjectName: selectedProject?.name || '',
      authOk: this.jiraAuthOk,
      authUser: this.jiraAuthUser,
      error: this.jiraError,
      projectsLoading: this.jiraProjectsLoading,
      tasksLoading: this.jiraTasksLoading,
      tasksError: this.jiraTasksError,
      projects: this.jiraProjects.map((project) => ({ ...project })),
    };
  }

  private buildJiraConversationSummaries(): ConversationSummaryDto[] {
    const selectedProject = this.getSelectedJiraProject();
    const tasks = this.jiraProjectTasks.get(this.selectedJiraProjectKey) || [];
    return tasks.map((task) => {
      const existing = this.conversationStore.findJiraConversation(task.key);
      const source = this.buildJiraConversationSource(task, selectedProject);
      return {
        id: existing?.id || buildVirtualJiraConversationId(this.selectedJiraProjectKey, task.key),
        title: `${task.key} • ${task.title || 'Задача Jira'}`,
        source,
        updatedAt: existing?.updatedAt || task.updatedAt || Date.now(),
        messageCount: existing?.messages.length || 0,
        preview: existing ? buildConversationPreview(existing.messages) : (task.description || task.url || 'Задача Jira'),
        ...(existing ? {} : { virtual: true }),
      };
    });
  }

  private getSelectedJiraProject(): JiraProjectOption | null {
    const key = this.selectedJiraProjectKey;
    if (!key) return null;
    return this.jiraProjects.find((project) => normalizeJiraKey(project.key) === key) || null;
  }

  private buildJiraConversationSource(task: JiraTaskSummary, project: JiraProjectOption | null): ConversationSource {
    const projectKey = normalizeJiraKey(project?.key || this.selectedJiraProjectKey || task.key.split('-')[0]);
    return {
      type: 'jira',
      projectKey,
      projectName: project?.name || projectKey,
      issueKey: normalizeJiraKey(task.key),
      issueTitle: task.title || task.key,
      issueUrl: task.url || '',
      issueStatus: task.status || '',
      issueDescription: task.description || '',
    };
  }

  private buildJiraContextView(source: ConversationSource): JiraTaskContextViewState | null {
    if (source.type !== 'jira') return null;
    const key = normalizeJiraKey(source.issueKey);
    const context = this.jiraTaskContexts.get(key) || null;
    const loading = this.jiraTaskContextLoads.has(key);
    const details = context?.details || null;
    const meta = [
      details?.type ? `Тип: ${details.type}` : '',
      details?.priority ? `Приоритет: ${details.priority}` : '',
      details?.resolution ? `Решение: ${details.resolution}` : '',
      details?.assignee ? `Исполнитель: ${details.assignee}` : '',
      details?.reporter ? `Автор: ${details.reporter}` : '',
      details?.dueDate ? `Срок: ${details.dueDate}` : '',
      details?.updated ? `Обновлена: ${details.updated}` : '',
    ].filter(Boolean);

    const commits = context ? buildJiraCommitViews(context.git, source.issueKey) : [];
    return {
      issueKey: source.issueKey,
      title: context?.source.issueTitle || source.issueTitle,
      project: `${context?.source.projectKey || source.projectKey}${(context?.source.projectName || source.projectName) ? ` • ${context?.source.projectName || source.projectName}` : ''}`,
      status: context?.source.issueStatus || source.issueStatus,
      url: context?.source.issueUrl || source.issueUrl,
      description: context?.source.issueDescription || source.issueDescription,
      updatedAt: context?.updatedAt || 0,
      loading,
      error: context?.detailError || context?.git.error || '',
      meta,
      sections: buildJiraContextViewSections(details),
      repositoriesChecked: context?.git.repositories.length || 0,
      commits,
    };
  }

  private async getActiveConversationContext(): Promise<string> {
    const active = this.conversationStore.getActiveConversation();
    const source = active.source;
    if (source.type !== 'jira') return '';
    this.stripGeneratedJiraContextFromActiveHistory(source.issueKey);
    this.stripJiraContextStatusArtifacts(source.issueKey);
    const context = await this.getJiraTaskContext(active, { allowCached: true });
    return buildJiraTaskExternalContext(context);
  }

  private stripGeneratedJiraContextFromActiveHistory(issueKey: string): void {
    const nextHistory = this.chatHistory.filter((message) =>
      !isGeneratedJiraContextChatMessage(message, issueKey),
    );
    if (nextHistory.length === this.chatHistory.length) return;
    this.chatHistory.splice(0, this.chatHistory.length, ...nextHistory);
    this.syncActiveConversationEngine();
    void this.persistActiveConversation();
  }

  private stripJiraContextStatusArtifacts(issueKey: string): void {
    const key = normalizeJiraKey(issueKey);
    const nextArtifacts = this.chatArtifacts.filter((artifact) =>
      !isGeneratedJiraContextStatusArtifact(artifact, key),
    );
    if (nextArtifacts.length === this.chatArtifacts.length) return;
    this.chatArtifacts = nextArtifacts;
    this.scheduleArtifactPersist();
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
    if (this.selectedJiraProjectKey) {
      this.post({ type: 'error', text: 'В Jira-проекте чат создаётся выбором задачи из списка. Чтобы создать обычный чат, выберите режим "Обычный чат".' });
      return;
    }
    await this.persistActiveConversation();
    const created = await this.conversationStore.createConversation({ type: 'free' });
    this.activateConversation(created);
  }

  private async handleSwitchConversation(conversationId: string) {
    if (!this.canSwitchConversation()) return;
    const virtualJira = parseVirtualJiraConversationId(conversationId);
    if (virtualJira) {
      await this.openJiraTaskConversation(virtualJira.issueKey);
      return;
    }
    await this.persistActiveConversation();
    const conversation = await this.conversationStore.switchConversation(conversationId);
    if (!conversation) {
      this.post({ type: 'error', text: 'Чат не найден.' });
      return;
    }
    if (conversation.source.type === 'jira') {
      const cleaned = await this.conversationStore.removeGeneratedJiraContextMessages(conversation.id);
      const nextConversation = cleaned || conversation;
      this.activateConversation(nextConversation);
      if (nextConversation.source.type === 'jira') {
        this.stripJiraContextStatusArtifacts(nextConversation.source.issueKey);
      }
      void this.refreshJiraTaskContext(nextConversation, { force: true });
      return;
    }
    this.activateConversation(conversation);
  }

  private async openJiraTaskConversation(issueKey: string) {
    const key = normalizeJiraKey(issueKey);
    if (!key) return;
    await this.persistActiveConversation();
    const existing = this.conversationStore.findJiraConversation(key);
    if (existing) {
      const cleaned = await this.conversationStore.removeGeneratedJiraContextMessages(existing.id);
      const conversation = await this.conversationStore.switchConversation(cleaned?.id || existing.id);
      if (conversation) {
        this.activateConversation(conversation);
        this.stripJiraContextStatusArtifacts(conversation.source.type === 'jira' ? conversation.source.issueKey : key);
        void this.refreshJiraTaskContext(conversation, { force: true });
      }
      return;
    }

    const task = this.findCachedJiraTask(key);
    if (!task) {
      this.post({ type: 'error', text: `Задача Jira ${key} не найдена в текущем списке проекта.` });
      return;
    }
    const created = await this.conversationStore.createConversation(this.buildJiraConversationSource(task, this.getSelectedJiraProject()));
    this.activateConversation(created);
    this.stripJiraContextStatusArtifacts(created.source.type === 'jira' ? created.source.issueKey : key);
    void this.refreshJiraTaskContext(created, { force: true });
  }

  private async loadJiraTaskContext(source: Extract<ConversationSource, { type: 'jira' }>): Promise<{
    source: Extract<ConversationSource, { type: 'jira' }>;
    details: JiraTaskDetails | null;
    error: string;
  }> {
    const result = await getSavedJiraTaskDetails(source.issueKey);
    if (!result.ok || !result.task) {
      return { source, details: null, error: result.error };
    }

    const task = result.task;
    const nextSource: Extract<ConversationSource, { type: 'jira' }> = {
      type: 'jira',
      projectKey: normalizeJiraKey(task.projectKey || source.projectKey),
      projectName: task.projectName || source.projectName,
      issueKey: normalizeJiraKey(task.key || source.issueKey),
      issueTitle: task.title || source.issueTitle,
      issueUrl: task.url || source.issueUrl,
      issueStatus: task.status || source.issueStatus,
      issueDescription: task.description || source.issueDescription,
    };
    return { source: nextSource, details: task, error: '' };
  }

  private async getJiraTaskContext(
    conversation: StoredConversationSession,
    options: { allowCached?: boolean; force?: boolean } = {},
  ): Promise<JiraTaskContextSnapshot> {
    if (conversation.source.type !== 'jira') {
      return buildFallbackJiraTaskContext({ type: 'jira', projectKey: '', projectName: '', issueKey: '', issueTitle: '', issueUrl: '', issueStatus: '', issueDescription: '' });
    }

    const key = normalizeJiraKey(conversation.source.issueKey);
    const cached = this.jiraTaskContexts.get(key);
    const cacheFresh = cached && Date.now() - cached.updatedAt < JIRA_TASK_CONTEXT_TTL_MS;
    if (options.allowCached && cacheFresh && !options.force) {
      return cached;
    }

    return await this.refreshJiraTaskContext(conversation, { force: options.force || !cached });
  }

  private async refreshJiraTaskContext(
    conversation: StoredConversationSession,
    options: { force?: boolean } = {},
  ): Promise<JiraTaskContextSnapshot> {
    if (conversation.source.type !== 'jira') {
      return buildFallbackJiraTaskContext({ type: 'jira', projectKey: '', projectName: '', issueKey: '', issueTitle: '', issueUrl: '', issueStatus: '', issueDescription: '' });
    }

    const key = normalizeJiraKey(conversation.source.issueKey);
    const cached = this.jiraTaskContexts.get(key);
    const ageMs = cached ? Date.now() - cached.updatedAt : Number.POSITIVE_INFINITY;
    if (cached && (!options.force || ageMs < JIRA_TASK_CONTEXT_FORCE_DEBOUNCE_MS) && ageMs < JIRA_TASK_CONTEXT_TTL_MS) {
      return cached;
    }

    const existingLoad = this.jiraTaskContextLoads.get(key);
    if (existingLoad) return await existingLoad;

    const load = this.loadJiraTaskContextSnapshot(conversation.source);
    this.jiraTaskContextLoads.set(key, load);
    if (conversation.id === this.activeConversationId) {
      this.sendActiveConversationState(false);
    }
    try {
      const context = await load;
      this.jiraTaskContexts.set(key, context);
      const updated = await this.conversationStore.updateConversationSource(conversation.id, context.source);
      if (updated && conversation.id === this.activeConversationId) {
        this.sendConversationSessions();
        this.sendActiveConversationState(false);
      } else {
        this.sendConversationSessions();
      }
      return context;
    } finally {
      this.jiraTaskContextLoads.delete(key);
    }
  }

  private async loadJiraTaskContextSnapshot(source: Extract<ConversationSource, { type: 'jira' }>): Promise<JiraTaskContextSnapshot> {
    try {
      const taskContext = await this.loadJiraTaskContext(source);
      const gitContext = await readIssueGitContext(taskContext.source.issueKey, this.getGitSearchRoots());
      return {
        source: taskContext.source,
        details: taskContext.details,
        detailError: taskContext.error,
        git: gitContext,
        updatedAt: Date.now(),
      };
    } catch (error: any) {
      return {
        source,
        details: null,
        detailError: formatJiraTaskContextError(error),
        git: {
          searchRoots: this.getGitSearchRoots(),
          repositories: [],
          error: formatJiraTaskContextError(error),
        },
        updatedAt: Date.now(),
      };
    }
  }

  private getGitSearchRoots(): string[] {
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders || []) {
      if (folder?.uri?.fsPath) {
        roots.add(path.resolve(folder.uri.fsPath));
      }
    }
    roots.add(path.resolve(this.getTasksRootPath()));
    return [...roots].filter(Boolean);
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
    if (parseVirtualJiraConversationId(conversationId)) {
      this.post({ type: 'status', text: 'Задача Jira остаётся в списке. Истории чата для неё пока нет.' });
      return;
    }
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

  private async handleSelectJiraProject(projectKey: string) {
    if (!this.canSwitchConversation()) return;
    await this.persistActiveConversation();
    const nextKey = normalizeJiraKey(projectKey);
    this.selectedJiraProjectKey = nextKey;
    this.jiraTasksError = '';
    await this.context.workspaceState.update('aiAssistant.selectedJiraProjectKey', nextKey || undefined);

    if (!nextKey) {
      this.jiraTasksLoading = false;
      await this.ensureFreeConversationActive();
      this.sendConversationSessions();
      return;
    }

    this.sendConversationSessions();
    await this.refreshJiraConversationProjects({ force: false, openFirstTask: true });
  }

  private async ensureFreeConversationActive() {
    const active = this.conversationStore.getActiveConversation();
    if (active.source.type === 'free') {
      this.activateConversation(active);
      return;
    }

    const free = this.conversationStore.listSummaries({ type: 'free' })[0];
    const next = free
      ? await this.conversationStore.switchConversation(free.id)
      : await this.conversationStore.createConversation({ type: 'free' });
    if (next) {
      this.activateConversation(next);
    }
  }

  private async ensureJiraConversationActive(openFirstTask: boolean) {
    if (!this.selectedJiraProjectKey) return;
    const active = this.conversationStore.getActiveConversation();
    if (
      active.source.type === 'jira'
      && normalizeJiraKey(active.source.projectKey) === this.selectedJiraProjectKey
    ) {
      const cleaned = await this.conversationStore.removeGeneratedJiraContextMessages(active.id);
      const nextActive = cleaned || active;
      this.activateConversation(nextActive);
      if (nextActive.source.type === 'jira') {
        this.stripJiraContextStatusArtifacts(nextActive.source.issueKey);
      }
      void this.refreshJiraTaskContext(nextActive, { force: false });
      return;
    }
    if (!openFirstTask) return;
    const firstTask = (this.jiraProjectTasks.get(this.selectedJiraProjectKey) || [])[0];
    if (firstTask) {
      await this.openJiraTaskConversation(firstTask.key);
    }
  }

  private findCachedJiraTask(issueKey: string): JiraTaskSummary | null {
    const key = normalizeJiraKey(issueKey);
    for (const task of this.jiraProjectTasks.get(this.selectedJiraProjectKey) || []) {
      if (normalizeJiraKey(task.key) === key) return task;
    }
    return null;
  }

  private async refreshJiraConversationProjects(options: { force?: boolean; openFirstTask?: boolean } = {}) {
    if (this.jiraProjectsLoading && !options.force) return;
    const seq = ++this.jiraRefreshSeq;
    this.jiraProjectsLoading = true;
    this.jiraError = '';
    this.sendConversationSessions();

    const result = await listSavedJiraProjects();
    if (seq !== this.jiraRefreshSeq) return;

    this.jiraProjectsLoading = false;
    this.jiraAuthOk = result.ok;
    this.jiraAuthUser = result.authUser || '';
    this.jiraError = result.ok ? '' : result.error;
    this.jiraProjects = result.projects || [];

    if (this.selectedJiraProjectKey && !result.ok) {
      this.selectedJiraProjectKey = '';
      await this.context.workspaceState.update('aiAssistant.selectedJiraProjectKey', undefined);
      await this.ensureFreeConversationActive();
    }

    if (this.selectedJiraProjectKey && !this.jiraProjects.some((project) => normalizeJiraKey(project.key) === this.selectedJiraProjectKey)) {
      this.selectedJiraProjectKey = '';
      await this.context.workspaceState.update('aiAssistant.selectedJiraProjectKey', undefined);
      await this.ensureFreeConversationActive();
    }

    this.sendConversationSessions();
    if (this.selectedJiraProjectKey && result.ok) {
      await this.refreshSelectedJiraProjectTasks({ openFirstTask: !!options.openFirstTask });
      return;
    }

    if (!this.selectedJiraProjectKey) {
      this.jiraTasksLoading = false;
      this.jiraTasksError = '';
    }
    this.sendConversationSessions();
  }

  private async refreshSelectedJiraProjectTasks(options: { openFirstTask?: boolean } = {}) {
    const projectKey = this.selectedJiraProjectKey;
    if (!projectKey) return;
    this.jiraTasksLoading = true;
    this.jiraTasksError = '';
    this.sendConversationSessions();

    const result = await listSavedJiraProjectTasks(projectKey, 100);
    if (normalizeJiraKey(result.projectKey) !== this.selectedJiraProjectKey) return;

    this.jiraTasksLoading = false;
    this.jiraAuthOk = result.ok;
    this.jiraAuthUser = result.authUser || this.jiraAuthUser;
    this.jiraError = result.ok ? '' : result.error;
    this.jiraTasksError = result.ok ? '' : result.error;
    this.jiraProjectTasks.set(projectKey, result.tasks || []);
    this.sendConversationSessions();
    if (result.ok) {
      await this.ensureJiraConversationActive(!!options.openFirstTask);
    }
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
    const artifactEvents = conversation.source.type === 'jira'
      ? filterJiraContextStatusArtifacts(conversation.artifactEvents, conversation.source.issueKey)
      : conversation.artifactEvents;
    this.chatArtifacts = Array.isArray(artifactEvents)
      ? artifactEvents.map((artifact) => clonePersistedArtifact(artifact))
      : [];
    if (artifactEvents.length !== conversation.artifactEvents.length) {
      this.scheduleArtifactPersist();
    }
    this.chatRunController.restoreConversationState({
      messages: conversation.messages,
      suggestions: conversation.suggestions,
      suggestionsState: conversation.suggestionsState,
      suggestionsSummary: conversation.suggestionsSummary,
      traceRuns: conversation.traceRuns,
      artifactEvents,
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
    if (runId && !artifact.runId && artifact.kind !== 'changeMetrics') {
      artifact.runId = runId;
    }
    if (artifact.kind === 'changeMetrics') {
      const existingIndex = this.chatArtifacts.findIndex((item) =>
        item.kind === 'changeMetrics',
      );
      const latestArtifact: PersistedChatArtifact = {
        kind: 'changeMetrics',
        payload: normalizeChangeMetricsPayload(artifact.payload),
      };
      if (existingIndex >= 0) {
        this.chatArtifacts[existingIndex] = latestArtifact;
        this.scheduleArtifactPersist();
        return;
      }
      this.chatArtifacts.push(latestArtifact);
      this.scheduleArtifactPersist();
      return;
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

function normalizeJiraKey(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function buildVirtualJiraConversationId(projectKey: string, issueKey: string): string {
  return `jira:${encodeURIComponent(normalizeJiraKey(projectKey))}:${encodeURIComponent(normalizeJiraKey(issueKey))}`;
}

function parseVirtualJiraConversationId(value: string): { projectKey: string; issueKey: string } | null {
  const match = String(value || '').match(/^jira:([^:]+):([^:]+)$/);
  if (!match) return null;
  return {
    projectKey: normalizeJiraKey(decodeURIComponent(match[1] || '')),
    issueKey: normalizeJiraKey(decodeURIComponent(match[2] || '')),
  };
}

function buildConversationPreview(messages: ChatMessage[]): string {
  const last = [...(Array.isArray(messages) ? messages : [])].reverse().find((message) => message.content.trim());
  if (!last) return 'История чата пока пуста.';
  return last.content.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function isGeneratedJiraContextChatMessage(message: ChatMessage, issueKey: string): boolean {
  if (!message || message.role !== 'assistant') return false;
  const key = normalizeJiraKey(issueKey);
  const content = String(message.content || '').trim();
  return content.startsWith(`Контекст Jira-задачи ${key}`)
    && content.includes(`Git-контекст по ${key}:`);
}

function filterGeneratedJiraContextChatMessages(messages: ChatMessage[], issueKey: string): ChatMessage[] {
  return (Array.isArray(messages) ? messages : []).filter((message) =>
    !isGeneratedJiraContextChatMessage(message, issueKey),
  );
}

function isGeneratedJiraContextStatusArtifact(artifact: PersistedChatArtifact, issueKey: string): boolean {
  if (!artifact || artifact.kind !== 'statusMessage') return false;
  const key = normalizeJiraKey(issueKey);
  const text = String(artifact.payload?.text || '').trim();
  return text === `Обновляю контекст задачи ${key}...`;
}

function filterJiraContextStatusArtifacts(artifacts: PersistedChatArtifact[], issueKey: string): PersistedChatArtifact[] {
  return (Array.isArray(artifacts) ? artifacts : []).filter((artifact) =>
    !isGeneratedJiraContextStatusArtifact(artifact, issueKey),
  );
}

type JiraConversationSource = Extract<ConversationSource, { type: 'jira' }>;

const JIRA_TASK_CONTEXT_TTL_MS = 2 * 60 * 1000;
const JIRA_TASK_CONTEXT_FORCE_DEBOUNCE_MS = 15 * 1000;

interface JiraTaskContextSnapshot {
  source: JiraConversationSource;
  details: JiraTaskDetails | null;
  detailError: string;
  git: IssueGitContext;
  updatedAt: number;
}

interface GitBranchRef {
  name: string;
  type: 'local' | 'remote';
}

interface IssueCommitMatch {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  subject: string;
  branches: GitBranchRef[];
}

interface IssueRepositoryGitContext {
  rootPath: string;
  currentBranch: string;
  commits: IssueCommitMatch[];
  error: string;
}

interface IssueGitContext {
  searchRoots: string[];
  repositories: IssueRepositoryGitContext[];
  error: string;
}

function buildJiraTaskExternalContext(context: JiraTaskContextSnapshot): string {
  return [
    'Текущий чат привязан к Jira-задаче. Этот блок является скрытым обновляемым контекстом, а не сообщением из истории чата.',
    'Если пользователь говорит "эта задача", "текущая задача" или "тикет", речь о задаче ниже.',
    'Важно: Jira-задача описывает цель, но ответ по реализации должен опираться на текущую кодовую базу workspace.',
    'Если пользователь просит изучить, спроектировать или реализовать текущую задачу, сначала проверь существующую реализацию через поиск/чтение файлов. Не предлагай создавать Jira-клиент, настройки, tools или chat-интеграцию, пока не проверил, что они действительно отсутствуют.',
    'Для Jira-задач особенно проверяй существующие места по словам: Jira, jiraBaseUrl, jiraSettings, jira_get_task, jira_search_tasks, ConversationSource, project tasks, task context.',
    'В итоговом ответе не заявляй "отсутствует" или "нужно создать", если это не подтверждено прочитанными файлами текущего запуска; лучше называй конкретные файлы, которые уже есть и что в них надо менять.',
    `Контекст обновлён: ${new Date(context.updatedAt).toISOString()}`,
    '',
    buildJiraInitialContextMessage(context.source, context.details, context.detailError, context.git),
    '',
    `Для свежих данных по этой задаче используй jira_get_task с key="${context.source.issueKey}". Для задач текущего проекта используй jira_search_tasks с project="${context.source.projectKey}".`,
  ].filter(Boolean).join('\n');
}

function buildFallbackJiraTaskContext(source: JiraConversationSource): JiraTaskContextSnapshot {
  return {
    source,
    details: null,
    detailError: '',
    git: {
      searchRoots: [],
      repositories: [],
      error: '',
    },
    updatedAt: Date.now(),
  };
}

function buildJiraCommitViews(git: IssueGitContext, issueKey: string): JiraTaskContextViewState['commits'] {
  const output: JiraTaskContextViewState['commits'] = [];
  for (const repo of git.repositories) {
    for (const commit of repo.commits) {
      const branchWithCommit = chooseBranchWithCommit([commit], repo.currentBranch);
      const currentHasCommit = repo.currentBranch
        ? commit.branches.some((branch) => branchMatchesCurrent(branch.name, repo.currentBranch))
        : false;
      const suggestion = branchWithCommit && !currentHasCommit
        ? `Переключиться: ${buildSwitchCommand(branchWithCommit)} или создать: git switch -c ${buildIssueBranchName(issueKey)}`
        : currentHasCommit
          ? 'Текущая ветка уже содержит этот коммит.'
          : `Создать ветку: git switch -c ${buildIssueBranchName(issueKey)}`;
      output.push({
        repository: repo.rootPath,
        currentBranch: repo.currentBranch,
        hash: commit.hash,
        shortHash: commit.shortHash,
        date: commit.date,
        author: commit.author,
        subject: commit.subject,
        branches: commit.branches.map(formatBranchRef),
        suggestion,
      });
    }
  }
  return output.slice(0, 20);
}

function buildJiraContextViewSections(details: JiraTaskDetails | null): JiraTaskContextViewState['sections'] {
  if (!details) return [];
  const sections: JiraTaskContextViewState['sections'] = [];
  const addSection = (title: string, items: string[]): void => {
    const visible = items.filter(Boolean);
    if (!visible.length) return;
    sections.push({ title, items: visible });
  };

  addSection('Связи', [
    details.epic ? `Эпик: ${formatJiraLinkedIssueViewLine(details.epic)}` : '',
    details.parent ? `Родительская: ${formatJiraLinkedIssueViewLine(details.parent)}` : '',
    ...details.subtasks.map((issue) => `Подзадача: ${formatJiraLinkedIssueViewLine(issue)}`),
    ...details.issueLinks.map((link) => `${link.direction || link.type || 'Связь'}: ${formatJiraLinkedIssueViewLine(link.issue)}`),
  ]);
  addSection('Комментарии', buildJiraCommentPreviewItems(details));
  addSection('Вложения', details.attachments.map((attachment) => [
    attachment.filename,
    attachment.size,
    attachment.author ? `автор: ${attachment.author}` : '',
    attachment.created,
  ].filter(Boolean).join(' • ')));
  addSection('Поля Jira', [
    details.environment ? `Environment: ${limitText(details.environment, 180)}` : '',
    details.affectedVersions.length ? `Affected versions: ${details.affectedVersions.join(', ')}` : '',
    ...details.customFields.map(formatJiraCustomFieldViewLine),
  ]);
  addSection('Предупреждения', details.warnings);
  return sections;
}

function buildJiraCommentPreviewItems(details: JiraTaskDetails): string[] {
  if (!details.comments.length) {
    return details.commentsTotal ? [`Комментарии есть (${details.commentsTotal}), но их не удалось загрузить.`] : [];
  }
  const items = details.comments.map((comment) => [
    [comment.author || 'n/a', comment.updated || comment.created].filter(Boolean).join(' • '),
    limitText(comment.body || 'без текста', 260),
  ].filter(Boolean).join(': '));
  if (details.commentsTotal > details.comments.length) {
    items.unshift(`Загружено ${details.comments.length} из ${details.commentsTotal}`);
  }
  return items;
}

function formatJiraLinkedIssueViewLine(issue: {
  key: string;
  title: string;
  description?: string;
  status: string;
  type: string;
}): string {
  const headline = [
    issue.key,
    issue.title && issue.title !== issue.key ? issue.title : '',
    issue.status,
    issue.type,
  ].filter(Boolean).join(' • ');
  const description = limitText(issue.description || '', 320);
  return description ? `${headline}\nОписание: ${description}` : headline;
}

function formatJiraCustomFieldViewLine(field: { name: string; value: string }): string {
  const name = field.name || 'Поле Jira';
  const value = String(field.value || '').trim();
  if (!value) return '';
  if (isNoisyJiraViewField(name, value)) {
    return `${name}: данные доступны в Jira`;
  }
  return `${name}: ${limitText(value, 180)}`;
}

function isNoisyJiraViewField(name: string, value: string): boolean {
  const text = `${name}\n${value}`;
  return /com\.atlassian\.jira\.plugin\.devstatus|SummaryBean@|SummaryItemBean@|OverallBean@|\{summaryBean=/i.test(text);
}

function formatJiraTaskContextError(error: any): string {
  return error?.message || error?.cause?.message || String(error || 'Не удалось сформировать контекст задачи.');
}

function buildJiraInitialContextMessage(
  source: JiraConversationSource,
  details: JiraTaskDetails | null,
  detailError: string,
  git: IssueGitContext,
): string {
  const labels = details?.labels?.length ? details.labels.join(', ') : '';
  const components = details?.components?.length ? details.components.join(', ') : '';
  const fixVersions = details?.fixVersions?.length ? details.fixVersions.join(', ') : '';
  const lines = [
    `Контекст Jira-задачи ${source.issueKey}`,
    '',
    `Проект: ${source.projectKey}${source.projectName ? ` • ${source.projectName}` : ''}`,
    `Задача: ${source.issueKey} • ${source.issueTitle}`,
    source.issueStatus ? `Статус: ${source.issueStatus}` : '',
    details?.type ? `Тип: ${details.type}` : '',
    details?.priority ? `Приоритет: ${details.priority}` : '',
    details?.assignee ? `Исполнитель: ${details.assignee}` : '',
    details?.reporter ? `Автор: ${details.reporter}` : '',
    details?.created ? `Создана: ${details.created}` : '',
    details?.updated ? `Обновлена: ${details.updated}` : '',
    details?.resolution ? `Решение: ${details.resolution}` : '',
    details?.dueDate ? `Срок: ${details.dueDate}` : '',
    labels ? `Labels: ${labels}` : '',
    components ? `Components: ${components}` : '',
    fixVersions ? `Fix versions: ${fixVersions}` : '',
    source.issueUrl ? `URL: ${source.issueUrl}` : '',
    detailError ? `Детали Jira не удалось обновить: ${detailError}` : '',
    '',
    'Описание:',
    source.issueDescription || 'Описание в Jira не заполнено.',
    '',
    buildJiraTaskDetailsExtraContext(details),
    '',
    buildIssueGitContextText(source.issueKey, git),
    '',
    `Дальше считаем этот чат рабочим контекстом задачи ${source.issueKey}.`,
  ];
  return lines.filter((line, index, all) => line || all[index - 1] !== '').join('\n').trim();
}

function buildJiraTaskDetailsExtraContext(details: JiraTaskDetails | null): string {
  if (!details) return '';
  const blocks = [
    buildJiraLinkedIssuesContext(details),
    buildJiraCommentsContext(details),
    buildJiraAttachmentsContext(details),
    buildJiraCustomFieldsContext(details),
    details.warnings.length ? ['Предупреждения Jira:', ...details.warnings.map((warning) => `- ${warning}`)].join('\n') : '',
  ].filter(Boolean);
  return blocks.join('\n\n');
}

function buildJiraLinkedIssuesContext(details: JiraTaskDetails): string {
  const lines = ['Связи Jira:'];
  if (details.epic) lines.push(`- Эпик: ${formatJiraLinkedIssueLine(details.epic)}`);
  if (details.parent) lines.push(`- Родительская задача: ${formatJiraLinkedIssueLine(details.parent)}`);
  for (const issue of details.subtasks) {
    lines.push(`- Подзадача: ${formatJiraLinkedIssueLine(issue)}`);
  }
  for (const link of details.issueLinks) {
    lines.push(`- ${link.direction || link.type || 'Связь'}: ${formatJiraLinkedIssueLine(link.issue)}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function buildJiraCommentsContext(details: JiraTaskDetails): string {
  if (!details.comments.length) {
    return details.commentsTotal ? `Комментарии Jira: есть ${details.commentsTotal}, но текст не загружен.` : '';
  }
  const lines = [`Комментарии Jira (${details.comments.length}${details.commentsTotal > details.comments.length ? ` из ${details.commentsTotal}` : ''}):`];
  for (const comment of details.comments) {
    const header = `- ${comment.author || 'n/a'} • ${comment.updated || comment.created || 'без даты'}`;
    const body = indentText(limitText(comment.body || 'без текста', 3_000), '  ');
    lines.push(`${header}\n${body}`);
  }
  return lines.join('\n');
}

function buildJiraAttachmentsContext(details: JiraTaskDetails): string {
  if (!details.attachments.length) return '';
  const lines = ['Вложения Jira:'];
  for (const attachment of details.attachments) {
    lines.push(`- ${[
      attachment.filename,
      attachment.size,
      attachment.mimeType,
      attachment.author ? `автор: ${attachment.author}` : '',
      attachment.created,
    ].filter(Boolean).join(' • ')}`);
  }
  return lines.join('\n');
}

function buildJiraCustomFieldsContext(details: JiraTaskDetails): string {
  const lines = ['Дополнительные поля Jira:'];
  if (details.environment) lines.push(`- Environment: ${limitText(details.environment, 2_000)}`);
  if (details.affectedVersions.length) lines.push(`- Affected versions: ${details.affectedVersions.join(', ')}`);
  for (const field of details.customFields) {
    lines.push(`- ${field.name} (${field.id}): ${limitText(field.value, 2_000)}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

function formatJiraLinkedIssueLine(issue: {
  key: string;
  title: string;
  description?: string;
  status: string;
  type: string;
  url: string;
}): string {
  return [
    issue.key,
    issue.title && issue.title !== issue.key ? issue.title : '',
    issue.status ? `статус: ${issue.status}` : '',
    issue.type ? `тип: ${issue.type}` : '',
    issue.description ? `описание: ${limitText(issue.description, 1_200)}` : '',
    issue.url,
  ].filter(Boolean).join(' • ');
}

function limitText(value: string, maxLength: number): string {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function indentText(value: string, prefix: string): string {
  return String(value || '').split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function buildIssueGitContextText(issueKey: string, git: IssueGitContext): string {
  const lines = [
    `Git-контекст по ${issueKey}:`,
    git.searchRoots.length ? `Папки поиска: ${git.searchRoots.join(', ')}` : '',
  ].filter(Boolean);

  if (git.error) {
    lines.push(`Проверка репозиториев: ${git.error}`);
  }

  if (git.repositories.length === 0) {
    const newBranch = buildIssueBranchName(issueKey);
    lines.push('Git-репозитории в открытых папках не найдены.');
    lines.push(`Когда выберешь нужный репозиторий, можно создать рабочую ветку: git switch -c ${newBranch}`);
    return lines.join('\n');
  }

  const repositoriesWithCommits = git.repositories.filter((repo) => repo.commits.length > 0);
  if (repositoriesWithCommits.length === 0) {
    const newBranch = buildIssueBranchName(issueKey);
    lines.push(`Проверено репозиториев: ${git.repositories.length}. Коммиты с ключом ${issueKey} не найдены.`);
    lines.push(`В нужном репозитории можно создать рабочую ветку: git switch -c ${newBranch}`);
    return lines.join('\n');
  }

  lines.push(`Проверено репозиториев: ${git.repositories.length}. Найдены коммиты в ${repositoriesWithCommits.length}.`);
  for (const repo of repositoriesWithCommits) {
    lines.push('');
    lines.push(`Репозиторий: ${repo.rootPath}`);
    if (repo.currentBranch) {
      lines.push(`Текущая ветка: ${repo.currentBranch}`);
    }
    if (repo.error) {
      lines.push(`Проверка коммитов: ${repo.error}`);
      continue;
    }
    lines.push('Коммиты:');
    for (const commit of repo.commits) {
      const branches = commit.branches.length
        ? commit.branches.map(formatBranchRef).join(', ')
        : 'ветка не найдена';
      lines.push(`- ${commit.shortHash} • ${commit.date || 'без даты'} • ${commit.author || 'unknown'} • ${commit.subject}`);
      lines.push(`  Ветки: ${branches}`);
    }

    const branchWithCommit = chooseBranchWithCommit(repo.commits, repo.currentBranch);
    const currentHasCommit = repo.currentBranch
      ? repo.commits.some((commit) => commit.branches.some((branch) => branchMatchesCurrent(branch.name, repo.currentBranch)))
      : false;
    if (branchWithCommit && !currentHasCommit) {
      const newBranch = buildIssueBranchName(issueKey);
      lines.push('Текущая ветка этого репозитория отличается от ветки с найденным коммитом.');
      lines.push(`Можно переключиться: ${buildSwitchCommand(branchWithCommit)}.`);
      lines.push(`Либо создать новую рабочую ветку: git switch -c ${newBranch}.`);
    } else if (currentHasCommit) {
      lines.push('Текущая ветка этого репозитория уже содержит найденный коммит по задаче.');
    }
  }

  const repositoriesWithErrors = git.repositories.filter((repo) => repo.error && repo.commits.length === 0);
  if (repositoriesWithErrors.length) {
    lines.push('');
    lines.push('Репозитории с ошибками проверки:');
    for (const repo of repositoriesWithErrors.slice(0, 5)) {
      lines.push(`- ${repo.rootPath}: ${repo.error}`);
    }
  }

  return lines.join('\n');
}

async function readIssueGitContext(issueKey: string, searchRoots: string[]): Promise<IssueGitContext> {
  const normalizedSearchRoots = normalizeUniquePaths(searchRoots);
  const discovery = await discoverGitRepositories(normalizedSearchRoots);
  const repositories: IssueRepositoryGitContext[] = [];

  for (const repoRoot of discovery.repositories) {
    repositories.push(await readRepositoryIssueGitContext(issueKey, repoRoot));
  }

  return {
    searchRoots: normalizedSearchRoots,
    repositories,
    error: discovery.error,
  };
}

async function readRepositoryIssueGitContext(issueKey: string, rootPath: string): Promise<IssueRepositoryGitContext> {
  const currentBranch = await readCurrentGitBranch(rootPath);
  const log = await runGit([
    'log',
    '--all',
    '--regexp-ignore-case',
    `--grep=${issueKey}`,
    '--max-count=10',
    '--date=short',
    '--pretty=format:%H%x1f%h%x1f%ad%x1f%an%x1f%s',
  ], rootPath);

  if (!log.ok) {
    return {
      rootPath,
      currentBranch,
      commits: [],
      error: formatGitError(log, 'не удалось прочитать историю git'),
    };
  }

  const commits = parseIssueCommitLog(log.stdout);
  for (const commit of commits) {
    commit.branches = await readCommitBranches(rootPath, commit.hash);
  }
  return { rootPath, currentBranch, commits, error: '' };
}

const MAX_GIT_REPOSITORIES = 40;
const MAX_GIT_SCAN_DEPTH = 10;
const MAX_GIT_SCAN_DIRECTORIES = 6_000;

async function discoverGitRepositories(searchRoots: string[]): Promise<{ repositories: string[]; error: string }> {
  const repositories: string[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];
  let scannedDirectories = 0;

  const addRepository = async (candidate: string): Promise<void> => {
    if (repositories.length >= MAX_GIT_REPOSITORIES) return;
    const result = await runGit(['rev-parse', '--show-toplevel'], candidate);
    if (!result.ok) return;
    const root = normalizePath(firstLine(result.stdout));
    if (!root || seen.has(root)) return;
    seen.add(root);
    repositories.push(root);
  };

  for (const root of searchRoots) {
    await addRepository(root);
  }

  const scanDirectory = async (directory: string, depth: number): Promise<void> => {
    if (repositories.length >= MAX_GIT_REPOSITORIES) return;
    if (scannedDirectories >= MAX_GIT_SCAN_DIRECTORIES) return;
    scannedDirectories += 1;

    if (await pathExists(path.join(directory, '.git'))) {
      await addRepository(directory);
    }
    if (depth >= MAX_GIT_SCAN_DEPTH) return;

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (repositories.length >= MAX_GIT_REPOSITORIES) return;
      if (scannedDirectories >= MAX_GIT_SCAN_DIRECTORIES) return;
      if (!entry.isDirectory() || shouldSkipGitScanDirectory(entry.name)) continue;
      await scanDirectory(path.join(directory, entry.name), depth + 1);
    }
  };

  for (const root of searchRoots) {
    await scanDirectory(root, 0);
  }

  if (repositories.length >= MAX_GIT_REPOSITORIES) {
    warnings.push(`найдены первые ${MAX_GIT_REPOSITORIES} репозиториев, остальные не проверялись`);
  }
  if (scannedDirectories >= MAX_GIT_SCAN_DIRECTORIES) {
    warnings.push(`сканирование остановлено после ${MAX_GIT_SCAN_DIRECTORIES} директорий`);
  }

  return {
    repositories,
    error: warnings.join('; '),
  };
}

function shouldSkipGitScanDirectory(name: string): boolean {
  return new Set([
    '.git',
    '.hg',
    '.svn',
    '.cache',
    '.next',
    '.turbo',
    '.vscode',
    'node_modules',
    'dist',
    'out',
    'build',
    'coverage',
    'target',
  ]).has(name);
}

async function readCurrentGitBranch(cwd: string): Promise<string> {
  const branch = await runGit(['branch', '--show-current'], cwd);
  const name = firstLine(branch.stdout);
  if (name) return name;
  const head = await runGit(['rev-parse', '--short', 'HEAD'], cwd);
  const shortHead = firstLine(head.stdout);
  return shortHead ? `detached HEAD ${shortHead}` : '';
}

async function readCommitBranches(cwd: string, hash: string): Promise<GitBranchRef[]> {
  const result = await runGit([
    'for-each-ref',
    '--contains',
    hash,
    '--format=%(refname)%09%(refname:short)',
    'refs/heads',
    'refs/remotes',
  ], cwd);
  if (!result.ok) return [];
  const seen = new Set<string>();
  const branches: GitBranchRef[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const [refName, shortName] = line.split('\t');
    const name = String(shortName || '').trim();
    if (!name || /\/HEAD$/.test(String(refName || '')) || /\/HEAD$/.test(name) || seen.has(name)) continue;
    const type = String(refName || '').startsWith('refs/remotes/') ? 'remote' : 'local';
    seen.add(name);
    branches.push({ name, type });
  }
  return branches.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'local' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function parseIssueCommitLog(stdout: string): IssueCommitMatch[] {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => {
      const [hash, shortHash, date, author, subject] = line.split('\x1f');
      return {
        hash: String(hash || '').trim(),
        shortHash: String(shortHash || '').trim(),
        date: String(date || '').trim(),
        author: String(author || '').trim(),
        subject: String(subject || '').trim(),
        branches: [],
      };
    })
    .filter((commit) => commit.hash && commit.shortHash && commit.subject);
}

function chooseBranchWithCommit(commits: IssueCommitMatch[], currentBranch: string): GitBranchRef | null {
  const branches = commits.flatMap((commit) => commit.branches);
  if (currentBranch) {
    const current = branches.find((branch) => branchMatchesCurrent(branch.name, currentBranch));
    if (current) return current;
  }
  return branches.find((branch) => branch.type === 'local') || branches[0] || null;
}

function branchMatchesCurrent(branchName: string, currentBranch: string): boolean {
  const branch = String(branchName || '').trim();
  const current = String(currentBranch || '').trim();
  return !!branch && !!current && (branch === current || branch.endsWith(`/${current}`));
}

function formatBranchRef(branch: GitBranchRef): string {
  return branch.type === 'remote' ? `${branch.name} (remote)` : branch.name;
}

function buildSwitchCommand(branch: GitBranchRef): string {
  return branch.type === 'remote'
    ? `git switch --track ${branch.name}`
    : `git switch ${branch.name}`;
}

function buildIssueBranchName(issueKey: string): string {
  const slug = String(issueKey || 'jira-task')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'jira-task';
  return `codex/${slug}`;
}

function runGit(args: string[], cwd: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, {
      cwd,
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

function normalizeUniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizePath(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function normalizePath(value: string): string {
  try {
    return path.resolve(String(value || '').trim());
  } catch {
    return String(value || '').trim();
  }
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await fs.lstat(value);
    return true;
  } catch {
    return false;
  }
}

function firstLine(value: string): string {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function formatGitError(result: { stderr: string; stdout: string }, fallback: string): string {
  return firstLine(result.stderr) || firstLine(result.stdout) || fallback;
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

  if (message.type === 'changeMetrics') {
    return {
      kind: 'changeMetrics',
      payload: {
        pendingFiles: Number(message.metrics?.pendingFiles || 0),
        pendingChanges: Number(message.metrics?.pendingChanges || 0),
        agentLines: Number(message.metrics?.agentLines || 0),
        agentModifiedByUserLines: Number(message.metrics?.agentModifiedByUserLines || 0),
        agentRemovedLines: Number(message.metrics?.agentRemovedLines || 0),
        agentDeletedByUserLines: Number(message.metrics?.agentDeletedByUserLines || 0),
        userOnlyLines: Number(message.metrics?.userOnlyLines || 0),
        userRemovedLines: Number(message.metrics?.userRemovedLines || 0),
        unknownFiles: Number(message.metrics?.unknownFiles || 0),
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

function normalizeChangeMetricsPayload(next: any) {
  const numberValue = (key: string) => Math.max(0, Number(next?.[key] || 0));
  return {
    pendingFiles: numberValue('pendingFiles'),
    pendingChanges: numberValue('pendingChanges'),
    agentLines: numberValue('agentLines'),
    agentModifiedByUserLines: numberValue('agentModifiedByUserLines'),
    agentRemovedLines: numberValue('agentRemovedLines'),
    agentDeletedByUserLines: numberValue('agentDeletedByUserLines'),
    userOnlyLines: numberValue('userOnlyLines'),
    userRemovedLines: numberValue('userRemovedLines'),
    unknownFiles: numberValue('unknownFiles'),
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
    || message.type === 'changeMetrics'
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
