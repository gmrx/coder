(function () {
  'use strict';

  var shared = window.ChatTraceShared;
  var runs = window.ChatTraceRuns;
  var subagents = window.ChatTraceSubagents;

  function getSequenceParentStepKey(stepKey) {
    var value = String(stepKey || '');
    var idx = value.indexOf('.');
    return idx > 0 ? value.slice(0, idx) : '';
  }

  function updateSequenceProgress(run, stepKey, resultState) {
    var parentKey = getSequenceParentStepKey(stepKey);
    if (!parentKey || !run.sequenceCards || !run.sequenceCards[parentKey]) return;
    var sequenceCard = run.sequenceCards[parentKey];
    var groupKey = String(stepKey);
    sequenceCard.completedKeys = sequenceCard.completedKeys || {};
    if (!sequenceCard.completedKeys[groupKey]) {
      sequenceCard.completedKeys[groupKey] = true;
      sequenceCard.completedGroups = Number(sequenceCard.completedGroups || 0) + 1;
    }
    var totalGroups = Number(sequenceCard.totalGroups || 0);
    var completedGroups = Number(sequenceCard.completedGroups || 0);
    var progressText = totalGroups > 0
      ? completedGroups + '/' + totalGroups + ' волн завершено'
      : '';
    runs.updateSequenceCard(sequenceCard, {
      completedGroups: completedGroups,
      progress: progressText,
      state:
        resultState === 'error'
          ? 'error'
          : totalGroups > 0 && completedGroups >= totalGroups
            ? 'done'
            : 'running',
    });
  }

  function createTraceController(ctx) {
    var state = {
      messagesEl: ctx.messagesEl,
      runSeq: 0,
      currentRun: null,
    };

    function getTimeline() {
      return state.messagesEl && state.messagesEl.__chatTimeline
        ? state.messagesEl.__chatTimeline
        : null;
    }

    function appendMessage(text, role) {
      var shouldStick = shared.isNearBottom(state.messagesEl);
      var el = document.createElement('div');
      el.className = 'message ' + role;
      if (role === 'assistant') {
        el.innerHTML = shared.renderAssistantMessage(text);
        var timeline = getTimeline();
        var assistantSummary = timeline && typeof timeline.buildAssistantThreadSummary === 'function'
          ? timeline.buildAssistantThreadSummary()
          : '';
        var assistantLabel = document.createElement('div');
        assistantLabel.className = 'message-thread-label message-thread-label-result';
        assistantLabel.textContent = 'Итог';
        el.insertBefore(assistantLabel, el.firstChild);
        if (assistantSummary) {
          var assistantMeta = document.createElement('div');
          assistantMeta.className = 'message-thread-summary';
          assistantMeta.textContent = 'Связано с выполнением: ' + assistantSummary;
          el.insertBefore(assistantMeta, assistantLabel.nextSibling);
        }
        shared.postRenderAssistant(el);
      } else if (role === 'user') {
        var requestLabel = document.createElement('div');
        requestLabel.className = 'message-thread-label message-thread-label-request';
        requestLabel.textContent = 'Запрос';
        el.appendChild(requestLabel);

        var body = document.createElement('div');
        body.className = 'message-user-body';
        body.textContent = text;
        el.appendChild(body);

        var meta = document.createElement('div');
        meta.className = 'message-user-meta';
        el.appendChild(meta);
      } else {
        el.textContent = text;
      }
      var timeline = getTimeline();
      if (timeline) {
        if (role === 'user') {
          timeline.openTurnForUser(el);
        } else if (role === 'assistant') {
          timeline.appendAssistant(el);
        } else {
          timeline.appendToCurrentTurn(el, role);
          if (role === 'error' && typeof timeline.closeCurrentTurn === 'function') {
            timeline.closeCurrentTurn('error');
          }
        }
      } else {
        state.messagesEl.appendChild(el);
      }
      shared.scrollToBottom(state.messagesEl, shouldStick || role !== 'status');
      return el;
    }

    function handleTraceEvent(msg) {
      var phase = msg.phase;
      var data = msg.data || {};
      var text = msg.text || '';
      var run = runs.ensureRun(state);
      var shouldStick = shared.isNearBottom(state.messagesEl);

      if (phase === 'agent-think') {
        runs.settleRunningSteps(run, 'done');
        var thinkSignature = shared.compactTraceText(text);
        var previousStep = runs.getLastStepRecord(run);
        var thinkStep =
          previousStep &&
          previousStep.titleEl &&
          previousStep.titleEl.textContent === 'Планирование' &&
          previousStep.noteEl &&
          shared.compactTraceText(previousStep.noteEl.textContent || '') === thinkSignature
            ? previousStep
            : runs.ensureStep(run, data.step);
        runs.updateStep(thinkStep, {
          title: 'Планирование',
          subtitle: text,
          note: text,
          state: 'running',
        });
        runs.updateRunSummary(run, text);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-action-sequence') {
        var sequenceSummary = shared.compactTraceText(data.summary || text || 'Выполняю волну шагов.');
        var sequenceDetail = shared.compactTraceText(data.detail || '');
        var sequenceCard = runs.ensureSequenceCard(run, data.step);
        var totalGroups = Number(data.groupCount || 0);
        var totalActions = Number(data.totalActions || 0);
        var completedGroups = Number(data.completedGroups || 0);
        var currentGroup = Number(data.currentGroup || 0);
        var sequenceStatus = String(data.status || 'running');
        var progressText = '';
        if (sequenceStatus === 'done' && totalGroups > 0) {
          progressText = totalGroups + '/' + totalGroups + ' волн завершено';
        } else if (sequenceStatus === 'stopped' && totalGroups > 0) {
          progressText = completedGroups + '/' + totalGroups + ' волн завершено до остановки';
        } else if ((sequenceStatus === 'error' || sequenceStatus === 'blocked') && totalGroups > 0) {
          progressText = completedGroups + '/' + totalGroups + ' волн завершено';
        } else if (totalGroups > 0) {
          progressText = completedGroups + '/' + totalGroups + ' волн завершено';
          if (currentGroup > 0) {
            progressText += ' • сейчас ' + currentGroup + '/' + totalGroups;
          }
        }
        runs.updateSequenceCard(sequenceCard, {
          title: totalActions > 1 ? 'Волна шагов' : 'Шаг ответа модели',
          subtitle: sequenceSummary,
          meta: sequenceDetail,
          totalGroups: totalGroups,
          totalActions: totalActions,
          completedGroups: completedGroups,
          progress: progressText,
          state:
            sequenceStatus === 'error' || sequenceStatus === 'blocked'
              ? 'error'
              : sequenceStatus === 'stopped'
                ? 'stopped'
                : sequenceStatus === 'done'
                  ? 'done'
                  : 'running',
        });
        runs.updateRunSummary(run, sequenceSummary);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-tool') {
        var toolStep = runs.ensureStep(run, data.step);
        var toolTitle = shared.friendlyToolName(data);
        var toolSubtitle = data.reasoning || shared.summarizeArgs(data.args) || text;
        var toolCapabilities = shared.summarizeToolCapabilities(data);
        var toolNote = data.reasoning || '';
        if (toolCapabilities) {
          toolNote = toolNote ? toolNote + '\n' + toolCapabilities : toolCapabilities;
        }
        if (!toolStep.countedTool && data.countsAsTool !== false) {
          toolStep.countedTool = true;
          run.toolCount += 1;
        }
        runs.updateStep(toolStep, {
          title: toolTitle,
          subtitle: toolSubtitle,
          note: toolNote,
          args: data.compactInTrace ? {} : (data.args || {}),
          preview: '',
          state: 'running',
        });
        run.activeSubagentStepKey = data.tool === 'subagent' ? toolStep.key : null;
        runs.updateRunSummary(run, 'Выполняю ' + toolTitle + '.');
        runs.updateRunStats(run);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-result') {
        var resultStep = runs.ensureStep(run, data.step);
        var resultSubtitle = shared.summarizeToolResult(data.tool, data);
        var resultNote = shared.buildResultNote(data);
        var resultDetail = shared.buildResultDetail(data);
        var resultFacts = shared.buildResultFacts(data);
        var resultStructured = shared.buildStructuredResultSections(data);
        var resultPreview = shared.buildResultPreview(data);
        var resultPreviewTitle = shared.buildResultPreviewTitle(data);
        var resultNextStep = shared.getResultNextStep(data);
        runs.updateStep(resultStep, {
          title: shared.friendlyToolName(data),
          subtitle: resultSubtitle,
          note: resultNote,
          detail: resultDetail,
          facts: resultFacts,
          structured: resultStructured,
          previewTitle: resultPreviewTitle,
          preview: resultPreview,
          nextStep: resultNextStep,
          state: data.error ? 'error' : 'done',
        });
        updateSequenceProgress(run, data.step, data.error ? 'error' : 'done');
        syncApprovalCardWithResult(resultStep, data);
        if (data.tool === 'subagent') {
          subagents.updateSubagentHostStats(run, resultStep.key);
          run.activeSubagentStepKey = null;
        }
        runs.updateRunSummary(run, resultSubtitle);
        runs.updateRunStats(run);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'tool-batch-child-start') {
        var parentStep = runs.ensureStep(run, data.step);
        var childStart = runs.ensureStepChild(parentStep, data.index);
        if (!childStart.countedTool) {
          childStart.countedTool = true;
          run.toolCount += 1;
        }
        var childStartMeta = shared.summarizeArgs(data.args) || shared.summarizeToolCapabilities(data) || '';
        runs.updateStepChild(parentStep, childStart, {
          title: '[' + String(data.index || '?') + '/' + String(data.total || '?') + '] ' + shared.friendlyToolName(data),
          subtitle: shared.compactTraceText(data.startSummary || text || 'Шаг батча запущен'),
          meta: childStartMeta,
          preview: '',
          state: 'running',
        });
        runs.updateRunSummary(run, 'Выполняю пакет утилит.');
        runs.updateRunStats(run);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'tool-batch-child-result') {
        var parentResultStep = runs.ensureStep(run, data.step);
        var childResult = runs.ensureStepChild(parentResultStep, data.index);
        var childResultMeta = shared.buildResultFacts(data).join(' • ') || shared.buildResultDetail(data) || '';
        runs.updateStepChild(parentResultStep, childResult, {
          title: '[' + String(data.index || '?') + '/' + String(data.total || '?') + '] ' + shared.friendlyToolName(data),
          subtitle: shared.compactTraceText(data.resultSummary || text || 'Шаг батча завершён'),
          meta: childResultMeta,
          preview: shared.buildResultPreview(data),
          state: data.error ? 'error' : 'done',
        });
        runs.updateRunSummary(run, shared.compactTraceText(data.resultSummary || 'Пакет утилит обновлён'));
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'approval-request') {
        var approvalStep = data.step ? runs.ensureStep(run, data.step) : runs.getLastStepRecord(run);
        var approvalSummary = shared.compactTraceText(data.summary || text || 'Жду подтверждения');
        var approvalDetail = shared.compactTraceText(data.detail || data.description || '');
        if (approvalStep) {
          runs.updateStep(approvalStep, {
            subtitle: approvalSummary,
            note: approvalDetail,
            facts: data.autoApproved ? ['авторазрешено'] : undefined,
            state: 'running',
          });
        }
        runs.updateRunSummary(run, approvalSummary);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'question-request') {
        var questionStep = data.step ? runs.ensureStep(run, data.step) : runs.getLastStepRecord(run);
        var questionSummary = shared.compactTraceText(data.summary || text || 'Жду ответа пользователя');
        var questionDetail = shared.compactTraceText(data.detail || data.description || '');
        if (questionStep) {
          runs.updateStep(questionStep, {
            subtitle: questionSummary,
            note: questionDetail,
            state: 'running',
          });
        }
        runs.updateRunSummary(run, questionSummary);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-tool-summary') {
        var batchSummary = shared.compactTraceText(data.summary || text || 'Сводка по шагам.');
        var batchDetail = shared.compactTraceText(data.detail || '');
        runs.updateRunSummary(run, batchSummary);
        runs.appendRunNote(
          state,
          run,
          batchDetail ? batchSummary + '\n' + batchDetail : batchSummary,
          'muted',
          'tool-summary:' + batchSummary
        );
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-flow-summary') {
        var flowSummary = shared.compactTraceText(data.summary || text || 'Скорректировал ход выполнения.');
        var flowDetail = shared.compactTraceText(data.detail || '');
        runs.updateRunSummary(run, flowSummary);
        runs.appendRunNote(
          state,
          run,
          flowDetail ? flowSummary + '\n' + flowDetail : flowSummary,
          'muted',
          'flow-summary:' + flowSummary
        );
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-auto') {
        var autoChip = runs.ensureAutoChip(run, data.tool || 'auto');
        autoChip.className = 'trace-chip is-running';
        autoChip.textContent = shared.friendlyToolName(data) + ' • в работе';
        runs.updateRunSummary(run, 'Собираю стартовый контекст.');
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-auto-done') {
        var autoDoneChip = runs.ensureAutoChip(run, data.tool || 'auto');
        autoDoneChip.className = 'trace-chip is-done';
        autoDoneChip.textContent = shared.friendlyToolName(data) + ' • строк: ' + (data.lines || 0);
        runs.updateRunStats(run);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-answer') {
        runs.updateRunSummary(run, text || 'Формирую финальный ответ.');
        runs.appendRunNote(state, run, text || 'Формирую финальный ответ.', 'muted', 'agent-answer');
        return;
      }

      if (phase === 'agent-recovery') {
        var recoverySummary = shared.summarizeRecovery(data, text);
        var recoveryText = recoverySummary + (data.detail ? '\n' + data.detail : '');
        runs.updateRunSummary(run, recoverySummary);
        runs.appendRunNote(
          state,
          run,
          recoveryText,
          data.kind === 'tool_error' ? 'warning' : 'muted',
          'recovery:' + String(data.kind || '') + ':' + String(data.tool || '')
        );
        return;
      }

      if (phase === 'agent-transition') {
        var transitionSummary = shared.summarizeTransition(data, text);
        runs.updateRunSummary(run, transitionSummary);
        if (data.detail) {
          runs.appendRunNote(
            state,
            run,
            transitionSummary + '\n' + data.detail,
            'muted',
            'transition:' + String(data.reason || '')
          );
        }
        return;
      }

      if (phase === 'subagent-batch') {
        var batchStepKey = run.activeSubagentStepKey;
        var batchTasks = Array.isArray(data.tasks) ? data.tasks : [];
        for (var batchIndex = 0; batchIndex < batchTasks.length; batchIndex++) {
          var batchTask = batchTasks[batchIndex];
          var queued = subagents.ensureSubagent(run, batchTask.id || ('task-' + (batchIndex + 1)));
          subagents.updateSubagent(queued, {
            label: batchTask.label || ('task-' + (batchIndex + 1)),
            state: 'queued',
            purpose: batchTask.detail || batchTask.purpose || batchTask.label || 'Задача подагента',
            meta: batchTask.metaText || describeSubagentMode(batchTask.subagentType || 'explore', batchTask.readonly),
          });
        }
        runs.updateRunSummary(run, shared.compactTraceText(data.summary || shared.summarizeSubagentWave(batchTasks)));
        if (batchStepKey) {
          subagents.updateSubagentHostStats(run, batchStepKey);
        }
        subagents.appendSubagentNote(state, run, data.detail || text, 'muted', batchStepKey);
        return;
      }

      if (phase === 'subagent-queued') {
        var queuedSubagent = subagents.ensureSubagent(run, data.id || 'subagent');
        subagents.updateSubagent(queuedSubagent, {
          label: data.label || '',
          state: 'queued',
          purpose: data.detail || data.purpose || queuedSubagent.purposeEl.textContent,
          meta: data.metaText || (data.subagentType ? describeSubagentMode(data.subagentType, data.readonly) : queuedSubagent.metaEl.textContent),
        });
        subagents.updateSubagentHostStats(run, queuedSubagent.parentStepKey);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'subagent-start') {
        var started = subagents.ensureSubagent(run, data.id || 'subagent');
        var startMeta = [];
        if (data.subagentType) startMeta.push(data.subagentType);
        if (data.readonly !== undefined) startMeta.push(data.readonly ? 'только чтение' : 'запись');
        if (Array.isArray(data.files) && data.files.length > 0) startMeta.push('файлов: ' + data.files.length);
        subagents.updateSubagent(started, {
          label: data.label || '',
          state: 'running',
          purpose: data.detail || data.purpose || text || started.purposeEl.textContent,
          meta: data.metaText || startMeta.join(' • '),
        });
        subagents.updateSubagentHostStats(run, started.parentStepKey);
        runs.updateRunSummary(run, shared.compactTraceText(data.summary || ('Подагент ' + (data.label || data.id || '') + ' выполняется.')));
        runs.updateRunStats(run);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'subagent-step') {
        var stepped = subagents.ensureSubagent(run, data.id || 'subagent');
        subagents.updateSubagent(stepped, {
          label: data.label || '',
          state: stepped.state === 'error' ? 'error' : 'running',
          meta: data.metaText || ('шаг ' + (data.step || 1)),
        });
        subagents.updateSubagentHostStats(run, stepped.parentStepKey);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'subagent-tool') {
        var subTool = subagents.ensureSubagent(run, data.id || 'subagent');
        var toolText = data.toolText || ((data.tool || 'инструмент') + (shared.summarizeArgs(data.args) ? ' • ' + shared.summarizeArgs(data.args) : ''));
        subagents.updateSubagent(subTool, {
          label: data.label || '',
          state: subTool.state === 'error' ? 'error' : 'running',
          tool: toolText,
          preview: data.detail || data.reasoning || '',
        });
        subagents.updateSubagentHostStats(run, subTool.parentStepKey);
        runs.updateRunSummary(run, shared.compactTraceText(data.summary || 'Подагент выполняет действие.'));
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'subagent-result') {
        var subResult = subagents.ensureSubagent(run, data.id || 'subagent');
        subagents.updateSubagent(subResult, {
          label: data.label || '',
          state: subResult.state === 'error' ? 'error' : 'running',
          tool: data.toolText || (data.tool ? data.tool + ' • результат' : 'результат'),
          preview: data.resultPreview || data.detail || '',
        });
        subagents.updateSubagentHostStats(run, subResult.parentStepKey);
        runs.updateRunSummary(run, shared.compactTraceText(data.summary || 'Подагент получил результат.'));
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'subagent-done') {
        var done = subagents.ensureSubagent(run, data.id || 'subagent');
        subagents.updateSubagent(done, {
          label: data.label || '',
          state: 'done',
          preview: data.preview || '',
        });
        subagents.updateSubagentHostStats(run, done.parentStepKey);
        runs.updateRunSummary(run, shared.compactTraceText(data.summary || 'Подагент завершён.'));
        runs.updateRunStats(run);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-todos') {
        var todosSummary = shared.compactTraceText(data.summary || shared.summarizeTodos(data.todos));
        var todosDetail = shared.compactTraceText(data.detail || 'Список задач обновлён.');
        runs.updateRunSummary(run, todosSummary);
        runs.appendRunNote(state, run, todosDetail, 'muted', 'todos');
        return;
      }

      if (phase === 'agent-mode') {
        var modeSummary = shared.compactTraceText(data.summary || text || 'Режим агента изменён.');
        var modeDetail = shared.compactTraceText(data.detail || text || 'Режим агента изменён.');
        runs.updateRunSummary(run, modeSummary);
        runs.appendRunNote(state, run, modeDetail, 'muted', 'mode:' + String(data.mode || ''));
        return;
      }

      if (phase === 'agent-plan-approval') {
        var approvalSummary =
          data.summary || (data.status === 'approved'
            ? 'План утверждён'
            : data.status === 'rejected'
              ? 'План возвращён на доработку'
              : data.status === 'cancelled'
                ? 'Согласование плана прервано'
              : 'План ожидает подтверждения');
        runs.updateRunSummary(run, approvalSummary);
        runs.appendRunNote(
          state,
          run,
          shared.compactTraceText(data.detail || approvalSummary),
          data.status === 'rejected' ? 'warning' : 'muted',
          'plan-approval:' + String(data.status || '')
        );
        return;
      }

      if (phase === 'subagent-summarized') {
        var summarized = subagents.ensureSubagent(run, data.id || 'subagent');
        subagents.updateSubagent(summarized, {
          label: data.label || '',
          state: summarized.state === 'error' ? 'error' : 'done',
          preview: data.preview || summarized.previewEl.textContent,
        });
        subagents.updateSubagentHostStats(run, summarized.parentStepKey);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'subagent-error') {
        var failed = subagents.ensureSubagent(run, data.id || 'subagent');
        subagents.updateSubagent(failed, {
          label: data.label || '',
          state: 'error',
          preview: data.error || data.detail || text || '',
        });
        subagents.updateSubagentHostStats(run, failed.parentStepKey);
        subagents.appendSubagentNote(state, run, data.detail || text, 'warning', failed.parentStepKey);
        runs.updateRunSummary(run, shared.compactTraceText(data.summary || 'Подагент завершился с ошибкой.'));
        runs.updateRunStats(run);
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'subagent-lifecycle') {
        var lifecycle = subagents.ensureSubagent(run, data.id || 'subagent');
        var lifecycleState = String(data.state || '');
        var nextLifecycleState =
          lifecycleState === 'error'
            ? 'error'
            : lifecycleState === 'done' || lifecycleState === 'summarized'
              ? (lifecycle.state === 'error' ? 'error' : 'done')
              : lifecycleState === 'running'
                ? (lifecycle.state === 'error' ? 'error' : 'running')
                : lifecycle.state || 'queued';
        subagents.updateSubagent(lifecycle, {
          label: data.label || '',
          state: nextLifecycleState,
          purpose:
            lifecycleState === 'planned' || lifecycleState === 'queued'
              ? (data.detail || lifecycle.purposeEl.textContent)
              : undefined,
          meta: data.metaText !== undefined ? data.metaText : lifecycle.metaEl.textContent,
          preview:
            lifecycleState === 'error'
              ? (data.error || data.detail || '')
              : lifecycleState === 'summarized' && data.degraded
                ? (data.detail || lifecycle.previewEl.textContent)
                : undefined,
        });
        subagents.updateSubagentHostStats(run, lifecycle.parentStepKey);
        if (lifecycleState === 'error' || data.degraded) {
          subagents.appendSubagentNote(state, run, data.detail || data.summary || text, lifecycleState === 'error' ? 'warning' : 'muted', lifecycle.parentStepKey);
          runs.updateRunSummary(run, shared.compactTraceText(data.summary || 'Подагент изменил состояние.'));
          runs.updateRunStats(run);
        }
        shared.scrollToBottom(state.messagesEl, shouldStick);
        return;
      }

      if (phase === 'agent-loop') {
        runs.appendRunNote(state, run, text, 'warning', 'agent-loop');
        runs.updateRunSummary(run, text);
        return;
      }

      runs.appendRunNote(state, run, text, 'muted');
    }

    function syncApprovalCardWithResult(stepRecord, data) {
      if (!stepRecord || !stepRecord.childrenEl || !data || !data.tool) return;
      var selectors = '.approval-request.sc-approved-card, .approval-request.pc-approved-card';
      var card = stepRecord.childrenEl.querySelector(selectors);
      if (!card) return;
      var actions = card.querySelector('[data-approval-actions]');
      if (!actions) return;

      if (data.tool === 'shell') {
        actions.innerHTML = data.error
          ? ('<span class="sc-status sc-denied">' + (data.autoApproved ? 'Авторазрешено, но команда завершилась с ошибкой' : 'Подтверждено, но команда завершилась с ошибкой') + '</span>')
          : ('<span class="sc-status sc-approved">' + (data.autoApproved ? 'Авторазрешено, команда выполнена' : 'Подтверждено, команда выполнена') + '</span>');
        card.classList.add('is-collapsed');
        return;
      }

      if (
        data.tool === 'str_replace' ||
        data.tool === 'write_file' ||
        data.tool === 'delete_file' ||
        data.tool === 'edit_notebook'
      ) {
        actions.innerHTML = data.error
          ? ('<span class="pc-status pc-rejected">' + (data.autoApproved ? 'Авторазрешено, но изменение не применилось' : 'Подтверждено, но изменение не применилось') + '</span>')
          : ('<span class="pc-status pc-approved">' + (data.autoApproved ? 'Авторазрешено, изменение применено' : 'Подтверждено, изменение применено') + '</span>');
        card.classList.add('is-collapsed');
      }
    }

    return {
      appendMessage: appendMessage,
      handleTraceEvent: handleTraceEvent,
      appendRunNote: function (run, text, tone, key) {
        if (!run || !text) return;
        runs.appendRunNote(state, run, text, tone, key);
      },
      startRun: function () { return runs.createRun(state); },
      finishRun: function (nextState, summaryText) { return runs.finishRun(state, nextState, summaryText); },
      replayRun: function (snapshot) {
        if (!snapshot || !Array.isArray(snapshot.events) || snapshot.events.length === 0) return null;
        var run = runs.createRun(state);
        snapshot.events.forEach(function (event) {
          if (!event || !event.phase || typeof event.text !== 'string') return;
          handleTraceEvent({
            phase: event.phase,
            text: event.text,
            data: event.data || {},
          });
        });
        runs.finishRun(
          state,
          snapshot.state === 'error' || snapshot.state === 'stopped' ? snapshot.state : 'done',
          snapshot.summary || ''
        );
        return run;
      },
      resetView: function () {
        state.currentRun = null;
        state.runSeq = 0;
        var timeline = getTimeline();
        if (timeline && typeof timeline.reset === 'function') {
          timeline.reset();
        }
        state.messagesEl.innerHTML = '';
      },
    };
  }

  window.ChatTrace = {
    createTraceController: createTraceController,
  };

  function describeSubagentMode(subagentType, readonly) {
    var typeLabel = subagentType === 'explore'
      ? 'анализ'
      : subagentType === 'generalPurpose'
        ? 'универсальный'
        : subagentType === 'shell'
          ? 'shell'
          : String(subagentType || '');
    return typeLabel + ' • ' + (readonly === false ? 'запись' : 'только чтение');
  }
})();
