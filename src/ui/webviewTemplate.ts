import * as vscode from 'vscode';

interface WebviewAssetUris {
  baseStyleUri: vscode.Uri;
  extraStyleUri: vscode.Uri;
  mermaidCssUri: vscode.Uri;
  highlightCssUri: vscode.Uri;
  markdownItUri: vscode.Uri;
  mermaidLibUri: vscode.Uri;
  mermaidConfigUri: vscode.Uri;
  mermaidRendererUri: vscode.Uri;
  mermaidOverlayUri: vscode.Uri;
  mermaidManagerUri: vscode.Uri;
  markdownJsUri: vscode.Uri;
  sessionsJsUri: vscode.Uri;
  todosJsUri: vscode.Uri;
  tasksJsUri: vscode.Uri;
  traceSharedJsUri: vscode.Uri;
  traceRunsJsUri: vscode.Uri;
  traceSubagentsJsUri: vscode.Uri;
  traceJsUri: vscode.Uri;
  approvalsJsUri: vscode.Uri;
  checkpointsJsUri: vscode.Uri;
  changesJsUri: vscode.Uri;
  followupsJsUri: vscode.Uri;
  settingsJsUri: vscode.Uri;
  settingsPanelJsUri: vscode.Uri;
  appJsUri: vscode.Uri;
}

function getAssetUris(webview: vscode.Webview, extensionUri: vscode.Uri): WebviewAssetUris {
  return {
    baseStyleUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css')),
    extraStyleUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview-extra.css')),
    mermaidCssUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'mermaid', 'mermaid.css')),
    highlightCssUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'highlight.js', 'styles', 'github-dark-dimmed.min.css')),
    markdownItUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js')),
    mermaidLibUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', 'mermaid', 'dist', 'mermaid.js')),
    mermaidConfigUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'mermaid', 'MermaidConfig.js')),
    mermaidRendererUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'mermaid', 'MermaidRenderer.js')),
    mermaidOverlayUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'mermaid', 'MermaidOverlay.js')),
    mermaidManagerUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'mermaid', 'MermaidManager.js')),
    markdownJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-markdown.js')),
    sessionsJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-sessions.js')),
    todosJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-todos.js')),
    tasksJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-tasks.js')),
    traceSharedJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-trace-shared.js')),
    traceRunsJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-trace-runs.js')),
    traceSubagentsJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-trace-subagents.js')),
    traceJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-trace.js')),
    approvalsJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-approvals.js')),
    checkpointsJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-checkpoints.js')),
    changesJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-changes.js')),
    followupsJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-followups.js')),
    settingsJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-settings.js')),
    settingsPanelJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'settings-panel.js')),
    appJsUri: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-app.js')),
  };
}

