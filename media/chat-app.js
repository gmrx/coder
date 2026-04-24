(function () {
  'use strict';

  var vscode = acquireVsCodeApi();
  var $ = function (selector) { return document.querySelector(selector); };
  var $$ = function (selector) { return document.querySelectorAll(selector); };

  var messagesEl = $('#messages');
  var inputEl = $('#input');
  var sendBtn = $('#sendBtn');
  var chatWorkspaceEl = $('#chatWorkspace');
  var toggleChatSidebarBtn = $('#toggleChatSidebarBtn');
  var quickNewChatBtn = $('#quickNewChatBtn');
  var openSettingsBtn = $('#openSettingsBtn');
  var composerPermissionsBtn = $('#composerPermissionsBtn');
  var composerPermissionsPanelEl = $('#composerPermissionsPanel');
  var composerPermissionsModeBadgeEl = $('#composerPermissionsModeBadge');
  var composerPermissionsHintEl = $('#composerPermissionsHint');
  var composerPermissionPresetEls = $$('[data-auto-approval-preset]');
  var autoApproveFileCreateEl = $('#autoApproveFileCreate');
  var autoApproveFileEditEl = $('#autoApproveFileEdit');
  var autoApproveFileDeleteEl = $('#autoApproveFileDelete');
  var autoApproveWebFetchEl = $('#autoApproveWebFetch');
  var autoApproveShellEl = $('#autoApproveShell');
  var autoApproveWorktreeEl = $('#autoApproveWorktree');
  var autoApproveMcpEl = $('#autoApproveMcp');
  var toastEl = $('#toast');
  var chatSessionTitleEl = $('#chatSessionTitle');
  var chatSessionMetaEl = $('#chatSessionMeta');
  var chatModeBadgeEl = $('#chatModeBadge');
  var chatPendingApprovalEl = $('#chatPendingApproval');
  var chatConnectionStatusEl = $('#chatConnectionStatus');
  var chatRuntimeSummaryEl = $('#chatRuntimeSummary');
  var chatContextUsageEl = $('#chatContextUsage');
  var chatRuntimeActivityEl = $('#chatRuntimeActivity');
  var chatRuntimeNarrativeEl = $('#chatRuntimeNarrative');
  var chatUtilityBarEl = $('#chatUtilityBar');
  var chatSessionMetricsEl = $('#chatSessionMetrics');
  var toggleSessionMemoryBtn = $('#toggleSessionMemoryBtn');
  var toggleTaskPanelBtn = $('#toggleTaskPanelBtn');
  var chatSessionMemoryEl = $('#chatSessionMemory');
  var chatSessionMemoryTitleEl = $('#chatSessionMemoryTitle');
  var chatSessionMemoryStateEl = $('#chatSessionMemoryState');
  var chatSessionMemoryMetaEl = $('#chatSessionMemoryMeta');
  var openSessionMemoryBtn = $('#openSessionMemoryBtn');
  var hideSessionMemoryBtn = $('#hideSessionMemoryBtn');
  var chatSessionsListEl = $('#chatSessionsList');
  var jiraProjectSelectEl = $('#jiraProjectSelect');
  var refreshJiraProjectsBtn = $('#refreshJiraProjectsBtn');
  var jiraChatScopeStatusEl = $('#jiraChatScopeStatus');
  var jiraContextPanelEl = $('#jiraContextPanel');
  var toggleJiraContextBtn = $('#toggleJiraContextBtn');
  var jiraContextTitleEl = $('#jiraContextTitle');
  var jiraContextMetaEl = $('#jiraContextMeta');
  var jiraContextLinkEl = $('#jiraContextLink');
  var jiraContextDescriptionEl = $('#jiraContextDescription');
  var jiraContextCommitsEl = $('#jiraContextCommits');
  var todoPanelEl = $('#todoPanel');
  var todoMetaEl = $('#todoMeta');
  var todoListEl = $('#todoList');
  var taskPanelEl = $('#taskPanel');
  var taskMetaEl = $('#taskMeta');
  var taskListEl = $('#taskList');
  var refreshTasksBtn = $('#refreshTasksBtn');
  var hideTaskPanelBtn = $('#hideTaskPanelBtn');
  var newChatBtn = $('#newChatBtn');
  var clearChatBtn = $('#clearChatBtn');
  var followupsPanelEl = $('#followupsPanel');
  var followupsTitleEl = $('#followupsTitle');
  var followupsMetaEl = $('#followupsMeta');
  var followupsBadgeEl = $('#followupsBadge');
  var followupsListEl = $('#followupsList');
  var refreshFollowupsBtn = $('#refreshFollowupsBtn');
  var bulkActionsEl = $('#bulkActions');
  var bulkSummaryBtn = $('#bulkSummaryBtn');
  var bulkLabelEl = $('#bulkLabel');
  var bulkMetaEl = $('#bulkMeta');
  var bulkCaretEl = $('#bulkCaret');
  var bulkFileListEl = $('#bulkFileList');
  var acceptAllBtn = $('#acceptAllBtn');
  var rejectAllBtn = $('#rejectAllBtn');
  var persistedUiState = (typeof vscode.getState === 'function' && vscode.getState()) || {};

  var agentRunning = false;
  var toastTimer = null;
  var chatsCollapsed = !!persistedUiState.chatsCollapsed;
  var sessionMemoryOpen = !!persistedUiState.sessionMemoryOpen;
  var taskPanelOpen = !!persistedUiState.taskPanelOpen;
  var runtimeProgressState = 'idle';
  var runtimeTodos = [];
  var sessionMemoryAvailable = false;
  var taskPanelAvailable = false;
  var taskPanelActiveCount = 0;
  var taskPanelTotalCount = 0;
  var taskPanelSummary = '';
  var bulkFilesOpen = !!persistedUiState.bulkFilesOpen;
  var jiraContextPanelOpen = false;
  var currentJiraContextKey = '';
  var jiraContextOpenSections = persistedUiState.jiraContextOpenSections && typeof persistedUiState.jiraContextOpenSections === 'object'
    ? persistedUiState.jiraContextOpenSections
    : {};
  var AUTO_APPROVAL_PRESETS = {
    manual: {
      fileCreate: false,
      fileEdit: false,
      fileDelete: false,
      webFetch: false,
      shell: false,
      worktree: false,
      mcp: false
    },
    files: {
      fileCreate: true,
      fileEdit: true,
      fileDelete: true,
      webFetch: false,
      shell: false,
      worktree: false,
      mcp: false
    },
    filesShell: {
      fileCreate: true,
      fileEdit: true,
      fileDelete: true,
      webFetch: false,
      shell: true,
      worktree: false,
      mcp: false
    }
  };
  var AUTO_APPROVAL_PRESET_LABELS = {
    manual: 'Спрашивать всё',
    files: 'Авто для файлов',
    filesShell: 'Файлы + bash',
    custom: 'Пользовательский'
  };
  var composerPermissionsState = {
    fileCreate: true,
    fileEdit: true,
    fileDelete: true,
    webFetch: false,
    shell: false,
    worktree: false,
    mcp: false
  };

  function formatThreadCount(count, form1, form2, form5) {
    var value = Math.max(0, Number(count || 0));
    var mod10 = value % 10;
    var mod100 = value % 100;
    if (mod10 === 1 && mod100 !== 11) return value + ' ' + form1;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return value + ' ' + form2;
    return value + ' ' + form5;
  }

  function createTimelineController(rootEl) {
    var turnSeq = 0;
    var currentTurn = null;

    function createTurn() {
      turnSeq += 1;
      var turnEl = document.createElement('section');
      turnEl.className = 'chat-turn';
      turnEl.dataset.turnId = 'turn-' + turnSeq;

      var requestEl = document.createElement('div');
      requestEl.className = 'chat-turn-request';

      var flowEl = document.createElement('div');
      flowEl.className = 'chat-turn-flow';

      turnEl.appendChild(requestEl);
      turnEl.appendChild(flowEl);
      rootEl.appendChild(turnEl);

      return {
        id: turnEl.dataset.turnId,
        el: turnEl,
        requestEl: requestEl,
        flowEl: flowEl
      };
    }

    function syncTurnState(turn) {
      if (!turn || !turn.el) return;
      var hasRun = turn.flowEl.querySelector('.trace-run') !== null;
      var hasAnswer = turn.flowEl.querySelector('.message.assistant') !== null;
      var hasError = turn.flowEl.querySelector('.message.error, .trace-run.is-error') !== null;
      var hasFileChanges = turn.el.querySelectorAll('.message.file-change').length > 0;

      turn.el.classList.toggle('has-run', hasRun);
      turn.el.classList.toggle('has-answer', hasAnswer);
      turn.el.classList.toggle('has-error', hasError);
      turn.el.classList.toggle('has-file-changes', hasFileChanges);
      turn.el.classList.toggle('is-complete', hasAnswer);
    }

    function closeCurrentTurn(reason) {
      if (!currentTurn) return;
      if (reason === 'next-user' && !currentTurn.flowEl.querySelector('.message.assistant')) {
        currentTurn.el.classList.add('is-open-ended');
      }
      syncTurnState(currentTurn);
      currentTurn = null;
    }

    function describeCurrentTurn() {
      if (!currentTurn) return null;
      var runCount = currentTurn.flowEl.querySelectorAll('.trace-run').length;
      var stepCount = currentTurn.flowEl.querySelectorAll('.trace-step').length;
      var traceRuns = currentTurn.flowEl.querySelectorAll('.trace-run');
      var fileChangeCards = currentTurn.el.querySelectorAll('.message.file-change');
      var fileChangeCount = fileChangeCards.length;
      var addedLines = 0;
      var removedLines = 0;
      var agentUserEdited = 0;
      var userOnlyEdited = 0;
      var toolErrors = 0;
      Array.prototype.forEach.call(fileChangeCards, function (card) {
        addedLines += Number(card.dataset.added || 0) || 0;
        removedLines += Number(card.dataset.removed || 0) || 0;
      });
      Array.prototype.forEach.call(traceRuns, function (run) {
        agentUserEdited += Number(run.dataset.agentUserEdited || 0) || 0;
        userOnlyEdited += Number(run.dataset.userOnlyEdited || 0) || 0;
        toolErrors += Number(run.dataset.toolErrors || 0) || 0;
      });
      var approvalCount = currentTurn.el.querySelectorAll('.approval-request').length;
      return {
        id: currentTurn.id,
        hasRun: runCount > 0,
        runCount: runCount,
        stepCount: stepCount,
        fileChangeCount: fileChangeCount,
        addedLines: addedLines,
        removedLines: removedLines,
        agentUserEdited: agentUserEdited,
        userOnlyEdited: userOnlyEdited,
        toolErrors: toolErrors,
        approvalCount: approvalCount
      };
    }

    function buildAssistantThreadSummary() {
      var info = describeCurrentTurn();
      if (!info || (!info.hasRun && info.fileChangeCount <= 0 && info.approvalCount <= 0)) return '';
      var parts = [];
      if (info.stepCount > 0) parts.push(formatThreadCount(info.stepCount, 'шаг', 'шага', 'шагов'));
      if (info.fileChangeCount > 0) {
        parts.push(formatThreadCount(info.fileChangeCount, 'изменение файла', 'изменения файла', 'изменений файла'));
        parts.push('+' + info.addedLines + ' / -' + info.removedLines);
      }
      if (info.agentUserEdited > 0) parts.push('пользователь изменил строки агента: ' + info.agentUserEdited);
      if (info.userOnlyEdited > 0) parts.push('своих правок пользователя: ' + info.userOnlyEdited);
      if (info.toolErrors > 0) parts.push('ошибок утилит: ' + info.toolErrors);
      if (info.approvalCount > 0) parts.push(formatThreadCount(info.approvalCount, 'согласование', 'согласования', 'согласований'));
      if (parts.length === 0 && info.hasRun) parts.push('выполнение связано с этим ответом');
      return parts.join(' • ');
    }

    function openTurnForUser(node) {
      closeCurrentTurn('next-user');
      currentTurn = createTurn();
      node.dataset.turnRole = 'request';
      currentTurn.requestEl.appendChild(node);
      syncTurnState(currentTurn);
      return currentTurn;
    }

    function appendToCurrentTurn(node, kind) {
      if (currentTurn) {
        if (kind) node.dataset.turnRole = kind;
        currentTurn.flowEl.appendChild(node);
        syncTurnState(currentTurn);
        return currentTurn;
      }
      rootEl.appendChild(node);
      return null;
    }

    function appendAssistant(node) {
      var turn = appendToCurrentTurn(node, 'result');
      if (turn) {
        turn.el.classList.remove('is-open-ended');
        turn.el.classList.add('is-complete');
      }
      closeCurrentTurn('assistant');
      return turn;
    }

    function getDefaultArtifactMount() {
      return currentTurn ? currentTurn.flowEl : rootEl;
    }

    function reset() {
      currentTurn = null;
      turnSeq = 0;
    }

    return {
      openTurnForUser: openTurnForUser,
      appendToCurrentTurn: appendToCurrentTurn,
      appendAssistant: appendAssistant,
      getDefaultArtifactMount: getDefaultArtifactMount,
      describeCurrentTurn: describeCurrentTurn,
      buildAssistantThreadSummary: buildAssistantThreadSummary,
      closeCurrentTurn: closeCurrentTurn,
      reset: reset
    };
  }

  var timeline = createTimelineController(messagesEl);
  messagesEl.__chatTimeline = timeline;

  if (window.ChatMarkdown && window.ChatMarkdown.bindOverlayControls) {
    try {
      window.ChatMarkdown.bindOverlayControls();
    } catch (error) {
      console.error('[ИИ Кодогенератор] Mermaid init failed:', error);
    }
  }

  function countPendingChanges() {
    return document.querySelectorAll('.message.file-change:not(.fc-accepted):not(.fc-rejected):not(.fc-reverted)').length;
  }

  function collectPendingChangeFiles() {
    var cards = document.querySelectorAll('.message.file-change[data-file-path]:not(.fc-accepted):not(.fc-rejected):not(.fc-reverted)');
    var fileMap = Object.create(null);
    var files = [];
    var changeCount = 0;
    var totalAdded = 0;
    var totalRemoved = 0;

    Array.prototype.forEach.call(cards, function (card) {
      var rawPath = String(card.dataset.filePath || '').trim();
      var filePath = rawPath || 'Без пути';
      var added = Number(card.dataset.added || 0) || 0;
      var removed = Number(card.dataset.removed || 0) || 0;

      changeCount += 1;
      totalAdded += added;
      totalRemoved += removed;

      if (!fileMap[filePath]) {
        fileMap[filePath] = {
          filePath: filePath,
          openPath: rawPath,
          changeCount: 0,
          added: 0,
          removed: 0
        };
        files.push(fileMap[filePath]);
      }

      fileMap[filePath].changeCount += 1;
      fileMap[filePath].added += added;
      fileMap[filePath].removed += removed;
    });

    return {
      fileCount: files.length,
      changeCount: changeCount,
      totalAdded: totalAdded,
      totalRemoved: totalRemoved,
      files: files
    };
  }

  function renderBulkFileList(summary) {
    if (!bulkFileListEl) return;
    bulkFileListEl.innerHTML = '';

    if (!summary || !summary.files || !summary.files.length) {
      return;
    }

    summary.files.forEach(function (file) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'bulk-file-row';
      row.dataset.filePath = file.openPath || '';
      row.title = (file.openPath || file.filePath) + ' — открыть файл';

      var main = document.createElement('span');
      main.className = 'bulk-file-main';

      var path = document.createElement('span');
      path.className = 'bulk-file-path';
      path.textContent = file.filePath;
      main.appendChild(path);

      var meta = document.createElement('span');
      meta.className = 'bulk-file-meta';
      meta.textContent = formatThreadCount(file.changeCount, 'изменение', 'изменения', 'изменений');
      main.appendChild(meta);

      var stats = document.createElement('span');
      stats.className = 'bulk-file-stats';

      var added = document.createElement('span');
      added.className = 'bulk-file-stat is-add';
      added.textContent = '+' + file.added;

      var removed = document.createElement('span');
      removed.className = 'bulk-file-stat is-del';
      removed.textContent = '-' + file.removed;

      stats.appendChild(added);
      stats.appendChild(removed);

      row.appendChild(main);
      row.appendChild(stats);
      bulkFileListEl.appendChild(row);
    });
  }

  function updateBulkBar() {
    var count = countPendingChanges();
    var summary = collectPendingChangeFiles();
    if (count > 0 && summary.fileCount > 0) {
      bulkActionsEl.classList.add('visible');
      bulkLabelEl.textContent = formatThreadCount(summary.fileCount, 'файл', 'файла', 'файлов');
      if (bulkMetaEl) {
        bulkMetaEl.textContent = formatThreadCount(summary.changeCount, 'изменение', 'изменения', 'изменений') + ' • +' + summary.totalAdded + ' / -' + summary.totalRemoved;
      }
      renderBulkFileList(summary);
      if (bulkSummaryBtn) {
        bulkSummaryBtn.setAttribute('aria-expanded', bulkFilesOpen ? 'true' : 'false');
      }
      if (bulkCaretEl) {
        bulkCaretEl.textContent = bulkFilesOpen ? '▴' : '▾';
      }
      if (bulkFileListEl) {
        bulkFileListEl.classList.toggle('hidden', !bulkFilesOpen);
      }
      bulkActionsEl.classList.toggle('is-expanded', bulkFilesOpen);
      return;
    }
    bulkFilesOpen = false;
    bulkActionsEl.classList.remove('visible');
    bulkActionsEl.classList.remove('is-expanded');
    if (bulkFileListEl) {
      bulkFileListEl.innerHTML = '';
      bulkFileListEl.classList.add('hidden');
    }
    if (bulkSummaryBtn) {
      bulkSummaryBtn.setAttribute('aria-expanded', 'false');
    }
    if (bulkCaretEl) {
      bulkCaretEl.textContent = '▾';
    }
  }

  function showToast(message, ms) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, ms || 2500);
  }

  function persistUiState() {
    if (typeof vscode.setState !== 'function') return;
    try {
      vscode.setState({
        chatsCollapsed: chatsCollapsed,
        sessionMemoryOpen: sessionMemoryOpen,
        taskPanelOpen: taskPanelOpen,
        bulkFilesOpen: bulkFilesOpen,
        jiraContextOpenSections: jiraContextOpenSections
      });
    } catch (_) {}
  }

  function buildTaskPanelLabel() {
    if (!taskPanelAvailable) return 'Фоновые задачи';
    if (taskPanelActiveCount > 0) {
      return 'Фоновые задачи · ' + formatThreadCount(taskPanelActiveCount, 'активна', 'активны', 'активных');
    }
    if (taskPanelTotalCount > 0) {
      return 'Фоновые задачи · ' + formatThreadCount(taskPanelTotalCount, 'в истории', 'в истории', 'в истории');
    }
    return 'Фоновые задачи';
  }

  function renderUtilityPanels() {
    if (chatUtilityBarEl) {
      chatUtilityBarEl.className = 'chat-utility-bar' + ((sessionMemoryAvailable || taskPanelAvailable) ? '' : ' hidden');
    }

    if (toggleSessionMemoryBtn) {
      toggleSessionMemoryBtn.className = 'btn btn-secondary btn-xs chat-utility-toggle' + (sessionMemoryAvailable ? '' : ' hidden');
      toggleSessionMemoryBtn.textContent = sessionMemoryOpen ? 'Скрыть память сессии' : 'Память сессии';
      toggleSessionMemoryBtn.title = sessionMemoryOpen ? 'Скрыть память сессии' : 'Показать память сессии';
      toggleSessionMemoryBtn.setAttribute('aria-pressed', sessionMemoryOpen ? 'true' : 'false');
    }

    if (toggleTaskPanelBtn) {
      toggleTaskPanelBtn.className = 'btn btn-secondary btn-xs chat-utility-toggle' + (taskPanelAvailable ? '' : ' hidden');
      toggleTaskPanelBtn.textContent = taskPanelOpen ? 'Скрыть · ' + buildTaskPanelLabel() : buildTaskPanelLabel();
      toggleTaskPanelBtn.title = taskPanelOpen ? 'Скрыть фоновые задачи' : 'Показать фоновые задачи';
      toggleTaskPanelBtn.setAttribute('aria-pressed', taskPanelOpen ? 'true' : 'false');
    }

    if (chatSessionMemoryEl) {
      chatSessionMemoryEl.className = 'chat-session-memory' + (sessionMemoryAvailable && sessionMemoryOpen ? '' : ' hidden');
    }
    if (taskPanelEl) {
      taskPanelEl.classList.toggle('hidden', !(taskPanelAvailable && taskPanelOpen));
    }
  }

  function renderChatSidebarState() {
    if (!chatWorkspaceEl || !toggleChatSidebarBtn) return;
    chatWorkspaceEl.classList.toggle('is-sidebar-collapsed', chatsCollapsed);
    toggleChatSidebarBtn.setAttribute('aria-pressed', chatsCollapsed ? 'true' : 'false');
    toggleChatSidebarBtn.setAttribute('aria-label', chatsCollapsed ? 'Показать список чатов' : 'Свернуть список чатов');
    toggleChatSidebarBtn.setAttribute('title', chatsCollapsed ? 'Показать список чатов' : 'Свернуть список чатов');
    toggleChatSidebarBtn.classList.toggle('is-active', chatsCollapsed);
  }

  function toggleChatSidebar() {
    chatsCollapsed = !chatsCollapsed;
    renderChatSidebarState();
    persistUiState();
  }

  function normalizeAutoApproval(value) {
    var source = value && typeof value === 'object' ? value : {};
    return {
      fileCreate: source.fileCreate !== false,
      fileEdit: source.fileEdit !== false,
      fileDelete: source.fileDelete !== false,
      webFetch: source.webFetch === true,
      shell: source.shell === true,
      worktree: source.worktree === true,
      mcp: source.mcp === true
    };
  }

  function isSameAutoApproval(left, right) {
    var a = normalizeAutoApproval(left);
    var b = normalizeAutoApproval(right);
    return a.fileCreate === b.fileCreate
      && a.fileEdit === b.fileEdit
      && a.fileDelete === b.fileDelete
      && a.webFetch === b.webFetch
      && a.shell === b.shell
      && a.worktree === b.worktree
      && a.mcp === b.mcp;
  }

  function getAutoApprovalPresetKey(value) {
    var keys = Object.keys(AUTO_APPROVAL_PRESETS);
    for (var index = 0; index < keys.length; index++) {
      var key = keys[index];
      if (isSameAutoApproval(value, AUTO_APPROVAL_PRESETS[key])) return key;
    }
    return 'custom';
  }

  function buildAutoApprovalHint(value) {
    var warnings = [];
    if (value.webFetch) warnings.push('web_fetch сможет открывать внешние домены без отдельного подтверждения');
    if (value.shell) warnings.push('bash-команды будут запускаться сразу без отдельного подтверждения');
    if (value.worktree) warnings.push('действия с worktree и ветками будут выполняться сразу');
    if (value.mcp) warnings.push('внешние MCP-вызовы будут выполняться сразу');
    if (warnings.length) {
      return {
        text: 'Внимание: ' + warnings.join('; ') + '.',
        warning: true
      };
    }
    if (value.fileEdit) {
      return {
        text: 'Для файловых правок карточки принятия и отклонения изменений всё равно остаются.',
        warning: false
      };
    }
    return {
      text: 'Сейчас агент будет ждать подтверждение перед изменениями и внешними действиями.',
      warning: false
    };
  }

  function applyAutoApprovalPreset(key) {
    if (!AUTO_APPROVAL_PRESETS[key]) return;
    renderComposerPermissions(AUTO_APPROVAL_PRESETS[key]);
    vscode.postMessage({ type: 'saveComposerPermissions', autoApproval: composerPermissionsState });
    showToast('Режим автодействий обновлён', 1800);
  }

  function setComposerPermissionsOpen(open) {
    if (!composerPermissionsPanelEl || !composerPermissionsBtn) return;
    composerPermissionsPanelEl.classList.toggle('hidden', !open);
    composerPermissionsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function renderComposerPermissions(value) {
    composerPermissionsState = normalizeAutoApproval(value);
    if (autoApproveFileCreateEl) autoApproveFileCreateEl.checked = !!composerPermissionsState.fileCreate;
    if (autoApproveFileEditEl) autoApproveFileEditEl.checked = !!composerPermissionsState.fileEdit;
    if (autoApproveFileDeleteEl) autoApproveFileDeleteEl.checked = !!composerPermissionsState.fileDelete;
    if (autoApproveWebFetchEl) autoApproveWebFetchEl.checked = !!composerPermissionsState.webFetch;
    if (autoApproveShellEl) autoApproveShellEl.checked = !!composerPermissionsState.shell;
    if (autoApproveWorktreeEl) autoApproveWorktreeEl.checked = !!composerPermissionsState.worktree;
    if (autoApproveMcpEl) autoApproveMcpEl.checked = !!composerPermissionsState.mcp;
    var presetKey = getAutoApprovalPresetKey(composerPermissionsState);
    Array.prototype.forEach.call(composerPermissionPresetEls || [], function (button) {
      var isActive = button && button.dataset && button.dataset.autoApprovalPreset === presetKey;
      button.classList.toggle('is-active', !!isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (composerPermissionsModeBadgeEl) {
      composerPermissionsModeBadgeEl.textContent = AUTO_APPROVAL_PRESET_LABELS[presetKey] || AUTO_APPROVAL_PRESET_LABELS.custom;
      composerPermissionsModeBadgeEl.classList.toggle('is-custom', presetKey === 'custom');
      composerPermissionsModeBadgeEl.classList.toggle('is-risky', !!composerPermissionsState.webFetch || !!composerPermissionsState.shell || !!composerPermissionsState.worktree || !!composerPermissionsState.mcp);
    }
    if (composerPermissionsHintEl) {
      var hint = buildAutoApprovalHint(composerPermissionsState);
      composerPermissionsHintEl.textContent = hint.text;
      composerPermissionsHintEl.classList.toggle('is-warning', !!hint.warning);
    }
  }

  function collectComposerPermissions() {
    return normalizeAutoApproval({
      fileCreate: autoApproveFileCreateEl && autoApproveFileCreateEl.checked,
      fileEdit: autoApproveFileEditEl && autoApproveFileEditEl.checked,
      fileDelete: autoApproveFileDeleteEl && autoApproveFileDeleteEl.checked,
      webFetch: autoApproveWebFetchEl && autoApproveWebFetchEl.checked,
      shell: autoApproveShellEl && autoApproveShellEl.checked,
      worktree: autoApproveWorktreeEl && autoApproveWorktreeEl.checked,
      mcp: autoApproveMcpEl && autoApproveMcpEl.checked
    });
  }

  function persistComposerPermissions() {
    var next = collectComposerPermissions();
    renderComposerPermissions(next);
    vscode.postMessage({ type: 'saveComposerPermissions', autoApproval: next });
  }

  function createTraceFallback() {
    return {
      appendMessage: function (text, role) {
        var el = document.createElement('div');
        el.className = 'message ' + role;
        el.textContent = text;
        if (role === 'user' && messagesEl.__chatTimeline) {
          messagesEl.__chatTimeline.openTurnForUser(el);
        } else if (role === 'assistant' && messagesEl.__chatTimeline) {
          messagesEl.__chatTimeline.appendAssistant(el);
        } else if (messagesEl.__chatTimeline) {
          messagesEl.__chatTimeline.appendToCurrentTurn(el, role);
        } else {
          messagesEl.appendChild(el);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      },
      handleTraceEvent: function (msg) {
        if (msg && msg.text) this.appendMessage(msg.text, 'status');
      },
      startRun: function () {},
      finishRun: function () {},
      resetView: function () {
        if (messagesEl.__chatTimeline && typeof messagesEl.__chatTimeline.reset === 'function') {
          messagesEl.__chatTimeline.reset();
        }
        messagesEl.innerHTML = '';
      }
    };
  }

  function createChangesFallback() {
    return {
      appendApprovalRequest: function () {},
      resolveApproval: function () {},
      appendQuestionRequest: function () {},
      resolveQuestion: function () {},
      appendFileChange: function () {},
      markChangeStatus: function () {},
      appendCheckpoint: function () {},
      syncCheckpointsList: function () {},
      updateCheckpoint: function () {},
      markCheckpointReverted: function () {},
      handleUndoRevertDone: function () {},
      handleCheckpointBranchCommitted: function () {}
    };
  }

  function createFollowupsFallback() {
    return {
      setBusy: function () {},
      markRequestStarted: function () {},
      setSuggestions: function () {},
      setState: function () {},
      restore: function () {}
      ,
      setHidden: function () {}
    };
  }

  function createSessionsFallback() {
    return {
      setBusy: function () {},
      setSessions: function () {}
    };
  }

  function createTodosFallback() {
    return {
      setTodos: function () {},
      setVisible: function () {}
    };
  }

  function createTasksFallback() {
    return {
      setTasks: function () {}
    };
  }

  function createMetricsFallback() {
    return {
      resetFromSnapshot: function () {},
      recordUserRequest: function () {},
      recordAssistantResponse: function () {},
      recordAgentRunStarted: function () {},
      recordTraceEvent: function () {},
      recordFileChange: function () {},
      recordChangeMetrics: function () {},
      recordCheckpointReverted: function () {},
      recordUndoRevert: function () {}
    };
  }

  function safeCreateController(factory, fallback, label) {
    try {
      return factory();
    } catch (error) {
      console.error('[ИИ Кодогенератор] ' + label + ' init failed:', error);
      return fallback();
    }
  }

  var trace = safeCreateController(function () {
    return window.ChatTrace && window.ChatTrace.createTraceController
      ? window.ChatTrace.createTraceController({ messagesEl: messagesEl })
      : createTraceFallback();
  }, createTraceFallback, 'trace controller');

  var changes = safeCreateController(function () {
    return window.ChatChanges && window.ChatChanges.createChangeController
      ? window.ChatChanges.createChangeController({
          messagesEl: messagesEl,
          vscode: vscode,
          updateBulkBar: updateBulkBar,
          onEditCheckpointRequest: handleCheckpointRequestEdit,
          onRepeatCheckpointRequest: handleCheckpointRequestRepeat
        })
      : createChangesFallback();
  }, createChangesFallback, 'changes controller');

  var followups = safeCreateController(function () {
    return window.ChatFollowups && window.ChatFollowups.createFollowupController
      ? window.ChatFollowups.createFollowupController({
          panelEl: followupsPanelEl,
          titleEl: followupsTitleEl,
          metaEl: followupsMetaEl,
          badgeEl: followupsBadgeEl,
          listEl: followupsListEl,
          refreshBtn: refreshFollowupsBtn,
          onSelect: function (query) {
            sendText(query);
          },
          onRefresh: function () {
            vscode.postMessage({ type: 'refreshSuggestions' });
            followups.setState({
              state: 'loading',
              summary: 'Обновляю следующие шаги по текущему диалогу...',
              hasConversation: true
            });
          }
        })
      : createFollowupsFallback();
  }, createFollowupsFallback, 'followups controller');

  var sessions = safeCreateController(function () {
    return window.ChatSessions && window.ChatSessions.createSessionController
      ? window.ChatSessions.createSessionController({
          vscode: vscode,
          titleEl: chatSessionTitleEl,
          metaEl: chatSessionMetaEl,
          listEl: chatSessionsListEl,
          jiraProjectSelectEl: jiraProjectSelectEl,
          jiraRefreshBtn: refreshJiraProjectsBtn,
          jiraStatusEl: jiraChatScopeStatusEl,
          newBtn: newChatBtn,
          quickNewBtn: quickNewChatBtn,
          clearBtn: clearChatBtn
        })
      : createSessionsFallback();
  }, createSessionsFallback, 'sessions controller');

  var todos = safeCreateController(function () {
    return window.ChatTodos && window.ChatTodos.createTodoController
      ? window.ChatTodos.createTodoController({
          panelEl: todoPanelEl,
          metaEl: todoMetaEl,
          listEl: todoListEl
        })
      : createTodosFallback();
  }, createTodosFallback, 'todos controller');

  var tasks = safeCreateController(function () {
    return window.ChatTasks && window.ChatTasks.createTaskController
      ? window.ChatTasks.createTaskController({
          vscode: vscode,
          panelEl: taskPanelEl,
          metaEl: taskMetaEl,
          listEl: taskListEl,
          refreshBtn: refreshTasksBtn,
          onStateChange: updateTaskPanelState
        })
      : createTasksFallback();
  }, createTasksFallback, 'tasks controller');

  var metrics = safeCreateController(function () {
    return window.ChatSessionMetrics && window.ChatSessionMetrics.createMetricsController
      ? window.ChatSessionMetrics.createMetricsController({
          rootEl: chatSessionMetricsEl
        })
      : createMetricsFallback();
  }, createMetricsFallback, 'metrics controller');

  function syncAssistPanels() {
    var showPlan = runtimeTodos.length > 0 && (runtimeProgressState === 'running' || runtimeProgressState === 'waiting');
    todos.setVisible(showPlan);
    followups.setHidden(showPlan);
  }

  function setLoading(on) {
    agentRunning = on;
    inputEl.disabled = on;
    followups.setBusy(on);
    sessions.setBusy(on);
    if (on) {
      sendBtn.textContent = '■ Стоп';
      sendBtn.classList.add('btn-stop');
      sendBtn.classList.remove('btn-primary');
      sendBtn.disabled = false;
      return;
    }
    sendBtn.textContent = 'Отправить';
    sendBtn.classList.remove('btn-stop');
    sendBtn.classList.add('btn-primary');
    sendBtn.disabled = false;
  }

  function updateRuntimeState(mode, awaitingPlanApproval, pendingApproval, pendingQuestion) {
    if (!chatModeBadgeEl) return;
    var isPlan = mode === 'plan';
    var waiting = !!awaitingPlanApproval;
    chatModeBadgeEl.classList.toggle('hidden', !isPlan && !waiting);
    chatModeBadgeEl.classList.toggle('is-pending', waiting);
    chatModeBadgeEl.textContent = waiting ? 'План на согласовании' : 'Режим плана';

    if (chatPendingApprovalEl) {
      var pending = pendingQuestion || pendingApproval || null;
      var pendingSummary = pending && pending.summary ? String(pending.summary) : '';
      var pendingDetail = pending && pending.detail ? String(pending.detail) : '';
      var pendingText = pendingSummary ? pendingSummary + (pendingDetail ? ' · ' + pendingDetail : '') : '';
      chatPendingApprovalEl.className = 'chat-pending-approval' + (pendingText ? '' : ' hidden');
      chatPendingApprovalEl.textContent = pendingText;
      chatPendingApprovalEl.title = pendingText;
    }
  }

  function formatRelativeTime(timestamp) {
    var value = Number(timestamp || 0);
    if (!value) return '';
    var diffSec = Math.max(0, Math.floor((Date.now() - value) / 1000));
    if (diffSec < 5) return 'только что';
    if (diffSec < 60) return diffSec + 'с назад';
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'м назад';
    var diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return diffHours + 'ч назад';
    var diffDays = Math.floor(diffHours / 24);
    return diffDays + 'д назад';
  }

  function shortPath(filePath) {
    var value = String(filePath || '');
    if (!value) return '';
    var normalized = value.replace(/\\/g, '/');
    var marker = '/.cursorcoder/';
    var markerIndex = normalized.indexOf(marker);
    if (markerIndex >= 0) {
      return normalized.slice(markerIndex + 1);
    }
    var parts = normalized.split('/').filter(Boolean);
    return parts.slice(-3).join('/');
  }

  function updateSessionMemory(memory) {
    if (!chatSessionMemoryEl) return;
    var title = memory && memory.title ? String(memory.title) : '';
    var currentState = memory && memory.currentState ? String(memory.currentState) : '';
    var memoryPath = memory && memory.memoryPath ? String(memory.memoryPath) : '';
    var updatedAt = memory && memory.lastUpdatedAt ? Number(memory.lastUpdatedAt) : 0;
    var summary = memory && memory.summary ? String(memory.summary) : '';
    var visible = !!(title || currentState || summary || memoryPath);
    sessionMemoryAvailable = visible;

    if (!visible) {
      chatSessionMemoryEl.removeAttribute('data-file-path');
      if (chatSessionMemoryTitleEl) chatSessionMemoryTitleEl.textContent = '';
      if (chatSessionMemoryStateEl) chatSessionMemoryStateEl.textContent = '';
      if (chatSessionMemoryMetaEl) chatSessionMemoryMetaEl.textContent = '';
      if (openSessionMemoryBtn) openSessionMemoryBtn.disabled = true;
      renderUtilityPanels();
      return;
    }

    chatSessionMemoryEl.dataset.filePath = memoryPath || '';
    if (chatSessionMemoryTitleEl) {
      chatSessionMemoryTitleEl.textContent = title || 'Память сессии';
      chatSessionMemoryTitleEl.title = title || 'Память сессии';
    }
    if (chatSessionMemoryStateEl) {
      chatSessionMemoryStateEl.textContent = currentState || summary || 'Память сессии обновлена.';
      chatSessionMemoryStateEl.title = currentState || summary || 'Память сессии';
    }
    if (chatSessionMemoryMetaEl) {
      var metaParts = [];
      var shortMemoryPath = shortPath(memoryPath);
      if (shortMemoryPath) metaParts.push(shortMemoryPath);
      if (updatedAt) metaParts.push('обновлено ' + formatRelativeTime(updatedAt));
      chatSessionMemoryMetaEl.textContent = metaParts.join(' • ');
      chatSessionMemoryMetaEl.title = [memoryPath, updatedAt ? 'обновлено ' + formatRelativeTime(updatedAt) : ''].filter(Boolean).join('\n');
    }
    if (openSessionMemoryBtn) {
      openSessionMemoryBtn.disabled = !memoryPath;
    }
    renderUtilityPanels();
  }

  function updateJiraContext(context) {
    if (!jiraContextPanelEl) return;
    var visible = !!(context && (context.issueKey || context.workItemId));
    var system = context && context.system === 'tfs' ? 'tfs' : 'jira';
    var issueKey = visible ? String(context.issueKey || (context.workItemId ? '#' + context.workItemId : '')) : '';
    var contextKey = visible ? system + ':' + issueKey : '';
    if (contextKey !== currentJiraContextKey) {
      currentJiraContextKey = contextKey;
      jiraContextPanelOpen = false;
    }
    updateJiraContextToggle(visible);
    jiraContextPanelEl.classList.toggle('hidden', !visible || !jiraContextPanelOpen);
    if (!visible) {
      jiraContextPanelOpen = false;
      if (jiraContextTitleEl) jiraContextTitleEl.textContent = '';
      if (jiraContextMetaEl) jiraContextMetaEl.textContent = '';
      if (jiraContextDescriptionEl) jiraContextDescriptionEl.textContent = '';
      if (jiraContextCommitsEl) jiraContextCommitsEl.innerHTML = '';
      if (jiraContextLinkEl) jiraContextLinkEl.classList.add('hidden');
      return;
    }

    var title = context.issueKey + (context.title ? ' • ' + context.title : '');
    if (jiraContextTitleEl) {
      jiraContextTitleEl.textContent = title;
      jiraContextTitleEl.title = title;
    }

    var meta = [];
    if (context.project) meta.push(context.project);
    if (context.status) meta.push('Статус: ' + context.status);
    if (context.loading) meta.push('обновляю контекст');
    else if (context.updatedAt) meta.push('обновлено ' + formatRelativeTime(context.updatedAt));
    if (Array.isArray(context.meta)) {
      context.meta.slice(0, 4).forEach(function (item) {
        if (item) meta.push(String(item));
      });
    }
    if (jiraContextMetaEl) {
      jiraContextMetaEl.textContent = meta.join(' • ');
      jiraContextMetaEl.title = meta.join('\n');
    }

    if (jiraContextLinkEl) {
      if (context.url) {
        jiraContextLinkEl.href = context.url;
        jiraContextLinkEl.title = system === 'tfs' ? 'Открыть work item TFS' : 'Открыть задачу Jira';
        jiraContextLinkEl.classList.remove('hidden');
      } else {
        jiraContextLinkEl.classList.add('hidden');
      }
    }

    if (jiraContextDescriptionEl) {
      var description = context.description || (context.error ? 'Контекст задачи пока не загрузился: ' + context.error : 'Описание задачи не заполнено.');
      jiraContextDescriptionEl.textContent = description;
      jiraContextDescriptionEl.title = description;
    }

    if (!jiraContextCommitsEl) return;
    jiraContextCommitsEl.innerHTML = '';
    var sections = Array.isArray(context.sections) ? context.sections : [];
    sections.forEach(function (section) {
      if (!section || !Array.isArray(section.items) || !section.items.length) return;
      var sectionEl = createJiraContextSection(context, section.title || 'Блок', countJiraContextItems(section.items));
      var contentEl = sectionEl.querySelector('.jira-context-section-content');
      section.items.forEach(function (item) {
        if (!item || !contentEl) return;
        var itemEl = document.createElement('div');
        itemEl.className = 'jira-context-section-item';
        itemEl.textContent = String(item);
        itemEl.title = String(item);
        contentEl.appendChild(itemEl);
      });
      jiraContextCommitsEl.appendChild(sectionEl);
    });

    var commits = Array.isArray(context.commits) ? context.commits : [];
    var commitsSection = createJiraContextSection(context, 'Коммиты', commits.length);
    var commitsContentEl = commitsSection.querySelector('.jira-context-section-content');
    if (!commits.length && commitsContentEl) {
      var emptyCommits = document.createElement('div');
      emptyCommits.className = 'jira-context-section-item muted';
      emptyCommits.textContent = 'не найдены' + (context.repositoriesChecked ? ' · проверено репозиториев: ' + context.repositoriesChecked : '');
      commitsContentEl.appendChild(emptyCommits);
    }

    commits.slice(0, 8).forEach(function (commit) {
      var card = document.createElement('div');
      card.className = 'jira-context-commit';

      var line = document.createElement('div');
      line.className = 'jira-context-commit-line';
      line.textContent = [
        commit.shortHash || commit.hash || '',
        commit.date || '',
        commit.author || '',
        commit.subject || ''
      ].filter(Boolean).join(' • ');

      var repo = document.createElement('div');
      repo.className = 'jira-context-commit-repo';
      repo.textContent = [
        commit.repository || '',
        commit.currentBranch ? 'текущая ветка: ' + commit.currentBranch : ''
      ].filter(Boolean).join(' • ');

      var branches = document.createElement('div');
      branches.className = 'jira-context-commit-branches';
      branches.textContent = commit.branches && commit.branches.length
        ? 'Ветки: ' + commit.branches.join(', ')
        : 'Ветки: не найдены';

      var suggestion = document.createElement('div');
      suggestion.className = 'jira-context-commit-suggestion';
      suggestion.textContent = commit.suggestion || '';

      card.appendChild(line);
      card.appendChild(repo);
      card.appendChild(branches);
      if (commit.suggestion) card.appendChild(suggestion);
      if (commitsContentEl) commitsContentEl.appendChild(card);
    });
    jiraContextCommitsEl.appendChild(commitsSection);
  }

  function updateJiraContextToggle(available) {
    if (!toggleJiraContextBtn) return;
    toggleJiraContextBtn.classList.toggle('hidden', !available);
    toggleJiraContextBtn.classList.toggle('is-active', !!available && jiraContextPanelOpen);
    toggleJiraContextBtn.setAttribute('aria-expanded', available && jiraContextPanelOpen ? 'true' : 'false');
    toggleJiraContextBtn.setAttribute(
      'title',
      jiraContextPanelOpen ? 'Скрыть информацию по задаче' : 'Показать информацию по задаче'
    );
    toggleJiraContextBtn.setAttribute(
      'aria-label',
      jiraContextPanelOpen ? 'Скрыть информацию по задаче' : 'Показать информацию по задаче'
    );
  }

  function createJiraContextSection(context, title, count) {
    var system = context && context.system === 'tfs' ? 'tfs' : 'jira';
    var key = [system, context && context.issueKey ? context.issueKey : 'task', title || 'section'].join(':');
    var details = document.createElement('details');
    details.className = 'jira-context-section';
    details.open = jiraContextOpenSections[key] === true;
    details.addEventListener('toggle', function () {
      jiraContextOpenSections[key] = details.open;
      persistUiState();
    });

    var summary = document.createElement('summary');
    summary.className = 'jira-context-section-summary';

    var titleEl = document.createElement('span');
    titleEl.className = 'jira-context-section-title';
    titleEl.textContent = title || 'Блок';

    var countEl = document.createElement('span');
    countEl.className = 'jira-context-section-count';
    countEl.textContent = String(Math.max(0, Number(count) || 0));

    summary.appendChild(titleEl);
    summary.appendChild(countEl);
    details.appendChild(summary);

    var content = document.createElement('div');
    content.className = 'jira-context-section-content';
    details.appendChild(content);
    return details;
  }

  function countJiraContextItems(items) {
    if (!Array.isArray(items)) return 0;
    return items.filter(function (item) {
      return item && !/^ещё\s+\d+/i.test(String(item).trim());
    }).length;
  }

  function updateTaskPanelState(payload) {
    var hasTasks = !!(payload && payload.hasTasks);
    taskPanelAvailable = hasTasks;
    taskPanelActiveCount = payload && Number(payload.activeCount || 0);
    taskPanelTotalCount = payload && Number(payload.totalCount || 0);
    taskPanelSummary = payload && payload.summary ? String(payload.summary) : '';
    if (!hasTasks) {
      taskPanelOpen = false;
    }
    renderUtilityPanels();
  }

  function updateRuntimeProgress(progress) {
    if (!chatRuntimeSummaryEl) return;
    var state = progress && progress.state ? progress.state : 'idle';
    runtimeProgressState = state;
    var summary = progress && progress.summary ? String(progress.summary) : '';
    var detail = progress && progress.detail ? String(progress.detail) : '';
    var activitySummary = progress && progress.activitySummary ? String(progress.activitySummary) : '';
    var backgroundSummary = progress && progress.backgroundSummary ? String(progress.backgroundSummary) : '';
    var connectionState = progress && progress.connectionState ? String(progress.connectionState) : 'idle';
    var connectionSummary = progress && progress.connectionSummary ? String(progress.connectionSummary) : '';
    var connectionDetail = progress && progress.connectionDetail ? String(progress.connectionDetail) : '';
    var lastCompletedSummary = progress && progress.lastCompletedSummary ? String(progress.lastCompletedSummary) : '';
    var lastCompletedDetail = progress && progress.lastCompletedDetail ? String(progress.lastCompletedDetail) : '';
    var context = progress && progress.context && typeof progress.context === 'object' ? progress.context : {};
    var contextMessageCount = Number(context.messageCount || 0);
    var contextChars = Number(context.messageChars || 0);
    var contextMaxChars = Number(context.maxContextChars || 0);
    var contextEstimatedTokens = Number(context.estimatedInputTokens || 0);
    var contextPromptTokens = Number(context.lastPromptTokens || 0);
    var contextCompletionTokens = Number(context.lastCompletionTokens || 0);
        var contextTotalTokens = Number(context.lastTotalTokens || 0);
        var contextModel = context && context.model ? String(context.model) : '';
        if (trace && typeof trace.updateModelUsage === 'function') {
          trace.updateModelUsage(context);
        }
        var connectionVisible = !!connectionSummary && connectionState === 'reconnecting';
    var visible = !!summary && state !== 'idle';
    var contextVisible = contextMessageCount > 0 || contextChars > 0 || contextTotalTokens > 0;
    var activityVisible = !!activitySummary && (state === 'running' || state === 'waiting') && activitySummary !== summary;
    var narrativeVisible = !!backgroundSummary && (state === 'running' || state === 'waiting');

    chatRuntimeSummaryEl.className = 'chat-runtime-summary' + (visible ? '' : ' hidden') + (state ? ' is-' + state : '');
    if (chatConnectionStatusEl) {
      chatConnectionStatusEl.className = 'chat-connection-status' + (connectionVisible ? '' : ' hidden') + (connectionVisible ? ' is-reconnecting' : '');
    }
    if (chatContextUsageEl) {
      chatContextUsageEl.className = 'chat-context-usage' + (contextVisible ? '' : ' hidden') + (state ? ' is-' + state : '');
    }
    if (chatRuntimeActivityEl) {
      chatRuntimeActivityEl.className = 'chat-runtime-activity' + (activityVisible ? '' : ' hidden') + (state ? ' is-' + state : '');
    }
    if (chatRuntimeNarrativeEl) {
      chatRuntimeNarrativeEl.className = 'chat-runtime-narrative' + (narrativeVisible ? '' : ' hidden') + (state ? ' is-' + state : '');
    }
    if (!visible && !connectionVisible && !contextVisible && !activityVisible && !narrativeVisible) {
      chatRuntimeSummaryEl.textContent = '';
      chatRuntimeSummaryEl.title = '';
      if (chatConnectionStatusEl) {
        chatConnectionStatusEl.textContent = '';
        chatConnectionStatusEl.title = '';
      }
      if (chatContextUsageEl) {
        chatContextUsageEl.textContent = '';
        chatContextUsageEl.title = '';
      }
      if (chatRuntimeActivityEl) {
        chatRuntimeActivityEl.textContent = '';
        chatRuntimeActivityEl.title = '';
      }
      if (chatRuntimeNarrativeEl) {
        chatRuntimeNarrativeEl.textContent = '';
        chatRuntimeNarrativeEl.title = '';
      }
      syncAssistPanels();
      return;
    }

    if (chatConnectionStatusEl) {
      var connectionLine = connectionDetail ? connectionSummary + ' · ' + connectionDetail : connectionSummary;
      var connectionTitle = connectionDetail ? connectionSummary + '\n' + connectionDetail : connectionSummary;
      chatConnectionStatusEl.textContent = connectionVisible ? connectionLine : '';
      chatConnectionStatusEl.title = connectionVisible ? connectionTitle : '';
    }
    if (chatContextUsageEl) {
      var contextParts = [];
      var contextTitleParts = [];
      if (contextMessageCount > 0) {
        contextParts.push('Контекст: ' + contextMessageCount + ' сообщ.');
        contextTitleParts.push('Сообщений в текущем запросе: ' + contextMessageCount);
      }
      if (contextChars > 0) {
        var ratio = contextMaxChars > 0 ? Math.min(999, Math.round((contextChars / contextMaxChars) * 100)) : 0;
        contextParts.push(formatCompactNumber(contextChars) + (contextMaxChars > 0 ? ' / ' + formatCompactNumber(contextMaxChars) + ' симв. (' + ratio + '%)' : ' симв.'));
        contextTitleParts.push('Размер контекста: ' + formatCompactNumber(contextChars) + ' символов' + (contextMaxChars > 0 ? ' из ' + formatCompactNumber(contextMaxChars) : ''));
      }
      if (contextEstimatedTokens > 0) {
        contextParts.push('≈ ' + formatCompactNumber(contextEstimatedTokens) + ' ток.');
        contextTitleParts.push('Оценка входных токенов: ≈ ' + formatCompactNumber(contextEstimatedTokens));
      }
      if (contextTotalTokens > 0 || contextPromptTokens > 0 || contextCompletionTokens > 0) {
        var apiUsageLine = 'API';
        if (contextPromptTokens > 0 || contextCompletionTokens > 0) {
          apiUsageLine += ': ' + formatCompactNumber(contextPromptTokens) + ' in + ' + formatCompactNumber(contextCompletionTokens) + ' out';
          if (contextTotalTokens > 0) apiUsageLine += ' = ' + formatCompactNumber(contextTotalTokens);
        } else if (contextTotalTokens > 0) {
          apiUsageLine += ': ' + formatCompactNumber(contextTotalTokens) + ' ток.';
        }
        contextParts.push(apiUsageLine);
        contextTitleParts.push('Последний ответ модели: ' + apiUsageLine);
      }
      if (contextModel) {
        contextTitleParts.push('Модель: ' + contextModel);
      }
      chatContextUsageEl.textContent = contextVisible ? contextParts.join(' • ') : '';
      chatContextUsageEl.title = contextVisible ? contextTitleParts.join('\n') : '';
    }

    if (!visible) {
      chatRuntimeSummaryEl.textContent = '';
      chatRuntimeSummaryEl.title = '';
      if (chatRuntimeActivityEl) {
        chatRuntimeActivityEl.textContent = activityVisible ? 'Сейчас: ' + activitySummary : '';
        chatRuntimeActivityEl.title = activityVisible ? activitySummary : '';
      }
      if (chatRuntimeNarrativeEl) {
        chatRuntimeNarrativeEl.textContent = narrativeVisible ? backgroundSummary : '';
        chatRuntimeNarrativeEl.title = narrativeVisible ? backgroundSummary : '';
      }
      syncAssistPanels();
      return;
    }

    var line = detail ? summary + ' · ' + detail : summary;
    var title = detail ? summary + '\n' + detail : summary;

    if ((state === 'running' || state === 'waiting') && lastCompletedSummary && lastCompletedSummary !== summary) {
      var lastLine = 'последнее: ' + lastCompletedSummary + (lastCompletedDetail ? ' · ' + lastCompletedDetail : '');
      line += ' • ' + lastLine;
      title += '\n' + lastLine;
    }

    chatRuntimeSummaryEl.textContent = line;
    chatRuntimeSummaryEl.title = title;
    if (chatRuntimeActivityEl) {
      chatRuntimeActivityEl.textContent = activityVisible ? 'Сейчас: ' + activitySummary : '';
      chatRuntimeActivityEl.title = activityVisible ? activitySummary : '';
    }
    if (chatRuntimeNarrativeEl) {
      chatRuntimeNarrativeEl.textContent = narrativeVisible ? backgroundSummary : '';
      chatRuntimeNarrativeEl.title = narrativeVisible ? backgroundSummary : '';
    }
    syncAssistPanels();
  }

  function formatCompactNumber(value) {
    var number = Number(value || 0);
    if (!isFinite(number) || number <= 0) return '0';
    if (number < 1000) return String(Math.round(number));
    if (number < 1000000) return (number / 1000).toFixed(number >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return (number / 1000000).toFixed(number >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'm';
  }

  function populateComposerWithText(rawText, options) {
    var text = String(rawText || '');
    if (!inputEl) return false;
    inputEl.value = text;
    if (options && options.focus === false) return true;
    inputEl.focus();
    try {
      var start = options && options.selectAll ? 0 : inputEl.value.length;
      var end = options && options.selectAll ? inputEl.value.length : start;
      inputEl.setSelectionRange(start, end);
    } catch (_) {}
    return true;
  }

  function handleCheckpointRequestEdit(text) {
    if (!String(text || '').trim()) {
      showToast('Не удалось восстановить текст запроса', 2200);
      return;
    }
    populateComposerWithText(text, { focus: true });
    showToast('Запрос возвращён в поле ввода', 1800);
  }

  function handleCheckpointRequestRepeat(text) {
    if (agentRunning) {
      showToast('Сначала дождитесь завершения текущего запуска', 2200);
      return;
    }
    if (!String(text || '').trim()) {
      showToast('Не удалось повторить пустой запрос', 2200);
      return;
    }
    sendText(text);
  }

  function sendText(raw) {
    var text = (raw || '').trim();
    if (!text || agentRunning) return;
    vscode.postMessage({ type: 'send', text: text });
    trace.appendMessage(text, 'user');
    metrics.recordUserRequest();
    followups.markRequestStarted();
    inputEl.value = '';
    setLoading(true);
  }

  function restoreConversationTimeline(messages, traceRuns, artifactEvents) {
    var history = Array.isArray(messages) ? messages : [];
    var runsToReplay = Array.isArray(traceRuns) ? traceRuns : [];
    var artifacts = Array.isArray(artifactEvents) ? artifactEvents : [];
    var runIndex = 0;
    var artifactsByRunId = {};
    var replayedRunsById = {};
    var looseArtifacts = [];
    var resolvedApprovalIds = Object.create(null);
    var resolvedQuestionIds = Object.create(null);

    artifacts.forEach(function (artifact) {
      if (!artifact || !artifact.kind || !artifact.payload) return;
      if (artifact.kind === 'approvalResolved' && artifact.payload.confirmId) {
        resolvedApprovalIds[String(artifact.payload.confirmId)] = true;
        return;
      }
      if (artifact.kind === 'questionResolved' && artifact.payload.confirmId) {
        resolvedQuestionIds[String(artifact.payload.confirmId)] = true;
      }
    });

    artifacts.forEach(function (artifact) {
      if (artifact && typeof artifact.runId === 'string' && artifact.runId) {
        if (!artifactsByRunId[artifact.runId]) artifactsByRunId[artifact.runId] = [];
        artifactsByRunId[artifact.runId].push(artifact);
        return;
      }
      looseArtifacts.push(artifact);
    });

    function replayArtifactsForRun(run) {
      if (!run || !run.id) return;
      var runArtifacts = artifactsByRunId[run.id];
      if (!Array.isArray(runArtifacts)) return;
      runArtifacts.forEach(function (artifact) {
        replayArtifact(artifact);
      });
      delete artifactsByRunId[run.id];
    }

    function replayArtifact(artifact) {
      if (!artifact) return;
      if (artifact.kind === 'statusMessage' && artifact.payload && typeof artifact.payload.text === 'string') {
        if (artifact.runId && replayedRunsById[artifact.runId] && trace.appendRunNote) {
          trace.appendRunNote(
            replayedRunsById[artifact.runId],
            artifact.payload.text,
            'muted',
            'artifact-status:' + artifact.payload.text
          );
          return;
        }
        trace.appendMessage(artifact.payload.text, 'status');
        return;
      }
      if (artifact.kind === 'errorMessage' && artifact.payload && typeof artifact.payload.text === 'string') {
        if (artifact.runId && replayedRunsById[artifact.runId] && trace.appendRunNote) {
          trace.appendRunNote(
            replayedRunsById[artifact.runId],
            artifact.payload.text,
            'warning',
            'artifact-error:' + artifact.payload.text
          );
          return;
        }
        trace.appendMessage(artifact.payload.text, 'error');
        return;
      }
          if (changes && changes.replayArtifact) {
            changes.replayArtifact(artifact);
            if (artifact.kind === 'fileChange' && trace && typeof trace.recordFileChangeForRun === 'function') {
              trace.recordFileChangeForRun(
                artifact.runId && replayedRunsById[artifact.runId] ? replayedRunsById[artifact.runId] : null,
                artifact.payload || {}
              );
            }
            var syntheticResolution = buildReplayResolutionForOrphanedArtifact(artifact);
        if (syntheticResolution) {
          changes.replayArtifact(syntheticResolution);
        }
      }
    }

    function buildReplayResolutionForOrphanedArtifact(artifact) {
      if (!artifact || !artifact.kind || !artifact.payload) return null;
      if (artifact.kind === 'approvalRequest' && artifact.payload.confirmId) {
        var approvalConfirmId = String(artifact.payload.confirmId);
        if (resolvedApprovalIds[approvalConfirmId]) return null;
        return {
          kind: 'approvalResolved',
          payload: buildReloadCancelledApprovalResult(artifact.payload)
        };
      }
      if (artifact.kind === 'questionRequest' && artifact.payload.confirmId) {
        var questionConfirmId = String(artifact.payload.confirmId);
        if (resolvedQuestionIds[questionConfirmId]) return null;
        return {
          kind: 'questionResolved',
          payload: {
            kind: 'question',
            confirmId: questionConfirmId,
            answered: false,
            answers: {},
            cancelled: true,
            reason: 'Ожидание прервано после перезапуска или восстановления чата.'
          }
        };
      }
      return null;
    }

    function buildReloadCancelledApprovalResult(request) {
      var base = {
        kind: request.kind,
        confirmId: String(request.confirmId || ''),
        approved: false,
        cancelled: true,
        reason: 'Ожидание прервано после перезапуска или восстановления чата.'
      };

      if (request.kind === 'shell') {
        return {
          kind: 'shell',
          confirmId: base.confirmId,
          approved: false,
          cancelled: true,
          reason: base.reason,
          command: request.command || ''
        };
      }

      if (request.kind === 'plan') {
        return {
          kind: 'plan',
          confirmId: base.confirmId,
          approved: false,
          cancelled: true,
          reason: base.reason,
          plan: request.plan || '',
          feedback: base.reason
        };
      }

      if (request.kind === 'worktree') {
        return {
          kind: 'worktree',
          confirmId: base.confirmId,
          approved: false,
          cancelled: true,
          reason: base.reason
        };
      }

      if (request.kind === 'mcp') {
        return {
          kind: 'mcp',
          confirmId: base.confirmId,
          approved: false,
          cancelled: true,
          reason: base.reason
        };
      }

      if (request.kind === 'web') {
        return {
          kind: 'web',
          confirmId: base.confirmId,
          approved: false,
          cancelled: true,
          reason: base.reason
        };
      }

      return {
        kind: 'file',
        confirmId: base.confirmId,
        approved: false,
        cancelled: true,
        reason: base.reason
      };
    }

    history.forEach(function (item) {
      if (!item || !item.role || typeof item.content !== 'string') return;
      if (item.role === 'user') {
        trace.appendMessage(item.content, item.role);
        return;
      }
      if (item.role === 'assistant') {
        if (runsToReplay[runIndex] && trace.replayRun) {
          var replayedRun = trace.replayRun(runsToReplay[runIndex]);
          if (replayedRun && runsToReplay[runIndex] && runsToReplay[runIndex].id) {
            replayedRunsById[runsToReplay[runIndex].id] = replayedRun;
          }
          replayArtifactsForRun(runsToReplay[runIndex]);
          runIndex += 1;
        }
        trace.appendMessage(item.content, item.role);
      }
    });

    while (runIndex < runsToReplay.length) {
      if (trace.replayRun) {
        var replayedTrailingRun = trace.replayRun(runsToReplay[runIndex]);
        if (replayedTrailingRun && runsToReplay[runIndex] && runsToReplay[runIndex].id) {
          replayedRunsById[runsToReplay[runIndex].id] = replayedTrailingRun;
        }
      }
      replayArtifactsForRun(runsToReplay[runIndex]);
      runIndex += 1;
    }

    looseArtifacts.forEach(function (artifact) {
      replayArtifact(artifact);
    });
    Object.keys(artifactsByRunId).forEach(function (runId) {
      artifactsByRunId[runId].forEach(function (artifact) {
        replayArtifact(artifact);
      });
    });
  }

  function wireEvents() {
    acceptAllBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'acceptAll' });
    });
    rejectAllBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'rejectAll' });
    });
    if (bulkSummaryBtn) {
      bulkSummaryBtn.addEventListener('click', function () {
        var summary = collectPendingChangeFiles();
        if (!summary.fileCount) return;
        bulkFilesOpen = !bulkFilesOpen;
        persistUiState();
        updateBulkBar();
      });
    }
    if (bulkFileListEl) {
      bulkFileListEl.addEventListener('click', function (event) {
        var row = event.target && event.target.closest ? event.target.closest('.bulk-file-row') : null;
        if (!row) return;
        var filePath = String(row.dataset.filePath || '').trim();
        if (!filePath) return;
        vscode.postMessage({ type: 'openChangedFile', filePath: filePath });
      });
    }

    sendBtn.addEventListener('click', function () {
      if (agentRunning) {
        vscode.postMessage({ type: 'stop' });
        sendBtn.disabled = true;
        sendBtn.textContent = '...';
      } else {
        sendText(inputEl.value);
      }
    });

    inputEl.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (!agentRunning) sendText(inputEl.value);
      }
    });

    if (composerPermissionsBtn) {
      composerPermissionsBtn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var isOpen = composerPermissionsPanelEl && !composerPermissionsPanelEl.classList.contains('hidden');
        setComposerPermissionsOpen(!isOpen);
      });
    }

    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'openSettingsPanel' });
      });
    }

    if (toggleChatSidebarBtn) {
      toggleChatSidebarBtn.addEventListener('click', function () {
        toggleChatSidebar();
      });
    }

    if (toggleJiraContextBtn) {
      toggleJiraContextBtn.addEventListener('click', function () {
        if (!currentJiraContextKey) return;
        jiraContextPanelOpen = !jiraContextPanelOpen;
        if (jiraContextPanelEl) {
          jiraContextPanelEl.classList.toggle('hidden', !jiraContextPanelOpen);
        }
        updateJiraContextToggle(true);
      });
    }

    Array.prototype.forEach.call(composerPermissionPresetEls || [], function (button) {
      if (!button) return;
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        var presetKey = button.dataset ? button.dataset.autoApprovalPreset : '';
        if (!presetKey) return;
        applyAutoApprovalPreset(presetKey);
      });
    });

    [
      autoApproveFileCreateEl,
      autoApproveFileEditEl,
      autoApproveFileDeleteEl,
      autoApproveWebFetchEl,
      autoApproveShellEl,
      autoApproveWorktreeEl,
      autoApproveMcpEl
    ].filter(Boolean).forEach(function (input) {
      input.addEventListener('change', function () {
        persistComposerPermissions();
      });
    });

    document.addEventListener('click', function (event) {
      if (!composerPermissionsPanelEl || composerPermissionsPanelEl.classList.contains('hidden')) return;
      if (composerPermissionsPanelEl.contains(event.target)) return;
      if (composerPermissionsBtn && composerPermissionsBtn.contains(event.target)) return;
      setComposerPermissionsOpen(false);
    });

    if (openSessionMemoryBtn) {
      openSessionMemoryBtn.addEventListener('click', function () {
        var filePath = chatSessionMemoryEl && chatSessionMemoryEl.dataset
          ? chatSessionMemoryEl.dataset.filePath || ''
          : '';
        if (!filePath) return;
        vscode.postMessage({ type: 'openSessionMemory', filePath: filePath });
      });
    }

    if (toggleSessionMemoryBtn) {
      toggleSessionMemoryBtn.addEventListener('click', function () {
        if (!sessionMemoryAvailable) return;
        sessionMemoryOpen = !sessionMemoryOpen;
        renderUtilityPanels();
        persistUiState();
      });
    }

    if (hideSessionMemoryBtn) {
      hideSessionMemoryBtn.addEventListener('click', function () {
        sessionMemoryOpen = false;
        renderUtilityPanels();
        persistUiState();
      });
    }

    if (toggleTaskPanelBtn) {
      toggleTaskPanelBtn.addEventListener('click', function () {
        if (!taskPanelAvailable) return;
        taskPanelOpen = !taskPanelOpen;
        renderUtilityPanels();
        persistUiState();
      });
    }

    if (hideTaskPanelBtn) {
      hideTaskPanelBtn.addEventListener('click', function () {
        taskPanelOpen = false;
        renderUtilityPanels();
        persistUiState();
      });
    }

    window.addEventListener('message', handleMessage);
  }

  var messageHandlers = {
    agentDone: function () {
      if (runtimeProgressState === 'running' || runtimeProgressState === 'waiting') {
        runtimeProgressState = 'stopped';
        syncAssistPanels();
      }
      trace.finishRun('stopped');
      setLoading(false);
    },
    assistant: function (msg) {
      runtimeProgressState = 'done';
      syncAssistPanels();
      trace.finishRun('done', 'Готово.');
      setLoading(false);
      trace.appendMessage(msg.text, 'assistant');
      metrics.recordAssistantResponse();
    },
    error: function (msg) {
      runtimeProgressState = 'error';
      syncAssistPanels();
      trace.finishRun('error', 'Во время выполнения возникла ошибка.');
      setLoading(false);
      trace.appendMessage(msg.text, 'error');
    },
    status: function (msg) {
      trace.appendMessage(msg.text, 'status');
    },
    traceReset: function () {
      trace.startRun();
      metrics.recordAgentRunStarted();
    },
    traceEvent: function (msg) {
      trace.handleTraceEvent(msg);
      metrics.recordTraceEvent(msg);
    },
    approvalRequest: function (msg) {
      changes.appendApprovalRequest(msg.request);
    },
    approvalResolved: function (msg) {
      changes.resolveApproval(msg.result);
    },
    questionRequest: function (msg) {
      changes.appendQuestionRequest(msg.request);
    },
    questionResolved: function (msg) {
      changes.resolveQuestion(msg.result);
    },
    shellConfirm: function (msg) {
      changes.appendApprovalRequest({
        kind: 'shell',
        confirmId: msg.confirmId,
        title: 'Подтвердите shell-команду',
        description: 'При необходимости команду можно отредактировать перед выполнением.',
        command: msg.command || '',
        cwd: msg.cwd || '',
        canEditCommand: true
      });
    },
    planConfirm: function (msg) {
      changes.appendApprovalRequest({
        kind: 'plan',
        confirmId: msg.confirmId,
        title: msg.mutationQuery ? 'Утвердите план перед реализацией' : 'Утвердите итоговый план',
        description: msg.mutationQuery
          ? 'Можно поправить текст плана перед запуском реализации.'
          : 'Можно поправить текст плана перед публикацией ответа.',
        plan: msg.plan || '',
        mutationQuery: !!msg.mutationQuery,
        feedbackPlaceholder: 'Комментарий для доработки плана (необязательно)'
      });
    },
        fileChange: function (msg) {
          changes.appendFileChange(msg);
          metrics.recordFileChange(msg);
          if (trace && typeof trace.recordFileChange === 'function') {
            trace.recordFileChange(msg);
          }
        },
        changeMetrics: function (msg) {
          metrics.recordChangeMetrics(msg.metrics || {});
          if (trace && typeof trace.updateChangeMetrics === 'function') {
            trace.updateChangeMetrics(msg.metrics || {});
          }
        },
        changeAccepted: function (msg) {
      changes.markChangeStatus(msg.changeId, true);
    },
    changeRejected: function (msg) {
      changes.markChangeStatus(msg.changeId, false);
    },
    checkpoint: function (msg) {
      changes.appendCheckpoint(msg);
    },
    checkpointUpdated: function (msg) {
      changes.updateCheckpoint(msg);
    },
    checkpointsList: function (msg) {
      changes.syncCheckpointsList(msg.checkpoints);
    },
    checkpointReverted: function (msg) {
      changes.markCheckpointReverted(msg);
      metrics.recordCheckpointReverted(msg);
    },
    undoRevertDone: function (msg) {
      changes.handleUndoRevertDone(msg);
      metrics.recordUndoRevert(msg);
    },
    checkpointBranchCommitted: function (msg) {
      changes.handleCheckpointBranchCommitted(msg);
    },
    updateSuggestions: function (msg) {
      followups.setSuggestions(msg);
    },
    suggestionsState: function (msg) {
      followups.setState(msg);
    },
    conversationSessions: function (msg) {
      sessions.setSessions(msg);
    },
    conversationState: function (msg) {
      followups.restore(msg);
      metrics.resetFromSnapshot(msg.messages, msg.traceRuns, msg.artifactEvents);
      updateRuntimeState(msg.agentMode, msg.awaitingPlanApproval, msg.pendingApproval, msg.pendingQuestion);
      updateRuntimeProgress(msg.progress);
      updateJiraContext(msg.taskContext || msg.jiraContext || msg.tfsContext || null);
      updateSessionMemory(msg.sessionMemory);
      renderComposerPermissions(msg.autoApproval || composerPermissionsState);
      runtimeTodos = Array.isArray(msg.todos) ? msg.todos.slice() : [];
      todos.setTodos(runtimeTodos);
      syncAssistPanels();
      if (msg.replace) {
        trace.resetView();
        updateBulkBar();
      } else if (messagesEl.childElementCount > 0) {
        return;
      }

      restoreConversationTimeline(msg.messages, msg.traceRuns, msg.artifactEvents);
      if (changes && typeof changes.syncPendingChanges === 'function') {
        changes.syncPendingChanges(msg.pendingChangeIds || []);
      }
    },
    runtimeState: function (msg) {
      updateRuntimeState(msg.mode, msg.awaitingPlanApproval, msg.pendingApproval, msg.pendingQuestion);
      updateRuntimeProgress(msg.progress);
      updateSessionMemory(msg.sessionMemory);
      renderComposerPermissions(msg.autoApproval || composerPermissionsState);
      runtimeTodos = Array.isArray(msg.todos) ? msg.todos.slice() : [];
      todos.setTodos(runtimeTodos);
      syncAssistPanels();
    },
    composerPermissionsState: function (msg) {
      renderComposerPermissions(msg.autoApproval || composerPermissionsState);
    },
    tasksState: function (msg) {
      tasks.setTasks(msg);
    }
  };

  function handleMessage(event) {
    var msg = event.data || {};
    var handler = messageHandlers[msg.type];
    if (!handler) return;
    try {
      handler(msg);
    } catch (error) {
      console.error('[AI-Assistant] message handler failed:', msg.type, error);
    }
  }

  wireEvents();
  renderChatSidebarState();
  syncAssistPanels();
  renderUtilityPanels();
  vscode.postMessage({ type: 'getConversationState' });
  vscode.postMessage({ type: 'getTasksState' });
  vscode.postMessage({ type: 'getCheckpoints' });
})();
