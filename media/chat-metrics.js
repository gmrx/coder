(function () {
  'use strict';

  function emptyMetrics() {
    return {
      userRequests: 0,
      assistantResponses: 0,
      agentRuns: 0,
      modelRuns: Object.create(null),
      modelCalls: Object.create(null),
      modelCallCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      toolCalls: 0,
      toolErrors: 0,
      fileChanges: 0,
      changedFiles: Object.create(null),
      agentAddedLines: 0,
      agentRemovedLines: 0,
      userEditedAgentLines: 0,
      userOwnEditedLines: 0,
      changeMetricGroups: Object.create(null),
      checkpointRollbackEvents: 0,
      checkpointRevertedRequests: 0,
      checkpointRestoredFiles: 0,
      checkpointErrors: 0,
      undoRevertEvents: 0
    };
  }

  function compactNumber(value) {
    var number = Math.max(0, Number(value || 0));
    if (number >= 1000000) return (number / 1000000).toFixed(number >= 10000000 ? 0 : 1).replace(/\.0$/, '') + 'm';
    if (number >= 1000) return (number / 1000).toFixed(number >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(number));
  }

  function formatCount(value, one, few, many) {
    var number = Math.max(0, Number(value || 0));
    var mod10 = number % 10;
    var mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return number + ' ' + one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return number + ' ' + few;
    return number + ' ' + many;
  }

  function addMapCount(map, key, amount) {
    var value = String(key || '').trim();
    if (!value) return;
    map[value] = Math.max(0, Number(map[value] || 0)) + Math.max(1, Number(amount || 1));
  }

  function countMapKeys(map) {
    return Object.keys(map || {}).length;
  }

  function topMapEntry(map) {
    var keys = Object.keys(map || {});
    if (!keys.length) return null;
    keys.sort(function (left, right) {
      var diff = Number(map[right] || 0) - Number(map[left] || 0);
      return diff !== 0 ? diff : left.localeCompare(right);
    });
    return { key: keys[0], count: Number(map[keys[0]] || 0) };
  }

  function shortModelName(model) {
    var value = String(model || '').trim();
    if (!value) return '';
    var slash = value.lastIndexOf('/');
    if (slash >= 0 && slash < value.length - 1) value = value.slice(slash + 1);
    return value.length > 30 ? value.slice(0, 27) + '...' : value;
  }

  function numeric(value) {
    var number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function getTraceErrorKey(runId, phase, data) {
    var prefix = String(runId || 'live');
    if (phase === 'agent-result' && data && data.error) {
      return prefix + ':tool:' + String(data.step || '') + ':' + String(data.tool || '');
    }
    if (phase === 'tool-batch-child-result' && data && data.error) {
      return prefix + ':batch:' + String(data.step || '') + ':' + String(data.index || '') + ':' + String(data.tool || '');
    }
    if (phase === 'subagent-error') {
      return prefix + ':subagent:' + String(data && data.id || 'subagent');
    }
    if (phase === 'subagent-lifecycle' && data && String(data.state || '') === 'error') {
      return prefix + ':subagent-lifecycle:' + String(data.id || 'subagent');
    }
    return '';
  }

  function addToolError(metrics, seen, key) {
    if (!key || seen[key]) return;
    seen[key] = true;
    metrics.toolErrors += 1;
  }

  function addModelUsage(metrics, data) {
    var model = data && data.model ? String(data.model) : '';
    var prompt = numeric(data && (data.promptTokens !== undefined ? data.promptTokens : data.lastPromptTokens));
    var completion = numeric(data && (data.completionTokens !== undefined ? data.completionTokens : data.lastCompletionTokens));
    var total = numeric(data && (data.totalTokens !== undefined ? data.totalTokens : data.lastTotalTokens));
    if (!total && (prompt || completion)) total = prompt + completion;

    metrics.modelCallCount += 1;
    metrics.promptTokens += prompt;
    metrics.completionTokens += completion;
    metrics.totalTokens += total;
    addMapCount(metrics.modelCalls, model, 1);
  }

  function applyFileChange(metrics, payload, seen) {
    if (!payload) return;
    var key = String(payload.changeId || payload.filePath || '') || ('change-' + metrics.fileChanges);
    if (seen && seen[key]) return;
    if (seen) seen[key] = true;

    var stats = payload.stats || {};
    metrics.fileChanges += 1;
    metrics.agentAddedLines += numeric(stats.added);
    metrics.agentRemovedLines += numeric(stats.removed);
    if (payload.filePath) metrics.changedFiles[String(payload.filePath)] = true;
  }

  function applyChangeMetricsSnapshot(metrics, payload, groupKey) {
    if (!payload) return;
    var key = String(groupKey || 'session');
    var current = metrics.changeMetricGroups[key] || {
      userEditedAgentLines: 0,
      userOwnEditedLines: 0
    };
    var nextAgent = numeric(payload.agentModifiedByUserLines) + numeric(payload.agentDeletedByUserLines);
    var nextUser = numeric(payload.userOnlyLines) + numeric(payload.userRemovedLines);

    metrics.userEditedAgentLines = Math.max(0, metrics.userEditedAgentLines + nextAgent - current.userEditedAgentLines);
    metrics.userOwnEditedLines = Math.max(0, metrics.userOwnEditedLines + nextUser - current.userOwnEditedLines);
    current.userEditedAgentLines = nextAgent;
    current.userOwnEditedLines = nextUser;
    metrics.changeMetricGroups[key] = current;
  }

  function applyCheckpointReverted(metrics, payload) {
    if (!payload) return;
    metrics.checkpointRollbackEvents += 1;
    metrics.checkpointRevertedRequests += numeric(payload.rewoundRequests);
    metrics.checkpointRestoredFiles += numeric(payload.restoredFiles);
    if (Array.isArray(payload.errors)) {
      metrics.checkpointErrors += payload.errors.length;
    }
  }

  function applyTraceEvent(metrics, event, runId, seenErrors) {
    if (!event) return;
    var phase = String(event.phase || '');
    var data = event.data || {};

    if (phase === 'agent-model') {
      addMapCount(metrics.modelRuns, data.model || '', 1);
      return;
    }
    if (phase === 'agent-model-usage') {
      addModelUsage(metrics, data);
      return;
    }
    if (phase === 'agent-tool' && data.countsAsTool !== false) {
      metrics.toolCalls += 1;
    }
    if (phase === 'tool-batch-child-start') {
      metrics.toolCalls += 1;
    }

    addToolError(metrics, seenErrors, getTraceErrorKey(runId, phase, data));
  }

  function computeFromSnapshot(messages, traceRuns, artifacts) {
    var metrics = emptyMetrics();
    var seenErrors = Object.create(null);
    var seenFileChanges = Object.create(null);

    (Array.isArray(messages) ? messages : []).forEach(function (message) {
      if (!message || typeof message.content !== 'string') return;
      if (message.role === 'user') metrics.userRequests += 1;
      if (message.role === 'assistant') metrics.assistantResponses += 1;
    });

    (Array.isArray(traceRuns) ? traceRuns : []).forEach(function (run, index) {
      if (!run) return;
      var runId = run.id || ('run-' + (index + 1));
      metrics.agentRuns += 1;
      (Array.isArray(run.events) ? run.events : []).forEach(function (event) {
        applyTraceEvent(metrics, event, runId, seenErrors);
      });
    });

    (Array.isArray(artifacts) ? artifacts : []).forEach(function (artifact, index) {
      if (!artifact || !artifact.kind) return;
      if (artifact.kind === 'fileChange') {
        applyFileChange(metrics, artifact.payload, seenFileChanges);
        return;
      }
      if (artifact.kind === 'changeMetrics') {
        applyChangeMetricsSnapshot(metrics, artifact.payload, 'currentChanges');
        return;
      }
      if (artifact.kind === 'checkpointReverted') {
        applyCheckpointReverted(metrics, artifact.payload);
        return;
      }
      if (artifact.kind === 'undoRevertDone') {
        metrics.undoRevertEvents += 1;
      }
    });

    return metrics;
  }

  function hasVisibleMetrics(metrics) {
    return metrics.userRequests > 0 ||
      metrics.agentRuns > 0 ||
      metrics.fileChanges > 0 ||
      metrics.toolErrors > 0 ||
      metrics.checkpointRevertedRequests > 0 ||
      metrics.userEditedAgentLines > 0 ||
      metrics.userOwnEditedLines > 0;
  }

  function createChip(text, className, title) {
    var chip = document.createElement('span');
    chip.className = 'chat-session-metric' + (className ? ' ' + className : '');
    chip.textContent = text;
    if (title) chip.title = title;
    return chip;
  }

  function createMetricsController(ctx) {
    var rootEl = ctx && ctx.rootEl;
    var metrics = emptyMetrics();
    var liveSeenErrors = Object.create(null);
    var liveSeenFileChanges = Object.create(null);
    var liveRunSequence = 0;

    function render() {
      if (!rootEl) return;
      rootEl.innerHTML = '';
      if (!hasVisibleMetrics(metrics)) {
        rootEl.classList.add('hidden');
        return;
      }

      rootEl.classList.remove('hidden');

      var title = document.createElement('span');
      title.className = 'chat-session-metrics-title';
      title.textContent = 'Метрики чата';
      rootEl.appendChild(title);

      rootEl.appendChild(createChip('запросов: ' + metrics.userRequests, 'is-requests'));
      if (metrics.agentRuns > 0) {
        rootEl.appendChild(createChip('запусков агента: ' + metrics.agentRuns, 'is-runs'));
      }
      if (metrics.toolCalls > 0) {
        rootEl.appendChild(createChip('утилит: ' + metrics.toolCalls, 'is-tools'));
      }

      var topCalls = topMapEntry(metrics.modelCalls);
      var topRuns = topMapEntry(metrics.modelRuns);
      var modelEntry = topCalls || topRuns;
      if (modelEntry) {
        var modelLabel = shortModelName(modelEntry.key);
        var modelCountText = topCalls
          ? compactNumber(metrics.modelCallCount) + ' API'
          : formatCount(modelEntry.count, 'запуск', 'запуска', 'запусков');
        rootEl.appendChild(createChip('модель: ' + modelLabel + ' · ' + modelCountText, 'is-model', modelEntry.key));
      }

      if (metrics.totalTokens > 0 || metrics.promptTokens > 0 || metrics.completionTokens > 0) {
        rootEl.appendChild(createChip(
          'токены: ' + compactNumber(metrics.promptTokens) + ' in + ' + compactNumber(metrics.completionTokens) + ' out',
          'is-tokens',
          'Суммарно по API-вызовам: ' + compactNumber(metrics.totalTokens || (metrics.promptTokens + metrics.completionTokens))
        ));
      }

      if (metrics.fileChanges > 0 || metrics.agentAddedLines > 0 || metrics.agentRemovedLines > 0) {
        rootEl.appendChild(createChip(
          'изменения: +' + compactNumber(metrics.agentAddedLines) + ' / -' + compactNumber(metrics.agentRemovedLines),
          'is-lines',
          'Файлов: ' + countMapKeys(metrics.changedFiles) + ', карточек изменений: ' + metrics.fileChanges
        ));
      }

      if (metrics.userEditedAgentLines > 0 || metrics.userOwnEditedLines > 0) {
        rootEl.appendChild(createChip(
          'правки пользователя: ' + compactNumber(metrics.userEditedAgentLines) + ' по агенту · ' + compactNumber(metrics.userOwnEditedLines) + ' своих',
          'is-user-edits',
          'Показывает, сколько строк пользователь дорабатывал после агента и отдельно вне строк агента'
        ));
      }

      if (metrics.toolErrors > 0) {
        rootEl.appendChild(createChip(
          'ошибок утилит: ' + metrics.toolErrors,
          'is-errors',
          'Ошибки выполнения tool calls, batch tools и подагентов'
        ));
      }

      if (metrics.checkpointRevertedRequests > 0) {
        var rollbackTitle = 'Откатов к чекпойнту: ' + metrics.checkpointRollbackEvents +
          '\nВосстановлено файлов: ' + metrics.checkpointRestoredFiles +
          (metrics.checkpointErrors ? '\nОшибок отката: ' + metrics.checkpointErrors : '');
        rootEl.appendChild(createChip(
          'отменено чекпойнтом: ' + formatCount(metrics.checkpointRevertedRequests, 'запрос', 'запроса', 'запросов'),
          'is-rollbacks',
          rollbackTitle
        ));
      }
    }

    function resetFromSnapshot(messages, traceRuns, artifacts) {
      metrics = computeFromSnapshot(messages, traceRuns, artifacts);
      liveSeenErrors = Object.create(null);
      liveSeenFileChanges = Object.create(null);
      liveRunSequence = metrics.agentRuns;
      render();
    }

    function recordUserRequest() {
      metrics.userRequests += 1;
      render();
    }

    function recordAssistantResponse() {
      metrics.assistantResponses += 1;
      render();
    }

    function recordAgentRunStarted() {
      liveRunSequence += 1;
      metrics.agentRuns += 1;
      render();
    }

    function recordTraceEvent(msg) {
      applyTraceEvent(metrics, msg, 'live-' + liveRunSequence, liveSeenErrors);
      render();
    }

    function recordFileChange(msg) {
      applyFileChange(metrics, msg, liveSeenFileChanges);
      render();
    }

    function recordChangeMetrics(payload) {
      applyChangeMetricsSnapshot(metrics, payload, 'currentChanges');
      render();
    }

    function recordCheckpointReverted(payload) {
      applyCheckpointReverted(metrics, payload);
      render();
    }

    function recordUndoRevert() {
      metrics.undoRevertEvents += 1;
      render();
    }

    render();

    return {
      resetFromSnapshot: resetFromSnapshot,
      recordUserRequest: recordUserRequest,
      recordAssistantResponse: recordAssistantResponse,
      recordAgentRunStarted: recordAgentRunStarted,
      recordTraceEvent: recordTraceEvent,
      recordFileChange: recordFileChange,
      recordChangeMetrics: recordChangeMetrics,
      recordCheckpointReverted: recordCheckpointReverted,
      recordUndoRevert: recordUndoRevert
    };
  }

  window.ChatSessionMetrics = {
    createMetricsController: createMetricsController
  };
})();