function getSettingsMarkup(cancelLabel: string): string {
  return `
    <div class="settings-shell">
      <div class="settings-layout">
        <aside class="settings-nav" aria-label="Разделы настроек">
          <div class="settings-nav-title">Разделы</div>
          <button class="settings-nav-item is-active" type="button" data-settings-nav="models">
            <span class="settings-nav-label">Модели</span>
            <span class="settings-nav-desc">Подключение API и выбор моделей</span>
          </button>
          <button class="settings-nav-item" type="button" data-settings-nav="mcp">
            <span class="settings-nav-label">MCP</span>
            <span class="settings-nav-desc">Серверы, auth и config</span>
          </button>
          <button class="settings-nav-item" type="button" data-settings-nav="web">
            <span class="settings-nav-label">Интернет</span>
            <span class="settings-nav-desc">trusted и blocked hosts</span>
          </button>
        </aside>
        <div class="settings-main">
          <div class="settings">
            <div class="settings-pane is-active" data-settings-pane="models">
              <div class="settings-pane-header">
                <div class="settings-pane-title">Модели</div>
                <div class="settings-pane-desc">Настрой подключение к API и выбери модели для чата, rerank и эмбеддингов.</div>
              </div>
              <div id="modelIssueCard" class="settings-status-card is-err hidden">
                <div class="settings-status-row">
                  <span class="conn-dot err"></span>
                  <span id="modelIssueText">Текущая chat-модель недоступна.</span>
                </div>
                <div id="modelIssueMeta" class="settings-status-meta">Выберите модель из списка и сохраните настройки.</div>
              </div>
              <div class="settings-section">
                <div class="settings-section-header"><span>Подключение API</span><button class="btn btn-secondary btn-xs" id="testConnBtn">Проверить подключение</button></div>
                <div class="settings-section-body">
                  <div class="field"><div class="field-label">URL API <span class="badge badge-required">обязательно</span></div><div class="field-desc">Адрес API для запросов к модели</div><input id="s_apiBaseUrl" class="field-input" spellcheck="false" placeholder="https://api.example.com/v1/chat/completions" /></div>
                  <div class="field"><div class="field-label">Ключ API <span class="badge badge-required">обязательно</span></div><div class="field-input-wrap"><input id="s_apiKey" class="field-input has-btn" type="password" spellcheck="false" placeholder="sk-..." /><button class="field-input-btn" id="toggleKeyBtn" title="Показать / скрыть">&#128065;</button></div></div>
                  <div id="connStatus" class="conn-status"><span class="conn-dot idle"></span><span>Не проверено</span></div>
                </div>
              </div>
              <div class="settings-section">
                <div class="settings-section-header"><span>Выбор моделей</span></div>
                <div class="settings-section-body">
                  <div class="field"><div class="field-label">Чат-модель <span class="badge badge-required">обязательно</span></div><div class="field-desc">Основная модель для генерации ответов</div><div class="model-picker" id="picker_chat"></div></div>
                  <div class="field"><div class="field-label">Rerank-модель <span class="badge badge-optional">необязательно</span></div><div class="field-desc">Переранжирование файлов по релевантности запросу</div><div class="model-picker" id="picker_rerank"></div></div>
                  <div class="field"><div class="field-label">Модель эмбеддингов <span class="badge badge-optional">необязательно</span></div><div class="field-desc">Семантический поиск по коду проекта</div><div class="model-picker" id="picker_emb"></div></div>
                  <div class="model-actions">
                    <button class="btn btn-primary btn-xs" id="testModelsBtn">Проверить выбранные модели</button>
                  </div>
                  <div id="modelTests" class="model-tests hidden">
                    <div class="model-tests-row">
                      <span class="model-tests-label">Проверка выбранных моделей</span>
                      <span id="modelTestsSummary" class="model-tests-summary">Выберите модели и нажмите «Проверить».</span>
                    </div>
                    <div id="modelTestsList" class="model-tests-list"></div>
                  </div>
                </div>
              </div>
              <div class="settings-section">
                <div class="settings-section-header"><span>Дополнительные инструкции</span></div>
                <div class="settings-section-body">
                  <div class="field">
                    <div class="field-label">Дополнительный системный prompt <span class="badge badge-optional">необязательно</span></div>
                    <div class="field-desc">Постоянные инструкции для агента: стиль работы, ограничения, предпочтения и правила, которым нужно следовать во всех запросах.</div>
                    <textarea id="s_systemPrompt" class="field-input field-textarea" spellcheck="false" rows="8" placeholder="Например: всегда сначала проверяй Dockerfile и docker-compose, отвечай короче, не меняй файлы без явной необходимости."></textarea>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-pane" data-settings-pane="mcp">
              <div class="settings-pane-header">
                <div class="settings-pane-title">MCP</div>
                <div class="settings-pane-desc">Серверы и утилиты.</div>
              </div>
              <div class="settings-section">
                <div class="settings-section-header"><span>MCP</span></div>
                <div class="settings-section-body">
                  <div class="settings-actions">
                    <button class="btn btn-primary btn-xs" id="mcpAddStdioBtn" type="button" title="Добавить локальный MCP сервер через stdio">Добавить stdio</button>
                    <button class="btn btn-secondary btn-xs" id="mcpAddHttpBtn" type="button" title="Добавить удалённый MCP сервер через HTTP">Добавить http</button>
                    <button class="btn btn-secondary btn-xs" id="mcpInspectBtn" type="button" title="Проверить текущий черновик MCP и загрузить список доступных утилит">Проверить MCP</button>
                  </div>
                  <details class="settings-inline-details">
                    <summary>Дополнительно</summary>
                    <div class="settings-inline-details-body">
                      <div class="field">
                        <div class="field-label" title="Если оставить пустым, при первом сохранении с серверами будет создан .mcp.json в корне workspace.">Путь к MCP config <span class="badge badge-optional">необязательно</span></div>
                        <input id="s_mcpConfigPath" class="field-input" spellcheck="false" placeholder=".mcp.json или .cursor/mcp.json" />
                      </div>
                      <div class="settings-actions settings-actions-secondary">
                        <button class="btn btn-secondary btn-xs" id="mcpClearBtn" type="button" title="Удалить все серверы из текущего черновика">Очистить всё</button>
                      </div>
                    </div>
                  </details>
                  <div id="mcpServerList" class="mcp-server-list"></div>
                  <div id="mcpStatusCard" class="settings-status-card is-compact">
                    <div class="settings-status-row">
                      <span id="mcpStatusDot" class="conn-dot idle"></span>
                      <span id="mcpStatusText">Можно оставить пустым, если MCP настраивается через файл.</span>
                    </div>
                  </div>
                  <div class="mcp-inspector">
                    <div class="settings-section-header">
                      <span>Утилиты</span>
                    </div>
                    <div id="mcpInspectionStatusCard" class="settings-status-card is-compact">
                      <div class="settings-status-row">
                        <span id="mcpInspectionStatusDot" class="conn-dot idle"></span>
                        <span id="mcpInspectionStatusText">Нажми «Проверить MCP», чтобы проверить серверы и увидеть их tools.</span>
                      </div>
                    </div>
                    <div id="mcpInspectionList" class="mcp-inspection-list"></div>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-pane" data-settings-pane="web">
              <div class="settings-pane-header">
                <div class="settings-pane-title">Интернет</div>
                <div class="settings-pane-desc">Управляй trusted и blocked hosts для безопасной работы \`web_fetch\`.</div>
              </div>
              <div class="settings-section">
                <div class="settings-section-header"><span>Интернет</span><span id="webTrustHeaderBadge" class="settings-inline-badge">Только встроенные</span></div>
                <div class="settings-section-body">
                  <div class="field">
                    <div class="field-label">Правила web_fetch <span class="badge badge-optional">необязательно</span></div>
                    <div class="field-desc">Встроенные documentation/code hosts уже доверены. Здесь можно добавить свои доверенные домены или заблокировать нежелательные.</div>
                  </div>
                  <div class="settings-actions">
                    <button class="btn btn-primary btn-xs" id="webAddTrustedHostBtn" type="button">Добавить trusted host</button>
                    <button class="btn btn-secondary btn-xs" id="webAddBlockedHostBtn" type="button">Добавить blocked host</button>
                    <button class="btn btn-secondary btn-xs" id="webUseDocsExamplesBtn" type="button">Подставить docs-примеры</button>
                    <button class="btn btn-secondary btn-xs" id="webClearHostRulesBtn" type="button">Очистить списки</button>
                  </div>
                  <div class="web-host-panels">
                    <div class="web-host-panel">
                      <div class="web-host-panel-header">
                        <span>Trusted hosts</span>
                        <span class="settings-inline-badge">без лишних confirm</span>
                      </div>
                      <div id="webTrustedHostList" class="web-host-list"></div>
                    </div>
                    <div class="web-host-panel">
                      <div class="web-host-panel-header">
                        <span>Blocked hosts</span>
                        <span class="settings-inline-badge">блокируются всегда</span>
                      </div>
                      <div id="webBlockedHostList" class="web-host-list"></div>
                    </div>
                  </div>
                  <div id="webTrustStatusCard" class="settings-status-card">
                    <div class="settings-status-row">
                      <span id="webTrustStatusDot" class="conn-dot idle"></span>
                      <span id="webTrustStatusText">Сейчас работают только встроенные доверенные documentation hosts.</span>
                    </div>
                    <div id="webTrustStatusMeta" class="settings-status-meta">Остальные домены будут спрашивать подтверждение. Блок-лист имеет приоритет над trusted hosts.</div>
                  </div>
                  <details class="settings-help">
                    <summary>Что считается встроенно доверенным</summary>
                    <div class="settings-help-code">Например: platform.openai.com, help.openai.com, developer.mozilla.org, react.dev, docs.python.org, fastapi.tiangolo.com, learn.microsoft.com и другие documentation/code hosts.</div>
                  </details>
                </div>
              </div>
            </div>
          </div>
          <div class="save-bar"><div id="saveStatus" class="save-status"></div><div class="spacer"></div><button class="btn btn-secondary" id="cancelBtn">${cancelLabel}</button><button class="btn btn-primary" id="saveBtn">Сохранить</button></div>
        </div>
      </div>
    </div>`;
}

