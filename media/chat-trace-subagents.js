(function () {
  'use strict';

  var shared = window.ChatTraceShared;
  var runs = window.ChatTraceRuns;

  function ensureStepSubagentHost(stepRecord) {
    if (!stepRecord) return null;
    if (stepRecord.subagentHost) return stepRecord.subagentHost;

    var section = shared.createSection('Подагенты', 'trace-step-subagents');
    var list = document.createElement('div');
    list.className = 'trace-subagent-list';
    section.contentEl.appendChild(list);

    var notes = document.createElement('div');
    notes.className = 'trace-note-list hidden';
    section.contentEl.appendChild(notes);

    section.el.classList.remove('hidden');
    stepRecord.childrenEl.classList.remove('hidden');
    stepRecord.childrenEl.appendChild(section.el);

    stepRecord.subagentHost = {
      sectionEl: section.el,
      metaEl: section.metaEl,
      listEl: list,
      notesEl: notes,
    };

    return stepRecord.subagentHost;
  }

  function getSubagentHost(run, stepKey) {
    if (!run || !stepKey) return null;
    return ensureStepSubagentHost(run.steps[stepKey]);
  }

  function updateSubagentHostStats(run, stepKey) {
    if (!run || !stepKey) return;
    var stepRecord = run.steps[stepKey];
    if (!stepRecord || !stepRecord.subagentHost) return;

    var ids = Object.keys(run.subagents);
    var total = 0;
    var done = 0;
    var errors = 0;
    for (var index = 0; index < ids.length; index++) {
      var record = run.subagents[ids[index]];
      if (record.parentStepKey !== stepKey) continue;
      total++;
      if (record.state === 'done') done++;
      if (record.state === 'error') errors++;
    }

    stepRecord.subagentHost.metaEl.textContent =
      total > 0
        ? done + '/' + total + ' готово' + (errors > 0 ? ' • ошибок: ' + errors : '')
        : '';
    stepRecord.subagentHost.notesEl.classList.toggle('hidden', stepRecord.subagentHost.notesEl.childNodes.length === 0);
  }

  function appendSubagentNote(state, run, text, tone, stepKey) {
    var host = getSubagentHost(run, stepKey || run.activeSubagentStepKey);
    if (!host || !text) {
      runs.appendRunNote(state, run, text, tone);
      return;
    }

    var shouldStick = shared.isNearBottom(state.messagesEl);
    var note = document.createElement('div');
    note.className = 'trace-note' + (tone ? ' is-' + tone : '');
    note.textContent = shared.compactTraceText(text);
    host.notesEl.appendChild(note);
    host.notesEl.classList.remove('hidden');
    updateSubagentHostStats(run, stepKey || run.activeSubagentStepKey);
    shared.scrollToBottom(state.messagesEl, shouldStick);
  }

  function ensureSubagent(run, id) {
    var key = String(id || 'subagent');
    var requestedParentStepKey = run.activeSubagentStepKey || '';
    if (run.subagents[key]) {
      var existing = run.subagents[key];
      if (!existing.parentStepKey && requestedParentStepKey) {
        placeSubagentRecord(run, existing, requestedParentStepKey);
      }
      return existing;
    }

    var details = document.createElement('details');
    details.className = 'trace-subagent is-queued';
    details.open = true;

    var summary = document.createElement('summary');
    summary.className = 'trace-subagent-summary';

    var main = document.createElement('span');
    main.className = 'trace-subagent-main';

    var title = document.createElement('span');
    title.className = 'trace-subagent-title';
    title.textContent = key;
    main.appendChild(title);

    var purpose = document.createElement('span');
    purpose.className = 'trace-subagent-purpose';
    purpose.textContent = 'Ожидает запуска.';
    main.appendChild(purpose);

    var badge = document.createElement('span');
    badge.className = 'trace-mini-badge is-queued';
    badge.textContent = 'В очереди';

    summary.appendChild(main);
    summary.appendChild(badge);
    details.appendChild(summary);

    var body = document.createElement('div');
    body.className = 'trace-subagent-body';

    var meta = document.createElement('div');
    meta.className = 'trace-subagent-meta hidden';
    body.appendChild(meta);

    var tool = document.createElement('div');
    tool.className = 'trace-subagent-tool hidden';
    body.appendChild(tool);

    var preview = document.createElement('pre');
    preview.className = 'trace-code trace-subagent-preview hidden';
    body.appendChild(preview);

    details.appendChild(body);

    var record = {
      id: key,
      el: details,
      titleEl: title,
      badgeEl: badge,
      purposeEl: purpose,
      metaEl: meta,
      toolEl: tool,
      previewEl: preview,
      state: 'queued',
      parentStepKey: '',
    };

    run.subagents[key] = record;
    placeSubagentRecord(run, record, requestedParentStepKey);
    runs.updateRunStats(run);
    return record;
  }

  function placeSubagentRecord(run, record, parentStepKey) {
    if (!run || !record) return;

    var nextParentStepKey = parentStepKey || '';
    var previousParentStepKey = record.parentStepKey || '';
    if (previousParentStepKey === nextParentStepKey && record.el.parentNode) return;

    if (previousParentStepKey) {
      updateSubagentHostStats(run, previousParentStepKey);
    }

    var container = run.subagentsEl;
    if (nextParentStepKey && run.steps[nextParentStepKey]) {
      var host = ensureStepSubagentHost(run.steps[nextParentStepKey]);
      container = host.listEl;
    }

    container.appendChild(record.el);
    record.parentStepKey = nextParentStepKey;

    if (nextParentStepKey) {
      updateSubagentHostStats(run, nextParentStepKey);
    }
    runs.updateRunStats(run);
  }

  function updateSubagent(record, patch) {
    if (!record || !patch) return;

    if (patch.label) {
      record.titleEl.textContent = patch.label;
    }

    if (patch.state) {
      record.state = patch.state;
      record.el.className = 'trace-subagent is-' + patch.state;
      record.badgeEl.className = 'trace-mini-badge is-' + patch.state;
      record.badgeEl.textContent =
        patch.state === 'done' ? 'Готово' :
        patch.state === 'error' ? 'Ошибка' :
        patch.state === 'running' ? 'В работе' : 'В очереди';
      record.el.open = patch.state !== 'done';
    }

    if (patch.purpose !== undefined) {
      record.purposeEl.textContent = shared.compactTraceText(patch.purpose) || 'Без описания.';
    }

    if (patch.meta !== undefined) {
      record.metaEl.textContent = patch.meta || '';
      record.metaEl.classList.toggle('hidden', !patch.meta);
    }

    if (patch.tool !== undefined) {
      record.toolEl.textContent = patch.tool || '';
      record.toolEl.classList.toggle('hidden', !patch.tool);
    }

    if (patch.preview !== undefined) {
      var previewText = patch.preview || '';
      if (record.state === 'done') {
        var verdict = shared.extractVerdict(previewText);
        if (verdict) {
          previewText = 'VERDICT: ' + verdict + '\n' + previewText;
        }
      }
      record.previewEl.textContent = previewText;
      record.previewEl.classList.toggle('hidden', !previewText);
    }
  }

  window.ChatTraceSubagents = {
    ensureStepSubagentHost: ensureStepSubagentHost,
    getSubagentHost: getSubagentHost,
    updateSubagentHostStats: updateSubagentHostStats,
    appendSubagentNote: appendSubagentNote,
    ensureSubagent: ensureSubagent,
    placeSubagentRecord: placeSubagentRecord,
    updateSubagent: updateSubagent,
  };
})();
