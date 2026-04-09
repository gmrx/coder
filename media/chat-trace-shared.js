(function () {
  'use strict';

  function isNearBottom(messagesEl) {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 96;
  }

  function scrollToBottom(messagesEl, force) {
    if (force || isNearBottom(messagesEl)) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function renderAssistantMessage(text) {
    if (window.ChatMarkdown) {
      try {
        return window.ChatMarkdown.renderMarkdown(text);
      } catch (_) {
        // Fall back to escaped text so Mermaid/markdown issues don't kill the whole UI.
      }
    }
    return escapeHtml(text).replace(/\n/g, '<br>');
  }

  function postRenderAssistant(el) {
    if (window.ChatMarkdown) {
      try {
        window.ChatMarkdown.postRenderMessage(el);
      } catch (_) {
        // Keep assistant message visible even if post-processing fails.
      }
    }
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function truncateText(text, maxLength) {
    var value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return '';
    if (value.length <= maxLength) return value;
    return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
  }

  function compactTraceText(text) {
    return truncateText(String(text || '').replace(/^[^\w\u0400-\u04FF]+/, '').trim(), 160);
  }

  function formatDuration(ms) {
    if (!ms || ms < 1000) return '<1s';
    if (ms < 60_000) return (ms / 1000).toFixed(ms >= 10_000 ? 0 : 1) + 's';
    return Math.round(ms / 60_000) + 'm';
  }

  function summarizeArgs(args) {
    if (!args || typeof args !== 'object') return '';
    var keys = Object.keys(args);
    if (keys.length === 0) return '';

    var parts = [];
    for (var index = 0; index < keys.length && parts.length < 3; index++) {
      var key = keys[index];
      var value = args[key];
      if (value === undefined || value === null || value === '') continue;

      if (typeof value === 'string') {
        parts.push(key + ': ' + truncateText(value, 36));
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(key + ': ' + String(value));
      } else if (Array.isArray(value)) {
        parts.push(key + ': ' + value.length);
      } else if (typeof value === 'object') {
        parts.push(key + ': …');
      }
    }

    return parts.join(' • ');
  }

  function friendlyToolName(tool) {
    if (tool && typeof tool === 'object') {
      if (tool.displayName) return String(tool.displayName);
      if (tool.tool) return friendlyToolName(tool.tool);
    }

    var labels = {
      tool_search: 'поиск инструмента',
      ask_user: 'вопрос пользователю',
      skill: 'навык',
      task_create: 'создание задачи',
      task_list: 'список задач',
      task_get: 'статус задачи',
      task_update: 'обновление задачи',
      task_stop: 'остановка задачи',
      read_file: 'чтение файла',
      read_file_range: 'чтение диапазона',
      grep: 'поиск по коду',
      glob: 'поиск файлов',
      list_files: 'обзор файлов',
      scan_structure: 'обзор структуры',
      detect_stack: 'анализ стека',
      semantic_search: 'семантический поиск',
      find_relevant_files: 'подбор релевантных файлов',
      workspace_symbols: 'поиск символов',
      extract_symbols: 'извлечение символов',
      get_diagnostics: 'диагностика',
      read_lints: 'чтение диагностик',
      subagent: 'волна подагентов',
      verification_agent: 'независимая проверка',
      todo_write: 'список задач',
      str_replace: 'точечная правка',
      write_file: 'запись файла',
      delete_file: 'удаление файла',
      edit_notebook: 'правка notebook',
      shell: 'shell-команда',
      web_search: 'веб-поиск',
      web_fetch: 'загрузка URL',
      list_mcp_resources: 'ресурсы MCP',
      read_mcp_resource: 'чтение MCP ресурса'
    };
    return labels[tool] || String(tool || 'инструмент');
  }

  function summarizeToolCapabilities(data) {
    if (!data || typeof data !== 'object') return '';

    var parts = [];
    if (data.readOnly) parts.push('только чтение');
    if (data.requiresUserInteraction) parts.push('нужно подтверждение');
    if (data.deferred) parts.push('отложенный шаг');
    if (data.destructive) parts.push('рискованное действие');
    if (data.interruptBehavior === 'block' && !data.readOnly) parts.push('дожидается завершения');

    return parts.join(' • ');
  }

  function extractVerdict(text) {
    var match = String(text || '').match(/VERDICT:\s*(PASS|FAIL|PARTIAL)\b/i);
    return match ? match[1].toUpperCase() : '';
  }

  function summarizeToolResult(tool, execution) {
    var summary = execution && execution.resultSummary ? String(execution.resultSummary) : '';
    var target = execution && execution.args ? summarizeExecutionTarget(execution.args) : '';
    if (summary) {
      if (target) return compactTraceText(target + ' — ' + summary);
      return String(summary);
    }
    var preview = compactTraceText((execution && execution.resultPreview) || '');
    if (preview) return preview;
    return friendlyToolName(execution && execution.displayName ? execution : tool) + ' завершён';
  }

  function getResultPresentation(data) {
    if (!data || typeof data !== 'object') return null;
    if (!data.resultPresentation || typeof data.resultPresentation !== 'object') return null;
    if (!data.resultPresentation.kind || !data.resultPresentation.data) return null;
    return data.resultPresentation;
  }

  function formatCount(count, singular, plural) {
    var value = Number(count || 0);
    return value + ' ' + (value === 1 ? singular : plural);
  }

  function formatBytes(bytes) {
    var value = Number(bytes || 0);
    if (!value || value < 0) return '';
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(value >= 10 * 1024 ? 0 : 1) + ' KB';
    return (value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';
  }

  function compactPath(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    var parts = text.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2) return text;
    return parts.slice(-2).join('/');
  }

  function compactUrl(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    try {
      var parsed = new URL(text);
      var host = parsed.hostname.replace(/^www\./, '');
      var pathname = parsed.pathname === '/' ? '' : parsed.pathname;
      return truncateText(host + pathname, 52);
    } catch (_) {
      return truncateText(text, 52);
    }
  }

  function pushFact(parts, value) {
    var text = String(value || '').trim();
    if (!text) return;
    if (parts.indexOf(text) >= 0) return;
    parts.push(text);
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getResultNextStep(data) {
    var presentation = getResultPresentation(data);
    if (presentation && presentation.data && presentation.data.nextStep) {
      return String(presentation.data.nextStep).trim();
    }

    var detailMatch = String((data && data.resultDetail) || '').match(/(?:^|\n)Следующий шаг:\s*(.+)$/m);
    if (detailMatch && detailMatch[1]) return String(detailMatch[1]).trim();
    return '';
  }

  function stripNextStepText(text, nextStep) {
    var value = String(text || '').trim();
    var step = String(nextStep || '').trim();
    if (!value || !step) return value;

    var labeledPattern = new RegExp('(?:^|\\n)Следующий шаг:\\s*' + escapeRegExp(step) + '\\s*$', 'm');
    value = value.replace(labeledPattern, '').trim();

    var trailingPattern = new RegExp('\\n\\n' + escapeRegExp(step) + '\\s*$');
    value = value.replace(trailingPattern, '').trim();

    if (value === step) return '';
    return value;
  }

  function summarizeExecutionTarget(args) {
    if (!args || typeof args !== 'object') return '';
    if (typeof args.command === 'string' && args.command.trim()) {
      return truncateText(args.command, 64);
    }
    if (typeof args.path === 'string' && args.path.trim()) {
      return truncateText(args.path, 64);
    }
    if (typeof args.url === 'string' && args.url.trim()) {
      return truncateText(args.url, 64);
    }
    if (typeof args.query === 'string' && args.query.trim()) {
      return truncateText(args.query, 64);
    }
    return '';
  }

  function buildResultNote(data) {
    if (!data || typeof data !== 'object') return '';
    if (data.autoApproved) {
      return data.error
        ? 'Подтверждение пропущено по настройке. Шаг выполнился автоматически, но завершился с ошибкой.'
        : 'Подтверждение пропущено по настройке под полем ввода. Результат шага передан агенту для следующего решения.';
    }
    if (data.requiresUserInteraction) {
      return data.error
        ? 'Подтверждение получено, но этот шаг завершился с ошибкой.'
        : 'Подтверждение получено. Результат шага передан агенту для следующего решения.';
    }
    return '';
  }

  function buildResultDetail(data) {
    if (!data || typeof data !== 'object') return '';
    return stripNextStepText(data.resultDetail || '', getResultNextStep(data));
  }

  function buildShellResultPreview(presentationData) {
    if (!presentationData || typeof presentationData !== 'object') return '';

    var parts = [];
    var stdout = String(presentationData.stdout || '').trim();
    var stderr = String(presentationData.stderr || '').trim();

    if (stdout) parts.push('stdout\n' + stdout);
    if (stderr) parts.push('stderr\n' + stderr);

    if (parts.length > 0) return parts.join('\n\n');
    return String(presentationData.outputPreview || '').trim();
  }

  function buildResultPreview(data) {
    if (!data || typeof data !== 'object' || data.showResultPreview === false) return '';

    var presentation = getResultPresentation(data);
    if (presentation && presentation.kind === 'shell') {
      return stripNextStepText(buildShellResultPreview(presentation.data), getResultNextStep(data));
    }

    return stripNextStepText(data.resultPreview || '', getResultNextStep(data));
  }

  function buildResultPreviewTitle(data) {
    if (!data || typeof data !== 'object' || data.showResultPreview === false) return '';

    var presentation = getResultPresentation(data);
    if (presentation && presentation.kind === 'shell') {
      var shell = presentation.data || {};
      var hasStdout = Boolean(String(shell.stdout || '').trim());
      var hasStderr = Boolean(String(shell.stderr || '').trim());
      if (hasStdout && hasStderr) return 'stdout / stderr';
      if (hasStdout) return 'stdout';
      if (hasStderr) return 'stderr';
      if (shell.backgroundTaskId) return 'Фоновая задача';
      return 'Вывод команды';
    }

    if (presentation && presentation.kind === 'tool_search') return 'Подбор инструментов';
    if (presentation && presentation.kind === 'web_search') {
      var searchMode = String((presentation.data && presentation.data.outputMode) || '');
      if (searchMode === 'sources') return 'Источники';
      if (searchMode === 'results') return 'Результаты поиска';
      return 'Сводка поиска';
    }
    if (presentation && presentation.kind === 'web_fetch') {
      var fetchMode = String((presentation.data && presentation.data.outputMode) || '');
      if (fetchMode === 'metadata') return 'Метаданные ответа';
      if (fetchMode === 'content') return 'Содержимое ответа';
      return 'Сводка URL';
    }
    if (presentation && presentation.kind === 'semantic_search') {
      var semanticMode = String((presentation.data && presentation.data.outputMode) || '');
      if (semanticMode === 'chunks') return 'Релевантные фрагменты';
      if (semanticMode === 'files') return 'Релевантные файлы';
      return 'Сводка retrieval';
    }
    if (presentation && presentation.kind === 'find_relevant_files') {
      var relevantMode = String((presentation.data && presentation.data.outputMode) || '');
      if (relevantMode === 'snippets') return 'Сниппеты';
      if (relevantMode === 'files') return 'Кандидаты';
      return 'Сводка shortlist';
    }
    if (presentation && presentation.kind === 'diagnostics') {
      var diagnosticsMode = String((presentation.data && presentation.data.outputMode) || '');
      if (diagnosticsMode === 'files') return 'Проблемные файлы';
      if (diagnosticsMode === 'items') return 'Проблемы';
      return 'Сводка диагностики';
    }
    if (presentation && presentation.kind === 'mcp_resources') {
      return 'Ресурсы MCP';
    }
    if (presentation && presentation.kind === 'mcp_resource') {
      return 'Содержимое MCP ресурса';
    }
    if (presentation && presentation.kind === 'read') {
      var readMode = String((presentation.data && presentation.data.mode) || '');
      if (readMode === 'manifest') return 'Обзор конфигурации';
      if (readMode === 'metadata') return 'Метаданные файла';
      if (readMode === 'outline') return 'Обзор файла';
      if (readMode === 'range') return 'Фрагмент файла';
      if (readMode === 'binary') return 'Описание файла';
      return 'Содержимое файла';
    }
    if (presentation && presentation.kind === 'grep') {
      var grepMode = String((presentation.data && presentation.data.outputMode) || '');
      if (grepMode === 'files_with_matches') return 'Файлы с совпадениями';
      if (grepMode === 'count') return 'Частоты совпадений';
      return 'Совпадения';
    }
    if (presentation && presentation.kind === 'file_collection') {
      var fileMode = String((presentation.data && presentation.data.outputMode) || '');
      var toolName = String((presentation.data && presentation.data.toolName) || '');
      if (toolName === 'list_files') {
        if (fileMode === 'dirs') return 'Директории и файлы';
        if (fileMode === 'tree') return 'Дерево файлов';
        return 'Список файлов';
      }
      return fileMode === 'grouped' ? 'Совпадения по директориям' : 'Найденные файлы';
    }
    if (presentation && presentation.kind === 'project_study') {
      var projectTool = String((presentation.data && presentation.data.toolName) || '');
      var projectMode = String((presentation.data && presentation.data.outputMode) || '');
      if (projectTool === 'scan_structure') {
        if (projectMode === 'dirs') return 'Ключевые папки';
        if (projectMode === 'important_files') return 'Важные файлы';
        return 'Обзор структуры';
      }
      if (projectMode === 'entrypoints') return 'Точки входа';
      if (projectMode === 'infra') return 'Инфраструктура';
      return 'Сводка стека';
    }
    if (presentation && presentation.kind === 'symbol_study') {
      var symbolMode = String((presentation.data && presentation.data.outputMode) || '');
      if (symbolMode === 'workspace_symbols') return 'Символы проекта';
      if (symbolMode === 'symbols') return 'Символы';
      if (symbolMode === 'kinds') return 'Виды символов';
      if (symbolMode === 'packages') return 'Пакеты';
      if (symbolMode === 'manifests') return 'Манифесты';
      if (symbolMode === 'graph') return 'Граф зависимостей';
      if (symbolMode === 'files') return 'Зависимости по файлам';
      return 'Сводка';
    }
    if (presentation && presentation.kind === 'lsp_inspect') {
      var operation = String((presentation.data && presentation.data.operation) || '');
      if (operation === 'definition') return 'Определения';
      if (operation === 'references') return 'Ссылки';
      if (operation === 'implementation') return 'Реализации';
      if (operation === 'document_symbols') return 'Символы документа';
      if (operation === 'workspace_symbols') return 'Символы проекта';
      if (operation === 'hover') return 'Hover';
      if (operation === 'incoming_calls') return 'Входящие вызовы';
      if (operation === 'outgoing_calls') return 'Исходящие вызовы';
      return 'LSP-результат';
    }
    if (presentation && presentation.kind === 'skill') return 'Навык';
    if (presentation && presentation.kind === 'task') return 'Вывод задачи';
    if (presentation && presentation.kind === 'ask_user') return 'Ответы пользователя';
    if (presentation && presentation.kind === 'edit') return 'Изменение';

    return String(data.resultPreview || '').trim() ? 'Результат' : '';
  }

  function buildResultFacts(data) {
    var parts = [];
    if (data && typeof data === 'object' && data.autoApproved) {
      pushFact(parts, 'авторазрешено');
    }

    var presentation = getResultPresentation(data);
    if (!presentation || !presentation.data) return parts;

    var value = presentation.data;

    if (presentation.kind === 'tool_search') {
      pushFact(parts, truncateText(value.query, 44));
      pushFact(parts, formatCount(value.matchCount, 'инструмент', 'инструментов'));
      pushFact(parts, value.recommendation && value.recommendation.toolName ? 'рекомендует ' + value.recommendation.toolName : '');
      return parts;
    }

    if (presentation.kind === 'ask_user') {
      pushFact(parts, 'вопросов: ' + value.questionCount);
      pushFact(parts, 'ответов: ' + value.answerCount);
      return parts;
    }

    if (presentation.kind === 'skill') {
      pushFact(parts, value.skillName || '');
      pushFact(parts, value.source || '');
      return parts;
    }

    if (presentation.kind === 'shell') {
      pushFact(parts, value.descriptor && value.descriptor.kindLabel ? value.descriptor.kindLabel : '');
      pushFact(parts, value.descriptor && value.descriptor.riskLabel ? value.descriptor.riskLabel : '');
      pushFact(parts, value.backgroundTaskId ? 'task #' + value.backgroundTaskId : '');
      pushFact(parts, value.exitCode !== undefined ? 'exit ' + value.exitCode : '');
      pushFact(parts, value.cwd ? compactPath(value.cwd) : '');
      pushFact(parts, value.artifact && value.artifact.fileName ? value.artifact.fileName : '');
      return parts;
    }

    if (presentation.kind === 'task') {
      pushFact(parts, value.taskId ? '#' + value.taskId : '');
      pushFact(parts, value.status || '');
      pushFact(parts, value.taskCount !== undefined ? 'results: ' + value.taskCount : '');
      return parts;
    }

    if (presentation.kind === 'web_search') {
      pushFact(parts, truncateText(value.query, 44));
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, 'results: ' + value.resultCount);
      pushFact(parts, value.fetchedCount ? 'fetched: ' + value.fetchedCount : '');
      pushFact(parts, value.skippedFetchCount ? 'skipped: ' + value.skippedFetchCount : '');
      pushFact(parts, value.cacheHit ? 'cache' : '');
      pushFact(parts, value.provenance ? 'источник: ' + value.provenance : '');
      pushFact(parts, value.domainOverview ? truncateText(value.domainOverview, 44) : '');
      return parts;
    }

    if (presentation.kind === 'web_fetch') {
      pushFact(parts, compactUrl(value.url));
      pushFact(parts, value.finalUrl && value.finalUrl !== value.url ? '→ ' + compactUrl(value.finalUrl) : '');
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, value.statusCode ? 'code ' + value.statusCode : '');
      pushFact(parts, value.host ? value.host : '');
      pushFact(parts, value.trustKind ? 'trust: ' + value.trustKind : '');
      pushFact(parts, value.contentType ? value.contentType : '');
      pushFact(parts, value.bytes ? formatBytes(value.bytes) : '');
      pushFact(parts, value.cacheHit ? 'cache' : '');
      pushFact(parts, value.redirectUrl ? 'redirect' : '');
      return parts;
    }

    if (presentation.kind === 'semantic_search') {
      pushFact(parts, truncateText(value.query, 44));
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, 'chunks: ' + value.chunkCount);
      pushFact(parts, 'files: ' + value.fileCount);
      pushFact(parts, value.reranked ? 'reranked' : 'embeddings');
      pushFact(parts, value.targetDirectory ? compactPath(value.targetDirectory) : '');
      return parts;
    }

    if (presentation.kind === 'find_relevant_files') {
      pushFact(parts, truncateText(value.query, 44));
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, 'files: ' + value.fileCount);
      pushFact(parts, value.reranked ? 'reranked' : 'embeddings');
      pushFact(parts, value.targetDirectory ? compactPath(value.targetDirectory) : '');
      return parts;
    }

    if (presentation.kind === 'diagnostics') {
      pushFact(parts, value.toolName);
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, 'severity: ' + value.severity);
      pushFact(parts, 'problems: ' + value.resultCount);
      pushFact(parts, 'files: ' + value.fileCount);
      return parts;
    }

    if (presentation.kind === 'mcp_resources') {
      pushFact(parts, value.server ? 'server: ' + value.server : '');
      pushFact(parts, 'servers: ' + value.serverCount);
      pushFact(parts, 'resources: ' + value.resourceCount);
      pushFact(parts, value.failures ? 'errors: ' + value.failures : '');
      return parts;
    }

    if (presentation.kind === 'mcp_resource') {
      pushFact(parts, value.server);
      pushFact(parts, compactUrl(value.uri));
      pushFact(parts, 'parts: ' + value.contentCount);
      pushFact(parts, value.binaryCount ? 'binary: ' + value.binaryCount : '');
      return parts;
    }

    if (presentation.kind === 'read') {
      pushFact(parts, compactPath(value.path));
      pushFact(parts, 'mode: ' + value.mode);
      pushFact(parts, value.startLine && value.endLine ? 'L' + value.startLine + '-' + value.endLine : '');
      pushFact(parts, value.displayedLines ? 'shown: ' + value.displayedLines : '');
      pushFact(parts, value.totalLines ? 'total: ' + value.totalLines : '');
      pushFact(parts, value.binary ? 'binary' : '');
      return parts;
    }

    if (presentation.kind === 'grep') {
      pushFact(parts, truncateText(value.pattern, 44));
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, 'matches: ' + value.matchCount);
      pushFact(parts, 'files: ' + value.fileCount);
      return parts;
    }

    if (presentation.kind === 'file_collection') {
      pushFact(parts, value.toolName);
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, value.path ? compactPath(value.path) : '');
      pushFact(parts, value.pattern ? truncateText(value.pattern, 36) : '');
      pushFact(parts, 'results: ' + value.resultCount);
      return parts;
    }

    if (presentation.kind === 'project_study') {
      pushFact(parts, value.toolName);
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, 'results: ' + value.resultCount);
      return parts;
    }

    if (presentation.kind === 'symbol_study') {
      pushFact(parts, 'mode: ' + value.outputMode);
      pushFact(parts, 'results: ' + value.resultCount);
      return parts;
    }

    if (presentation.kind === 'lsp_inspect') {
      pushFact(parts, 'op: ' + value.operation);
      pushFact(parts, 'results: ' + value.resultCount);
      return parts;
    }

    if (presentation.kind === 'edit') {
      pushFact(parts, compactPath(value.filePath));
      pushFact(parts, value.changeType);
      pushFact(parts, value.outcome);
      pushFact(parts, value.cellIdx !== undefined ? 'cell ' + value.cellIdx : '');
      return parts;
    }

    return parts;
  }

  function buildStructuredResultSections(data) {
    var presentation = getResultPresentation(data);
    if (!presentation || !presentation.data) return [];
    var value = presentation.data;

    if (Array.isArray(value.sections) && value.sections.length > 0) {
      return value.sections
        .map(function (section) {
          var rawItems = Array.isArray(section && section.items) ? section.items : [];
          var items = rawItems
            .map(function (item) {
              return {
                title: item && item.title ? String(item.title) : '',
                subtitle: item && item.subtitle ? String(item.subtitle) : '',
                meta: item && item.meta ? String(item.meta) : '',
              };
            })
            .filter(function (item) { return item.title || item.subtitle || item.meta; });

          if (!items.length) return null;
          return {
            title: section && section.title ? String(section.title) : '',
            items: items,
          };
        })
        .filter(Boolean);
    }

    if (presentation.kind === 'tool_search' && Array.isArray(value.matches) && value.matches.length > 0) {
      return [{
        title: 'Инструменты',
        items: value.matches.map(function (match) {
          var reasons = Array.isArray(match.reasons) ? match.reasons.join(' • ') : '';
          return {
            title: match.toolName,
            subtitle: match.summary || '',
            meta: reasons,
          };
        }),
      }];
    }

    if (presentation.kind === 'web_search' && Array.isArray(value.highlights) && value.highlights.length > 0) {
      return [{
        title: 'Источники',
        items: value.highlights.map(function (item) {
          return {
            title: item.title || item.url,
            subtitle: item.host ? item.host + ' • ' + compactUrl(item.url) : compactUrl(item.url),
            meta: item.snippet || '',
          };
        }),
      }];
    }

    if (presentation.kind === 'semantic_search') {
      var sections = [];
      if (Array.isArray(value.topFiles) && value.topFiles.length > 0) {
        sections.push({
          title: 'Лучшие файлы',
          items: value.topFiles.map(function (item) {
            return {
              title: item.path,
              subtitle: 'score ' + Number(item.score || 0).toFixed(3) + (item.startLine ? ' • L' + item.startLine : ''),
              meta: item.snippet || '',
            };
          }),
        });
      }
      if (Array.isArray(value.topChunks) && value.topChunks.length > 0) {
        sections.push({
          title: 'Лучшие фрагменты',
          items: value.topChunks.map(function (item) {
            return {
              title: item.path + ':L' + item.startLine,
              subtitle: 'score ' + Number(item.score || 0).toFixed(3),
              meta: item.snippet || '',
            };
          }),
        });
      }
      return sections;
    }

    if (presentation.kind === 'find_relevant_files' && Array.isArray(value.topFiles) && value.topFiles.length > 0) {
      return [{
        title: 'Кандидаты',
        items: value.topFiles.map(function (item) {
          return {
            title: item.path,
            subtitle: 'score ' + Number(item.score || 0).toFixed(3) + (item.startLine ? ' • L' + item.startLine : ''),
            meta: item.snippet || '',
          };
        }),
      }];
    }

    if (presentation.kind === 'shell' && value.backgroundTaskId) {
      return [{
        title: 'Фоновая задача',
        items: [{
          title: 'Task #' + value.backgroundTaskId,
          subtitle: value.command ? truncateText(value.command, 84) : '',
          meta: [
            value.backgroundStdoutPath ? 'stdout: ' + compactPath(value.backgroundStdoutPath) : '',
            value.backgroundStderrPath ? 'stderr: ' + compactPath(value.backgroundStderrPath) : '',
          ].filter(Boolean).join(' • '),
        }],
      }];
    }

    return [];
  }

  function summarizeSubagentWave(tasks) {
    var items = Array.isArray(tasks) ? tasks : [];
    if (items.length === 0) return 'Запущена волна подагентов';

    var names = [];
    for (var index = 0; index < items.length && names.length < 3; index++) {
      var task = items[index] || {};
      var label = compactTraceText(task.label || task.purpose || '');
      if (label) names.push(label);
    }

    if (names.length === 0) return 'Запущена волна подагентов';
    if (items.length > names.length) {
      return 'Подагенты: ' + names.join(' · ') + ' +' + (items.length - names.length);
    }
    return 'Подагенты: ' + names.join(' · ');
  }

  function summarizeTodos(todos) {
    var items = Array.isArray(todos) ? todos : [];
    if (items.length === 0) return 'Задачи закрыты';
    if (items.every(function (todo) { return todo && todo.status === 'completed'; })) {
      return 'Все задачи завершены';
    }

    var active = items.find(function (todo) { return todo && todo.status === 'in_progress'; });
    if (active && active.activeForm) return compactTraceText(active.activeForm);
    if (active && active.content) return compactTraceText(active.content);
    return 'Обновлено задач: ' + items.length;
  }

  function summarizeRecovery(data, fallback) {
    var summary = data && data.summary ? compactTraceText(data.summary) : '';
    if (summary) return summary;
    return compactTraceText(fallback || 'Перестраиваю следующий шаг');
  }

  function summarizeTransition(data, fallback) {
    var summary = data && data.summary ? compactTraceText(data.summary) : '';
    if (summary) return summary;
    return compactTraceText(fallback || 'Перехожу к следующему шагу');
  }

  function createSection(title, className) {
    var section = document.createElement('div');
    section.className = 'trace-section ' + className + ' hidden';

    var header = document.createElement('div');
    header.className = 'trace-section-header';

    var label = document.createElement('span');
    label.className = 'trace-section-title';
    label.textContent = title;
    header.appendChild(label);

    var meta = document.createElement('span');
    meta.className = 'trace-section-meta';
    header.appendChild(meta);

    var content = document.createElement('div');
    content.className = 'trace-section-content';

    section.appendChild(header);
    section.appendChild(content);

    return {
      el: section,
      metaEl: meta,
      contentEl: content,
    };
  }

  function setBadgeState(el, state, text) {
    el.className = 'trace-badge is-' + state;
    el.textContent = text;
  }

  window.ChatTraceShared = {
    isNearBottom: isNearBottom,
    scrollToBottom: scrollToBottom,
    renderAssistantMessage: renderAssistantMessage,
    postRenderAssistant: postRenderAssistant,
    escapeHtml: escapeHtml,
    truncateText: truncateText,
    compactTraceText: compactTraceText,
    formatDuration: formatDuration,
    summarizeArgs: summarizeArgs,
    friendlyToolName: friendlyToolName,
    summarizeToolCapabilities: summarizeToolCapabilities,
    summarizeToolResult: summarizeToolResult,
    summarizeExecutionTarget: summarizeExecutionTarget,
    buildResultNote: buildResultNote,
    buildResultDetail: buildResultDetail,
    buildResultFacts: buildResultFacts,
    buildStructuredResultSections: buildStructuredResultSections,
    getResultNextStep: getResultNextStep,
    buildResultPreview: buildResultPreview,
    buildResultPreviewTitle: buildResultPreviewTitle,
    summarizeSubagentWave: summarizeSubagentWave,
    summarizeTodos: summarizeTodos,
    summarizeRecovery: summarizeRecovery,
    summarizeTransition: summarizeTransition,
    extractVerdict: extractVerdict,
    createSection: createSection,
    setBadgeState: setBadgeState,
  };
})();