export function getChatViewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const assets = getAssetUris(webview, extensionUri);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'unsafe-eval'; font-src ${webview.cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${assets.baseStyleUri}" />
  <link rel="stylesheet" href="${assets.extraStyleUri}" />
  <link rel="stylesheet" href="${assets.mermaidCssUri}" />
  <link rel="stylesheet" href="${assets.highlightCssUri}" />
  <title>ИИ Кодогенератор</title>
</head>
<body>
  <div class="root app-shell">
    <header class="app-shell-header">
      <div class="app-shell-chat-heading">
        <div id="chatSessionTitle" class="chat-session-title">Новый чат</div>
        <div id="chatSessionMeta" class="chat-session-meta">Нет сохранённых чатов</div>
      </div>
      <div class="app-shell-actions">
        <div id="chatModeBadge" class="chat-mode-badge hidden">Режим плана</div>
        <button class="btn-icon app-shell-action-btn" id="toggleChatSidebarBtn" type="button" title="Свернуть список чатов" aria-label="Свернуть список чатов" aria-pressed="false">
          <svg class="app-shell-icon-sidebar" viewBox="0 0 16 16" focusable="false" aria-hidden="true">
            <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.75"></rect>
            <path d="M6 2.75v10.5"></path>
            <path class="sidebar-chevron" d="M10.25 5.5 8 8l2.25 2.5"></path>
          </svg>
        </button>
        <button class="btn-icon app-shell-action-btn" id="quickNewChatBtn" type="button" title="Создать новый чат" aria-label="Создать новый чат">
          <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
            <path d="M8 3.25v9.5"></path>
            <path d="M3.25 8h9.5"></path>
          </svg>
        </button>
        <button class="btn-icon app-shell-action-btn app-shell-settings-btn" id="openSettingsBtn" type="button" title="Открыть настройки" aria-label="Открыть настройки">
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path fill="currentColor" stroke="none" d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.48 7.48 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.51.41 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5Z"></path>
          </svg>
        </button>
      </div>
    </header>

    <div class="chat-workspace" id="chatWorkspace">
      <aside class="chat-sidebar">
        <div class="chat-sidebar-header">
          <div class="chat-sidebar-copy">
            <div class="chat-sidebar-title">Чаты</div>
            <div class="chat-sidebar-meta">Список сохранённых диалогов проекта.</div>
          </div>
          <button class="btn btn-primary btn-xs" id="newChatBtn" type="button">Создать чат</button>
        </div>
        <div id="chatSessionsList" class="chat-session-list"></div>
        <div class="chat-sidebar-footer">
          <button class="btn btn-secondary btn-xs" id="clearChatBtn" type="button">Очистить текущий чат</button>
        </div>
      </aside>

      <section class="chat-main">
        <div class="chat-main-status">
          <div id="chatPendingApproval" class="chat-pending-approval hidden"></div>
          <div id="chatConnectionStatus" class="chat-connection-status hidden"></div>
          <div id="chatRuntimeSummary" class="chat-runtime-summary hidden"></div>
          <div id="chatRuntimeActivity" class="chat-runtime-activity hidden"></div>
          <div id="chatRuntimeNarrative" class="chat-runtime-narrative hidden"></div>
          <div id="chatUtilityBar" class="chat-utility-bar hidden">
            <button class="btn btn-secondary btn-xs chat-utility-toggle hidden" id="toggleSessionMemoryBtn" type="button" title="Показать память сессии">Память сессии</button>
            <button class="btn btn-secondary btn-xs chat-utility-toggle hidden" id="toggleTaskPanelBtn" type="button" title="Показать фоновые задачи">Фоновые задачи</button>
          </div>
          <div id="chatSessionMemory" class="chat-session-memory hidden">
            <div class="chat-session-memory-top">
              <div id="chatSessionMemoryTitle" class="chat-session-memory-title"></div>
              <div class="chat-session-memory-actions">
                <button class="btn btn-secondary btn-xs chat-session-memory-open" id="openSessionMemoryBtn" type="button">Открыть</button>
                <button class="btn btn-secondary btn-xs chat-session-memory-hide" id="hideSessionMemoryBtn" type="button">Скрыть</button>
              </div>
            </div>
            <div id="chatSessionMemoryState" class="chat-session-memory-state"></div>
            <div id="chatSessionMemoryMeta" class="chat-session-memory-meta"></div>
          </div>
        </div>
        <section id="taskPanel" class="task-panel hidden">
          <div class="task-panel-header">
            <div class="task-panel-title">Фоновые задачи</div>
            <div class="task-panel-actions">
              <div id="taskMeta" class="task-panel-meta">Нет фоновых задач</div>
              <button class="btn btn-secondary btn-xs" id="refreshTasksBtn" type="button">Обновить</button>
              <button class="btn btn-secondary btn-xs" id="hideTaskPanelBtn" type="button">Скрыть</button>
            </div>
          </div>
          <div id="taskList" class="task-list"></div>
        </section>
        <div id="messages" class="messages"></div>
        <div class="chat-footer">
          <div id="bulkActions" class="bulk-actions">
            <div class="bulk-main">
              <button class="bulk-summary" id="bulkSummaryBtn" type="button" aria-expanded="false" title="Показать список изменённых файлов">
                <span class="bulk-summary-label" id="bulkLabel">0 файлов</span>
                <span class="bulk-summary-meta" id="bulkMeta">0 изменений</span>
                <span class="bulk-summary-caret" id="bulkCaret" aria-hidden="true">▾</span>
              </button>
              <div id="bulkFileList" class="bulk-file-list hidden"></div>
            </div>
            <div class="bulk-btns">
              <button class="btn btn-xs btn-accept-all" id="acceptAllBtn">Принять все</button>
              <button class="btn btn-xs btn-reject-all" id="rejectAllBtn">Отклонить все</button>
            </div>
          </div>
          <section id="todoPanel" class="todo-panel hidden">
            <div class="todo-header">
              <div class="todo-title">План работ</div>
              <div id="todoMeta" class="todo-meta">Нет активных задач</div>
            </div>
            <div id="todoList" class="todo-list"></div>
          </section>
          <section id="followupsPanel" class="followups-panel">
            <div class="followups-header">
              <div class="followups-heading">
                <div class="followups-kicker">Подсказки</div>
                <div id="followupsTitle" class="followups-title">Быстрый старт</div>
                <div id="followupsMeta" class="followups-meta">Быстрые действия для старта работы с проектом.</div>
              </div>
              <div class="followups-actions">
                <span id="followupsBadge" class="followups-badge">Старт</span>
                <button class="btn btn-secondary btn-xs hidden" id="refreshFollowupsBtn" type="button" title="Обновить подсказки">↻</button>
              </div>
            </div>
            <div id="followupsList" class="followups-list"></div>
          </section>
          <div class="input-row">
            <textarea id="input" rows="2" placeholder="Задайте вопрос..."></textarea>
            <button class="btn btn-primary" id="sendBtn">Отправить</button>
          </div>
          <div class="composer-tools-row">
            <button
              class="btn btn-secondary btn-xs composer-tools-toggle"
              id="composerPermissionsBtn"
              type="button"
              aria-expanded="false"
              aria-label="Настроить автодействия агента"
              title="Настроить автодействия агента"
            >
              <span class="composer-tools-toggle-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <path d="M6.9 1.1a1 1 0 0 1 2.2 0l.18.88c.16.07.31.15.46.24l.86-.3a1 1 0 0 1 1.26.55l.57 1.04a1 1 0 0 1-.23 1.3l-.69.57c.02.17.03.34.03.51 0 .17-.01.34-.03.51l.69.57a1 1 0 0 1 .23 1.3l-.57 1.04a1 1 0 0 1-1.26.55l-.86-.3a4.1 4.1 0 0 1-.46.24l-.18.88a1 1 0 0 1-2.2 0l-.18-.88a4.1 4.1 0 0 1-.46-.24l-.86.3a1 1 0 0 1-1.26-.55L2.8 9.8a1 1 0 0 1 .23-1.3l.69-.57A4.2 4.2 0 0 1 3.7 7.4c0-.17.01-.34.03-.51l-.69-.57a1 1 0 0 1-.23-1.3l.57-1.04a1 1 0 0 1 1.26-.55l.86.3c.15-.09.3-.17.46-.24l.18-.88ZM8 10.2A2.2 2.2 0 1 0 8 5.8a2.2 2.2 0 0 0 0 4.4Z" fill="currentColor"/>
                </svg>
              </span>
              <span class="composer-tools-toggle-label">Автодействия</span>
            </button>
            <div id="chatContextUsage" class="chat-context-usage hidden"></div>
          </div>
          <div id="composerPermissionsPanel" class="composer-permissions-panel hidden">
            <div class="composer-permissions-header">Что агент может запускать без ожидания подтверждения</div>
            <div class="composer-permissions-presets">
              <span class="composer-permissions-presets-label">Быстрые режимы</span>
              <div class="composer-permissions-preset-row">
                <button class="btn btn-secondary btn-xs composer-permission-preset" type="button" data-auto-approval-preset="manual">Спрашивать всё</button>
                <button class="btn btn-secondary btn-xs composer-permission-preset" type="button" data-auto-approval-preset="files">Авто для файлов</button>
                <button class="btn btn-secondary btn-xs composer-permission-preset" type="button" data-auto-approval-preset="filesShell">Файлы + bash</button>
              </div>
              <div class="composer-permissions-mode-row">
                <span class="composer-permissions-presets-label">Текущий режим</span>
                <span id="composerPermissionsModeBadge" class="composer-permissions-mode-badge">Авто для файлов</span>
              </div>
            </div>
            <label class="composer-permission-item">
              <input id="autoApproveFileCreate" type="checkbox" />
              <span class="composer-permission-copy">
                <span class="composer-permission-title">Создание файла</span>
                <span class="composer-permission-desc">Новые файлы применяются сразу.</span>
              </span>
            </label>
            <label class="composer-permission-item">
              <input id="autoApproveFileEdit" type="checkbox" />
              <span class="composer-permission-copy">
                <span class="composer-permission-title">Редактирование</span>
                <span class="composer-permission-desc">Изменения применяются сразу, но карточки принятия и отклонения файла остаются.</span>
              </span>
            </label>
            <label class="composer-permission-item">
              <input id="autoApproveFileDelete" type="checkbox" />
              <span class="composer-permission-copy">
                <span class="composer-permission-title">Удаление</span>
                <span class="composer-permission-desc">Удаление файлов не ждёт отдельного confirm.</span>
              </span>
            </label>
            <label class="composer-permission-item">
              <input id="autoApproveWebFetch" type="checkbox" />
              <span class="composer-permission-copy">
                <span class="composer-permission-title">Загрузка URL</span>
                <span class="composer-permission-desc">web_fetch по внешним доменам запускается без отдельного подтверждения. По умолчанию выключено.</span>
              </span>
            </label>
            <label class="composer-permission-item">
              <input id="autoApproveShell" type="checkbox" />
              <span class="composer-permission-copy">
                <span class="composer-permission-title">Выполнение bash / shell</span>
                <span class="composer-permission-desc">Команды запускаются сразу. По умолчанию выключено.</span>
              </span>
            </label>
            <label class="composer-permission-item composer-permission-item-advanced">
              <input id="autoApproveWorktree" type="checkbox" />
              <span class="composer-permission-copy">
                <span class="composer-permission-title">Worktree и ветки</span>
                <span class="composer-permission-desc">Вход, удержание и удаление рабочих деревьев.</span>
              </span>
            </label>
            <label class="composer-permission-item composer-permission-item-advanced">
              <input id="autoApproveMcp" type="checkbox" />
              <span class="composer-permission-copy">
                <span class="composer-permission-title">MCP-инструменты</span>
                <span class="composer-permission-desc">Внешние MCP-вызовы выполняются без отдельного разрешения.</span>
              </span>
            </label>
            <div id="composerPermissionsHint" class="composer-permissions-hint">
              Для файловых правок карточки принятия и отклонения изменений всё равно остаются.
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="toast" id="toast"></div>
  </div>

  <div class="mermaid-overlay" id="mermaidOverlay">
    <div class="mermaid-overlay-toolbar">
      <div class="mermaid-overlay-heading">
        <span class="mermaid-overlay-title" id="mermaidOverlayTitle">Диаграмма Mermaid</span>
        <span class="mermaid-overlay-hint" id="mermaidOverlayHint">колёсико — масштаб • перетаскивание — панорама</span>
      </div>
      <div class="mermaid-overlay-actions">
        <div class="mmd-segmented mmd-segmented-overlay">
          <button class="mmd-segment is-active" id="mermaidViewDiagramBtn" type="button">Диаграмма</button>
          <button class="mmd-segment" id="mermaidViewSourceBtn" type="button">Код</button>
        </div>
        <button class="btn btn-secondary btn-xs" id="mermaidCopyBtn" type="button">Копировать</button>
        <button class="btn btn-secondary btn-xs" id="mermaidDownloadBtn" type="button">Скачать SVG</button>
        <button class="btn btn-secondary btn-xs" id="mermaidFitBtn" type="button">Подогнать</button>
        <button class="btn btn-secondary btn-xs" id="mermaidCloseBtn" type="button">Закрыть</button>
      </div>
    </div>
    <div class="mermaid-overlay-content" id="mermaidOverlayContent">
      <div class="mermaid-overlay-inner" id="mermaidOverlayInner"></div>
    </div>
    <div class="mermaid-overlay-source" id="mermaidOverlaySource">
      <pre><code id="mermaidOverlaySourceCode"></code></pre>
    </div>
    <div class="zoom-controls">
      <button class="zoom-btn" id="zoomOut" type="button">-</button>
      <span class="zoom-level" id="zoomLevel">100%</span>
      <button class="zoom-btn" id="zoomIn" type="button">+</button>
      <button class="zoom-btn" id="zoomReset" type="button">100%</button>
    </div>
  </div>

  <script src="${assets.markdownItUri}"></script>
  <script src="${assets.mermaidLibUri}"></script>
  <script src="${assets.mermaidConfigUri}"></script>
  <script src="${assets.mermaidRendererUri}"></script>
  <script src="${assets.mermaidOverlayUri}"></script>
  <script src="${assets.mermaidManagerUri}"></script>
  <script src="${assets.markdownJsUri}"></script>
  <script src="${assets.sessionsJsUri}"></script>
  <script src="${assets.todosJsUri}"></script>
  <script src="${assets.tasksJsUri}"></script>
  <script src="${assets.traceSharedJsUri}"></script>
  <script src="${assets.traceRunsJsUri}"></script>
  <script src="${assets.traceSubagentsJsUri}"></script>
  <script src="${assets.traceJsUri}"></script>
  <script src="${assets.approvalsJsUri}"></script>
  <script src="${assets.checkpointsJsUri}"></script>
  <script src="${assets.changesJsUri}"></script>
  <script src="${assets.followupsJsUri}"></script>
  <script src="${assets.appJsUri}"></script>
</body>
</html>`;
}

export function getSettingsPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const assets = getAssetUris(webview, extensionUri);

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'unsafe-eval'; font-src ${webview.cspSource} data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${assets.baseStyleUri}" />
  <link rel="stylesheet" href="${assets.extraStyleUri}" />
  <title>ИИ Кодогенератор: Настройки</title>
</head>
<body>
  <div class="root settings-root">
    <header class="settings-page-header">
      <div class="settings-page-copy">
        <div class="settings-page-kicker">ИИ Кодогенератор</div>
        <div class="settings-page-title">Настройки</div>
      </div>
    </header>
    ${getSettingsMarkup('Закрыть')}
    <div class="toast" id="toast"></div>
  </div>

  <script src="${assets.settingsJsUri}"></script>
  <script src="${assets.settingsPanelJsUri}"></script>
</body>
</html>`;
}
