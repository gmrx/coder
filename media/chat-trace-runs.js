(function () {
  'use strict';

  var shared = window.ChatTraceShared;

  function parseStepKey(stepKey) {
    return String(stepKey || '')
      .split('.')
      .map(function (part) { return parseInt(part, 10); })
      .filter(function (part) { return Number.isFinite(part); });
  }

  function compareStepKeys(left, right) {
    var leftParts = parseStepKey(left);
    var rightParts = parseStepKey(right);
    var length = Math.max(leftParts.length, rightParts.length);
    for (var index = 0; index < length; index++) {
      var leftPart = typeof leftParts[index] === 'number' ? leftParts[index] : -1;
      var rightPart = typeof rightParts[index] === 'number' ? rightParts[index] : -1;
      if (leftPart !== rightPart) return leftPart - rightPart;
    }
    return String(left).localeCompare(String(right));
  }

  function compactMetricNumber(value) {
    var number = Math.max(0, Number(value || 0));
    if (number >= 1000000) return Math.round(number / 100000) / 10 + 'M';
    if (number >= 1000) return Math.round(number / 100) / 10 + 'k';
    return String(number);
  }

  function shortModelName(model) {
    var value = String(model || '').trim();
    if (!value) return '';
    var slash = value.lastIndexOf('/');
    if (slash >= 0 && slash < value.length - 1) value = value.slice(slash + 1);
    return value.length > 28 ? value.slice(0, 25) + '...' : value;
  }

  function setMetric(el, text, visible, title) {
    if (!el) return;
    el.textContent = visible ? text : '';
    el.title = visible ? (title || text) : '';
    el.classList.toggle('hidden', !visible);
  }

  function setRunCollapsed(run, collapsed) {
    if (!run) return;
    run.el.classList.toggle('is-collapsed', collapsed);
    run.bodyEl.classList.toggle('hidden', collapsed);
    run.toggleEl.textContent = collapsed ? 'Показать' : 'Скрыть';
  }

  function updateRunStats(run) {
    var stepCount = Object.keys(run.steps).length;
    var subagentIds = Object.keys(run.subagents);
    var subTotal = subagentIds.length;
    var orphanTotal = 0;
    var orphanDone = 0;
    var orphanRunning = 0;
    var orphanError = 0;
    var autoCount = Object.keys(run.autoTools).length;
    var now = run.finishedAt || Date.now();
    var lineStats = run.lineStats || {};
    var changeMetrics = run.changeMetrics || {};
    var agentAdded = Math.max(0, Number(lineStats.added || 0));
    var agentRemoved = Math.max(0, Number(lineStats.removed || 0));
    var agentModifiedByUser = Math.max(0, Number(changeMetrics.agentModifiedByUserLines || 0));
    var agentDeletedByUser = Math.max(0, Number(changeMetrics.agentDeletedByUserLines || 0));
    var userOnly = Math.max(0, Number(changeMetrics.userOnlyLines || 0));
    var userRemoved = Math.max(0, Number(changeMetrics.userRemovedLines || 0));
    var toolErrors = Math.max(0, Number(run.errorCount || 0));
    var model = String(run.model || (run.modelUsage && run.modelUsage.model) || '');
    var modelUsage = run.modelUsage || {};
    var promptTokens = Math.max(0, Number(modelUsage.promptTokens || 0));
    var completionTokens = Math.max(0, Number(modelUsage.completionTokens || 0));
    var totalTokens = Math.max(0, Number(modelUsage.totalTokens || 0));
    var modelCalls = Math.max(0, Number(modelUsage.calls || 0));

    for (var index = 0; index < subagentIds.length; index++) {
      var subagent = run.subagents[subagentIds[index]];
      if (!subagent.parentStepKey) {
        orphanTotal++;
        if (subagent.state === 'done') orphanDone++;
        else if (subagent.state === 'error') orphanError++;
        else orphanRunning++;
      }
    }

    run.metrics.steps.textContent = stepCount + ' шагов';
    run.metrics.tools.textContent = run.toolCount + ' инструментов';
    run.metrics.subagents.textContent = subTotal + ' подагентов';
    run.metrics.duration.textContent = shared.formatDuration(now - run.startedAt);
    setMetric(run.metrics.model, 'модель: ' + shortModelName(model), !!model, model ? 'Модель: ' + model : '');
    setMetric(
      run.metrics.tokens,
      totalTokens > 0
        ? 'токены: ' + compactMetricNumber(promptTokens) + ' in + ' + compactMetricNumber(completionTokens) + ' out'
        : modelCalls > 0
          ? 'LLM вызовов: ' + compactMetricNumber(modelCalls)
        : '',
      totalTokens > 0 || promptTokens > 0 || completionTokens > 0 || modelCalls > 0,
      totalTokens > 0
        ? 'Использование API: ' + compactMetricNumber(promptTokens) + ' input + ' + compactMetricNumber(completionTokens) + ' output = ' + compactMetricNumber(totalTokens) + (modelCalls > 0 ? '\nВызовов модели: ' + compactMetricNumber(modelCalls) : '')
        : modelCalls > 0
          ? 'Вызовов модели: ' + compactMetricNumber(modelCalls)
        : ''
    );
    setMetric(
      run.metrics.lines,
      '+' + agentAdded + ' / -' + agentRemoved + ' строк',
      agentAdded > 0 || agentRemoved > 0,
      'Строки, изменённые агентом: добавлено ' + agentAdded + ', удалено ' + agentRemoved
    );
    setMetric(
      run.metrics.userEdits,
      'пользователь: ' + (agentModifiedByUser + agentDeletedByUser) + ' по агенту • ' + (userOnly + userRemoved) + ' своих',
      agentModifiedByUser > 0 || agentDeletedByUser > 0 || userOnly > 0 || userRemoved > 0,
      [
        'Строки агента, изменённые пользователем: ' + agentModifiedByUser,
        'Строки агента, удалённые пользователем: ' + agentDeletedByUser,
        'Строки, изменённые пользователем вне правок агента: ' + userOnly,
        'Строки, удалённые пользователем вне правок агента: ' + userRemoved
      ].join('\n')
    );
    setMetric(
      run.metrics.errors,
      'ошибок утилит: ' + toolErrors,
      toolErrors > 0,
      'Ошибки выполнения инструментов/утилит агента: ' + toolErrors
    );
    run.el.dataset.agentAdded = String(agentAdded);
    run.el.dataset.agentRemoved = String(agentRemoved);
    run.el.dataset.agentUserEdited = String(agentModifiedByUser + agentDeletedByUser);
    run.el.dataset.userOnlyEdited = String(userOnly + userRemoved);
    run.el.dataset.toolErrors = String(toolErrors);

    run.autoSection.el.classList.toggle('hidden', autoCount === 0);
    run.subagentsSection.el.classList.toggle('hidden', orphanTotal === 0);
    run.notesSection.el.classList.toggle('hidden', run.notesEl.childNodes.length === 0);

    if (autoCount > 0) {
      run.autoSection.metaEl.textContent = autoCount + ' эл.';
    }

    if (orphanTotal > 0) {
      if (orphanError > 0) {
        run.subagentsSection.metaEl.textContent = orphanDone + '/' + orphanTotal + ' готово • ошибок: ' + orphanError;
      } else if (orphanRunning > 0) {
        run.subagentsSection.metaEl.textContent = orphanDone + '/' + orphanTotal + ' готово';
      } else {
        run.subagentsSection.metaEl.textContent = orphanDone + '/' + orphanTotal + ' готово';
      }
    }
  }

  function updateRunSummary(run, text) {
    if (!run) return;
    var summary = shared.compactTraceText(text);
    if (summary) {
      run.summaryEl.textContent = summary;
    }
  }

  function getLastStepRecord(run) {
    if (!run) return null;
    var keys = Object.keys(run.steps)
      .sort(compareStepKeys);
    if (keys.length === 0) return null;
    return run.steps[keys[keys.length - 1]] || null;
  }

  function createRun(state) {
    var messagesEl = state.messagesEl;
    if (state.currentRun && state.currentRun.state === 'running') {
      finishRun(state, 'stopped', 'Остановлено');
    }
    if (state.currentRun) {
      setRunCollapsed(state.currentRun, true);
    }

    state.runSeq++;
    var shouldStick = shared.isNearBottom(messagesEl);

    var el = document.createElement('section');
    el.className = 'message trace-run is-running';
    el.dataset.runId = String(state.runSeq);

    var header = document.createElement('div');
    header.className = 'trace-run-header';

    var info = document.createElement('div');
    info.className = 'trace-run-info';

    var top = document.createElement('div');
    top.className = 'trace-run-top';

    var title = document.createElement('div');
    title.className = 'trace-run-title';
    title.textContent = 'Запуск агента';
    top.appendChild(title);

    var status = document.createElement('span');
    shared.setBadgeState(status, 'running', 'В работе');
    top.appendChild(status);
    info.appendChild(top);

    var summary = document.createElement('div');
    summary.className = 'trace-run-summary';
    summary.textContent = 'Собираю контекст и план.';
    info.appendChild(summary);

    var metrics = document.createElement('div');
    metrics.className = 'trace-run-metrics';
    var metricModel = document.createElement('span');
    metricModel.className = 'trace-metric is-model hidden';
    var metricTokens = document.createElement('span');
    metricTokens.className = 'trace-metric is-tokens hidden';
    var metricSteps = document.createElement('span');
    metricSteps.className = 'trace-metric';
    var metricTools = document.createElement('span');
    metricTools.className = 'trace-metric';
    var metricSubagents = document.createElement('span');
    metricSubagents.className = 'trace-metric';
    var metricDuration = document.createElement('span');
    metricDuration.className = 'trace-metric';
    var metricLines = document.createElement('span');
    metricLines.className = 'trace-metric is-lines hidden';
    var metricUserEdits = document.createElement('span');
    metricUserEdits.className = 'trace-metric is-user-edits hidden';
    var metricErrors = document.createElement('span');
    metricErrors.className = 'trace-metric is-errors hidden';
    metrics.appendChild(metricModel);
    metrics.appendChild(metricTokens);
    metrics.appendChild(metricSteps);
    metrics.appendChild(metricTools);
    metrics.appendChild(metricSubagents);
    metrics.appendChild(metricDuration);
    metrics.appendChild(metricLines);
    metrics.appendChild(metricUserEdits);
    metrics.appendChild(metricErrors);
    info.appendChild(metrics);

    var toggle = document.createElement('button');
    toggle.className = 'trace-run-toggle';
    toggle.type = 'button';
    toggle.textContent = 'Скрыть';

    header.appendChild(info);
    header.appendChild(toggle);
    el.appendChild(header);

    var body = document.createElement('div');
    body.className = 'trace-run-body';

    var autoSection = shared.createSection('Автоконтекст', 'trace-auto-section');
    var autoList = document.createElement('div');
    autoList.className = 'trace-chip-list';
    autoSection.contentEl.appendChild(autoList);
    body.appendChild(autoSection.el);

    var stepsSection = shared.createSection('Выполнение', 'trace-steps-section');
    var stepsList = document.createElement('div');
    stepsList.className = 'trace-step-list';
    stepsSection.contentEl.appendChild(stepsList);
    stepsSection.el.classList.remove('hidden');
    body.appendChild(stepsSection.el);

    var subagentsSection = shared.createSection('Подагенты', 'trace-subagents-section');
    var subagentList = document.createElement('div');
    subagentList.className = 'trace-subagent-list';
    subagentsSection.contentEl.appendChild(subagentList);
    body.appendChild(subagentsSection.el);

    var notesSection = shared.createSection('Заметки', 'trace-notes-section');
    var notesList = document.createElement('div');
    notesList.className = 'trace-note-list';
    notesSection.contentEl.appendChild(notesList);
    body.appendChild(notesSection.el);

    el.appendChild(body);

    var run = {
      id: state.runSeq,
      state: 'running',
      startedAt: Date.now(),
      finishedAt: 0,
      toolCount: 0,
      errorCount: 0,
      lineStats: { added: 0, removed: 0 },
      changeMetrics: null,
      model: '',
      modelUsage: null,
      countedFileChanges: {},
      countedToolErrors: {},
      el: el,
      bodyEl: body,
      toggleEl: toggle,
      statusEl: status,
      summaryEl: summary,
      stepsSection: stepsSection,
      stepsEl: stepsList,
      autoSection: autoSection,
      autoEl: autoList,
      subagentsSection: subagentsSection,
      subagentsEl: subagentList,
      notesSection: notesSection,
      notesEl: notesList,
      metrics: {
        model: metricModel,
        tokens: metricTokens,
        steps: metricSteps,
        tools: metricTools,
        subagents: metricSubagents,
        duration: metricDuration,
        lines: metricLines,
        userEdits: metricUserEdits,
        errors: metricErrors,
      },
      steps: {},
      sequenceCards: {},
      subagents: {},
      autoTools: {},
      activeSubagentStepKey: null,
    };

    header.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('.trace-run-toggle')) return;
      setRunCollapsed(run, !run.bodyEl.classList.contains('hidden'));
    });
    toggle.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setRunCollapsed(run, !run.bodyEl.classList.contains('hidden'));
    });

    var timeline = messagesEl && messagesEl.__chatTimeline ? messagesEl.__chatTimeline : null;
    if (timeline && typeof timeline.appendToCurrentTurn === 'function') {
      timeline.appendToCurrentTurn(el, 'execution');
    } else {
      messagesEl.appendChild(el);
    }
    state.currentRun = run;
    updateRunStats(run);
    shared.scrollToBottom(messagesEl, shouldStick || true);
    return run;
  }

  function ensureRun(state) {
    return state.currentRun || createRun(state);
  }

  function finishRun(state, nextState, summaryText) {
    var currentRun = state.currentRun;
    if (!currentRun || currentRun.state !== 'running') return;

    settleRunningSteps(currentRun, nextState === 'error' ? 'error' : 'done');
    settleRunningSequences(currentRun, nextState === 'error' ? 'error' : nextState === 'stopped' ? 'stopped' : 'done');
    currentRun.state = nextState;
    currentRun.finishedAt = Date.now();
    currentRun.el.classList.remove('is-running');
    currentRun.el.classList.add('is-' + nextState);

    if (nextState === 'done') {
      shared.setBadgeState(currentRun.statusEl, 'done', 'Готово');
    } else if (nextState === 'error') {
      shared.setBadgeState(currentRun.statusEl, 'error', 'Ошибка');
    } else {
      shared.setBadgeState(currentRun.statusEl, 'stopped', 'Остановлено');
    }

    if (summaryText) {
      currentRun.summaryEl.textContent = shared.compactTraceText(summaryText);
    } else if (nextState === 'done') {
      currentRun.summaryEl.textContent = 'Готово.';
    } else if (nextState === 'error') {
      currentRun.summaryEl.textContent = 'Во время выполнения возникла ошибка.';
    } else {
      currentRun.summaryEl.textContent = 'Запуск остановлен.';
    }

    updateRunStats(currentRun);
  }

  function settleRunningSteps(run, state) {
    var keys = Object.keys(run.steps);
    for (var index = 0; index < keys.length; index++) {
      var record = run.steps[keys[index]];
      if (!record || !record.badgeEl || record.badgeEl.textContent !== 'В работе') continue;
      updateStep(record, {
        state: state === 'error' ? 'error' : 'done',
      });
    }
  }

  function settleRunningSequences(run, state) {
    var keys = Object.keys(run.sequenceCards || {});
    for (var index = 0; index < keys.length; index++) {
      var record = run.sequenceCards[keys[index]];
      if (!record) continue;
      if (record.state !== 'running') continue;
      updateSequenceCard(record, {
        state: state === 'error' ? 'error' : state === 'stopped' ? 'stopped' : 'done',
      });
    }
  }

  function ensureSequenceCard(run, step) {
    var key = String(step || Object.keys(run.sequenceCards || {}).length + 1);
    run.sequenceCards = run.sequenceCards || {};
    if (run.sequenceCards[key]) return run.sequenceCards[key];

    var el = document.createElement('div');
    el.className = 'trace-sequence is-running';
    el.dataset.sequenceKey = key;

    var top = document.createElement('div');
    top.className = 'trace-sequence-top';

    var lead = document.createElement('div');
    lead.className = 'trace-sequence-lead';

    var title = document.createElement('div');
    title.className = 'trace-sequence-title';
    title.textContent = 'Волна шагов';
    lead.appendChild(title);

    var subtitle = document.createElement('div');
    subtitle.className = 'trace-sequence-subtitle';
    subtitle.textContent = 'Подготавливаю серию действий.';
    lead.appendChild(subtitle);

    var badge = document.createElement('span');
    shared.setBadgeState(badge, 'running', 'В работе');

    top.appendChild(lead);
    top.appendChild(badge);
    el.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'trace-sequence-meta hidden';
    el.appendChild(meta);

    var progress = document.createElement('div');
    progress.className = 'trace-sequence-progress hidden';
    el.appendChild(progress);

    run.stepsEl.appendChild(el);

    var record = {
      key: key,
      el: el,
      titleEl: title,
      subtitleEl: subtitle,
      badgeEl: badge,
      metaEl: meta,
      progressEl: progress,
      state: 'running',
      totalGroups: 0,
      totalActions: 0,
      completedGroups: 0,
      completedKeys: {},
    };

    run.sequenceCards[key] = record;
    return record;
  }

  function updateSequenceCard(record, patch) {
    if (!record || !patch) return;
    if (patch.title !== undefined) {
      record.titleEl.textContent = patch.title || '';
    }
    if (patch.subtitle !== undefined) {
      record.subtitleEl.textContent = shared.compactTraceText(patch.subtitle || '');
    }
    if (patch.meta !== undefined) {
      record.metaEl.textContent = patch.meta || '';
      record.metaEl.classList.toggle('hidden', !patch.meta);
    }
    if (patch.totalGroups !== undefined) {
      record.totalGroups = Number(patch.totalGroups) || 0;
    }
    if (patch.totalActions !== undefined) {
      record.totalActions = Number(patch.totalActions) || 0;
    }
    if (patch.completedGroups !== undefined) {
      record.completedGroups = Number(patch.completedGroups) || 0;
    }
    if (patch.progress !== undefined) {
      record.progressEl.textContent = patch.progress || '';
      record.progressEl.classList.toggle('hidden', !patch.progress);
    }
    if (patch.state === 'running') {
      record.state = 'running';
      record.el.className = 'trace-sequence is-running';
      shared.setBadgeState(record.badgeEl, 'running', 'В работе');
    } else if (patch.state === 'done') {
      record.state = 'done';
      record.el.className = 'trace-sequence is-done';
      shared.setBadgeState(record.badgeEl, 'done', 'Готово');
    } else if (patch.state === 'error') {
      record.state = 'error';
      record.el.className = 'trace-sequence is-error';
      shared.setBadgeState(record.badgeEl, 'error', 'Ошибка');
    } else if (patch.state === 'stopped') {
      record.state = 'stopped';
      record.el.className = 'trace-sequence is-stopped';
      shared.setBadgeState(record.badgeEl, 'stopped', 'Остановлено');
    }
  }

  function ensureStep(run, step) {
    var key = String(step || Object.keys(run.steps).length + 1);
    if (run.steps[key]) return run.steps[key];

    var details = document.createElement('details');
    details.className = 'trace-step is-pending';
    details.dataset.stepKey = key;
    details.open = true;

    var summary = document.createElement('summary');
    summary.className = 'trace-step-summary';

    var indexEl = document.createElement('span');
    indexEl.className = 'trace-step-index';
    indexEl.textContent = '#' + key;

    var main = document.createElement('span');
    main.className = 'trace-step-main';

    var title = document.createElement('span');
    title.className = 'trace-step-title';
    title.textContent = 'Планирование';
    main.appendChild(title);

    var subtitle = document.createElement('span');
    subtitle.className = 'trace-step-subtitle';
    subtitle.textContent = 'Собираю контекст.';
    main.appendChild(subtitle);

    var badge = document.createElement('span');
    shared.setBadgeState(badge, 'running', 'В работе');

    summary.appendChild(indexEl);
    summary.appendChild(main);
    summary.appendChild(badge);
    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'trace-step-body';

    var note = document.createElement('div');
    note.className = 'trace-step-note hidden';
    body.appendChild(note);

    var detail = document.createElement('div');
    detail.className = 'trace-step-detail hidden';
    body.appendChild(detail);

    var facts = document.createElement('div');
    facts.className = 'trace-step-facts hidden';
    body.appendChild(facts);

    var structured = document.createElement('div');
    structured.className = 'trace-step-structured hidden';
    body.appendChild(structured);

    var args = document.createElement('pre');
    args.className = 'trace-code trace-step-args hidden';
    body.appendChild(args);

    var previewTitle = document.createElement('div');
    previewTitle.className = 'trace-step-preview-title hidden';
    body.appendChild(previewTitle);

    var preview = document.createElement('pre');
    preview.className = 'trace-code trace-step-preview hidden';
    body.appendChild(preview);

    var nextTitle = document.createElement('div');
    nextTitle.className = 'trace-step-preview-title hidden';
    nextTitle.textContent = 'Следующий шаг';
    body.appendChild(nextTitle);

    var next = document.createElement('pre');
    next.className = 'trace-code trace-step-next hidden';
    body.appendChild(next);

    var children = document.createElement('div');
    children.className = 'trace-step-children hidden';
    body.appendChild(children);

    details.appendChild(body);
    run.stepsEl.appendChild(details);

    var record = {
      key: key,
      el: details,
      titleEl: title,
      subtitleEl: subtitle,
      badgeEl: badge,
      noteEl: note,
      detailEl: detail,
      factsEl: facts,
      structuredEl: structured,
      argsEl: args,
      previewTitleEl: previewTitle,
      previewEl: preview,
      nextTitleEl: nextTitle,
      nextEl: next,
      childrenEl: children,
      batchChildren: {},
      countedTool: false,
    };

    run.steps[key] = record;
    updateRunStats(run);
    return record;
  }

  function updateStep(record, patch) {
    if (!record || !patch) return;
    if (patch.title) record.titleEl.textContent = patch.title;
    if (patch.subtitle) record.subtitleEl.textContent = shared.compactTraceText(patch.subtitle);
    if (patch.state === 'running') {
      record.el.className = 'trace-step is-running';
      shared.setBadgeState(record.badgeEl, 'running', 'В работе');
    } else if (patch.state === 'done') {
      record.el.className = 'trace-step is-done';
      shared.setBadgeState(record.badgeEl, 'done', 'Готово');
      record.el.open = false;
    } else if (patch.state === 'error') {
      record.el.className = 'trace-step is-error';
      shared.setBadgeState(record.badgeEl, 'error', 'Ошибка');
      record.el.open = true;
    }

    if (patch.note !== undefined) {
      record.noteEl.textContent = patch.note || '';
      record.noteEl.classList.toggle('hidden', !patch.note);
    }

    if (patch.detail !== undefined) {
      record.detailEl.textContent = patch.detail || '';
      record.detailEl.classList.toggle('hidden', !patch.detail);
    }

    if (patch.facts !== undefined) {
      var items = Array.isArray(patch.facts) ? patch.facts.filter(Boolean) : [];
      record.factsEl.innerHTML = '';
      for (var index = 0; index < items.length; index++) {
        var fact = document.createElement('span');
        fact.className = 'trace-fact';
        fact.textContent = items[index];
        record.factsEl.appendChild(fact);
      }
      record.factsEl.classList.toggle('hidden', items.length === 0);
    }

    if (patch.structured !== undefined) {
      var sections = Array.isArray(patch.structured) ? patch.structured : [];
      record.structuredEl.innerHTML = '';
      for (var sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        var section = sections[sectionIndex];
        if (!section || !Array.isArray(section.items) || section.items.length === 0) continue;

        var sectionEl = document.createElement('div');
        sectionEl.className = 'trace-structured-section';

        if (section.title) {
          var sectionTitle = document.createElement('div');
          sectionTitle.className = 'trace-structured-title';
          sectionTitle.textContent = section.title;
          sectionEl.appendChild(sectionTitle);
        }

        var listEl = document.createElement('div');
        listEl.className = 'trace-structured-list';

        for (var itemIndex = 0; itemIndex < section.items.length; itemIndex++) {
          var item = section.items[itemIndex];
          if (!item) continue;

          var itemEl = document.createElement('div');
          itemEl.className = 'trace-structured-item';

          var itemTop = document.createElement('div');
          itemTop.className = 'trace-structured-item-title';
          itemTop.textContent = item.title || '';
          itemEl.appendChild(itemTop);

          if (item.subtitle) {
            var itemSubtitle = document.createElement('div');
            itemSubtitle.className = 'trace-structured-item-subtitle';
            itemSubtitle.textContent = item.subtitle;
            itemEl.appendChild(itemSubtitle);
          }

          if (item.meta) {
            var itemMeta = document.createElement('div');
            itemMeta.className = 'trace-structured-item-meta';
            itemMeta.textContent = item.meta;
            itemEl.appendChild(itemMeta);
          }

          listEl.appendChild(itemEl);
        }

        sectionEl.appendChild(listEl);
        record.structuredEl.appendChild(sectionEl);
      }
      record.structuredEl.classList.toggle('hidden', !record.structuredEl.childNodes.length);
    }

    if (patch.args !== undefined) {
      var hasArgs = patch.args && typeof patch.args === 'object' && Object.keys(patch.args).length > 0;
      var text = hasArgs ? JSON.stringify(patch.args, null, 2) : '';
      record.argsEl.textContent = text;
      record.argsEl.classList.toggle('hidden', !text);
    }

    if (patch.previewTitle !== undefined) {
      record.previewTitleEl.textContent = patch.previewTitle || '';
      record.previewTitleEl.classList.toggle('hidden', !patch.previewTitle);
    }

    if (patch.preview !== undefined) {
      record.previewEl.textContent = patch.preview || '';
      record.previewEl.classList.toggle('hidden', !patch.preview);
    }

    if (patch.nextStep !== undefined) {
      record.nextEl.textContent = patch.nextStep || '';
      record.nextEl.classList.toggle('hidden', !patch.nextStep);
      record.nextTitleEl.classList.toggle('hidden', !patch.nextStep);
    }
  }

  function ensureStepChild(record, childKey) {
    if (!record || !record.childrenEl) return null;
    var key = String(childKey || Object.keys(record.batchChildren || {}).length + 1);
    record.batchChildren = record.batchChildren || {};
    if (record.batchChildren[key]) return record.batchChildren[key];

    var el = document.createElement('div');
    el.className = 'trace-step-child is-running';
    el.dataset.childKey = key;

    var top = document.createElement('div');
    top.className = 'trace-step-child-top';

    var lead = document.createElement('div');
    lead.className = 'trace-step-child-lead';

    var title = document.createElement('div');
    title.className = 'trace-step-child-title';
    lead.appendChild(title);

    var subtitle = document.createElement('div');
    subtitle.className = 'trace-step-child-subtitle hidden';
    lead.appendChild(subtitle);

    var badge = document.createElement('span');
    shared.setBadgeState(badge, 'running', 'В работе');

    top.appendChild(lead);
    top.appendChild(badge);
    el.appendChild(top);

    var meta = document.createElement('div');
    meta.className = 'trace-step-child-meta hidden';
    el.appendChild(meta);

    var preview = document.createElement('pre');
    preview.className = 'trace-code trace-step-child-preview hidden';
    el.appendChild(preview);

    record.childrenEl.appendChild(el);
    record.childrenEl.classList.remove('hidden');

    var child = {
      key: key,
      el: el,
      titleEl: title,
      subtitleEl: subtitle,
      badgeEl: badge,
      metaEl: meta,
      previewEl: preview,
      countedTool: false,
    };
    record.batchChildren[key] = child;
    return child;
  }

  function updateStepChild(record, childRecord, patch) {
    if (!record || !childRecord || !patch) return;
    if (patch.title !== undefined) {
      childRecord.titleEl.textContent = patch.title || '';
    }
    if (patch.subtitle !== undefined) {
      childRecord.subtitleEl.textContent = patch.subtitle || '';
      childRecord.subtitleEl.classList.toggle('hidden', !patch.subtitle);
    }
    if (patch.meta !== undefined) {
      childRecord.metaEl.textContent = patch.meta || '';
      childRecord.metaEl.classList.toggle('hidden', !patch.meta);
    }
    if (patch.preview !== undefined) {
      childRecord.previewEl.textContent = patch.preview || '';
      childRecord.previewEl.classList.toggle('hidden', !patch.preview);
    }
    if (patch.state === 'running') {
      childRecord.el.className = 'trace-step-child is-running';
      shared.setBadgeState(childRecord.badgeEl, 'running', 'В работе');
    } else if (patch.state === 'done') {
      childRecord.el.className = 'trace-step-child is-done';
      shared.setBadgeState(childRecord.badgeEl, 'done', 'Готово');
    } else if (patch.state === 'error') {
      childRecord.el.className = 'trace-step-child is-error';
      shared.setBadgeState(childRecord.badgeEl, 'error', 'Ошибка');
    }
    record.childrenEl.classList.toggle('hidden', !record.childrenEl.childNodes.length);
  }

  function appendRunNote(state, run, text, tone, key) {
    if (!text) return;
    var shouldStick = shared.isNearBottom(state.messagesEl);
    var compact = shared.compactTraceText(text);
    var last = run.notesEl.lastElementChild;
    if (
      key &&
      last &&
      last.dataset &&
      last.dataset.noteKey === key
    ) {
      var count = Number(last.dataset.noteCount || '1') + 1;
      last.dataset.noteCount = String(count);
      last.textContent = compact + ' ×' + count;
      updateRunStats(run);
      shared.scrollToBottom(state.messagesEl, shouldStick);
      return;
    }

    var note = document.createElement('div');
    note.className = 'trace-note' + (tone ? ' is-' + tone : '');
    note.textContent = compact;
    if (key) {
      note.dataset.noteKey = key;
      note.dataset.noteCount = '1';
    }
    run.notesEl.appendChild(note);
    updateRunStats(run);
    shared.scrollToBottom(state.messagesEl, shouldStick);
  }

  function ensureAutoChip(run, tool) {
    var key = String(tool || 'auto');
    if (run.autoTools[key]) return run.autoTools[key];

    var chip = document.createElement('span');
    chip.className = 'trace-chip is-running';
    chip.textContent = key;
    run.autoEl.appendChild(chip);

    run.autoTools[key] = chip;
    updateRunStats(run);
    return chip;
  }

  function recordFileChange(run, msg) {
    if (!run || !msg) return;
    var key = String(msg.changeId || msg.filePath || '') || ('change-' + Object.keys(run.countedFileChanges || {}).length);
    run.countedFileChanges = run.countedFileChanges || {};
    if (run.countedFileChanges[key]) return;
    run.countedFileChanges[key] = true;

    var stats = msg.stats || {};
    run.lineStats = run.lineStats || { added: 0, removed: 0 };
    run.lineStats.added += Math.max(0, Number(stats.added || 0));
    run.lineStats.removed += Math.max(0, Number(stats.removed || 0));
    updateRunStats(run);
  }

  function updateChangeMetrics(run, metrics) {
    if (!run || !metrics) return;
    if (
      run.changeMetrics &&
      Math.max(0, Number(metrics.pendingFiles || 0)) === 0 &&
      Math.max(0, Number(metrics.pendingChanges || 0)) === 0
    ) {
      return;
    }
    run.changeMetrics = {
      pendingFiles: Math.max(0, Number(metrics.pendingFiles || 0)),
      pendingChanges: Math.max(0, Number(metrics.pendingChanges || 0)),
      agentLines: Math.max(0, Number(metrics.agentLines || 0)),
      agentModifiedByUserLines: Math.max(0, Number(metrics.agentModifiedByUserLines || 0)),
      agentRemovedLines: Math.max(0, Number(metrics.agentRemovedLines || 0)),
      agentDeletedByUserLines: Math.max(0, Number(metrics.agentDeletedByUserLines || 0)),
      userOnlyLines: Math.max(0, Number(metrics.userOnlyLines || 0)),
      userRemovedLines: Math.max(0, Number(metrics.userRemovedLines || 0)),
      unknownFiles: Math.max(0, Number(metrics.unknownFiles || 0))
    };
    if (!run.lineStats || (!run.lineStats.added && !run.lineStats.removed)) {
      run.lineStats = run.lineStats || { added: 0, removed: 0 };
      run.lineStats.removed = Math.max(run.lineStats.removed || 0, run.changeMetrics.agentRemovedLines || 0);
    }
    updateRunStats(run);
  }

  function updateModelUsage(run, context) {
    if (!run || !context) return;
    var model = context.model ? String(context.model) : '';
    if (run.modelUsage && Number(run.modelUsage.calls || 0) > 0) {
      if (model) run.model = model;
      updateRunStats(run);
      return;
    }
    var promptTokens = Math.max(0, Number(context.lastPromptTokens || 0));
    var completionTokens = Math.max(0, Number(context.lastCompletionTokens || 0));
    var totalTokens = Math.max(0, Number(context.lastTotalTokens || 0));
    var estimatedInputTokens = Math.max(0, Number(context.estimatedInputTokens || 0));
    if (model) run.model = model;
    run.modelUsage = {
      model: model || run.model || '',
      promptTokens: promptTokens,
      completionTokens: completionTokens,
      totalTokens: totalTokens,
      estimatedInputTokens: estimatedInputTokens
    };
    updateRunStats(run);
  }

  function recordModelUsage(run, usage) {
    if (!run || !usage) return;
    var model = usage.model ? String(usage.model) : '';
    var promptTokens = Math.max(0, Number(
      usage.promptTokens !== undefined ? usage.promptTokens : usage.lastPromptTokens || 0
    ));
    var completionTokens = Math.max(0, Number(
      usage.completionTokens !== undefined ? usage.completionTokens : usage.lastCompletionTokens || 0
    ));
    var totalTokens = Math.max(0, Number(
      usage.totalTokens !== undefined ? usage.totalTokens : usage.lastTotalTokens || 0
    ));
    if (!totalTokens && (promptTokens || completionTokens)) {
      totalTokens = promptTokens + completionTokens;
    }
    if (model) run.model = model;
    run.modelUsage = run.modelUsage || {
      model: model || run.model || '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedInputTokens: 0,
      calls: 0
    };
    run.modelUsage.model = model || run.modelUsage.model || run.model || '';
    run.modelUsage.promptTokens = Math.max(0, Number(run.modelUsage.promptTokens || 0)) + promptTokens;
    run.modelUsage.completionTokens = Math.max(0, Number(run.modelUsage.completionTokens || 0)) + completionTokens;
    run.modelUsage.totalTokens = Math.max(0, Number(run.modelUsage.totalTokens || 0)) + totalTokens;
    run.modelUsage.calls = Math.max(0, Number(run.modelUsage.calls || 0)) + 1;
    updateRunStats(run);
  }

  function recordToolError(run, key) {
    if (!run) return;
    var errorKey = String(key || '') || ('error-' + (Number(run.errorCount || 0) + 1));
    run.countedToolErrors = run.countedToolErrors || {};
    if (run.countedToolErrors[errorKey]) return;
    run.countedToolErrors[errorKey] = true;
    run.errorCount = Math.max(0, Number(run.errorCount || 0)) + 1;
    updateRunStats(run);
  }

  window.ChatTraceRuns = {
    setRunCollapsed: setRunCollapsed,
    updateRunStats: updateRunStats,
    updateRunSummary: updateRunSummary,
    getLastStepRecord: getLastStepRecord,
    createRun: createRun,
    ensureRun: ensureRun,
    finishRun: finishRun,
    settleRunningSteps: settleRunningSteps,
    settleRunningSequences: settleRunningSequences,
    ensureSequenceCard: ensureSequenceCard,
    updateSequenceCard: updateSequenceCard,
    ensureStep: ensureStep,
    updateStep: updateStep,
    ensureStepChild: ensureStepChild,
    updateStepChild: updateStepChild,
    appendRunNote: appendRunNote,
    ensureAutoChip: ensureAutoChip,
    recordFileChange: recordFileChange,
    updateChangeMetrics: updateChangeMetrics,
    updateModelUsage: updateModelUsage,
    recordModelUsage: recordModelUsage,
    recordToolError: recordToolError,
  };
})();
