(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  const chatView = $('#chatView');
  const messagesEl = $('#messages');
  const inputEl = $('#input');
  const sendBtn = $('#sendBtn');
  const toastEl = $('#toast');
  const quickTagsEl = $('#quickTags');

  const bulkActionsEl = $('#bulkActions');
  const bulkLabelEl = $('#bulkLabel');
  const acceptAllBtn = $('#acceptAllBtn');
  const rejectAllBtn = $('#rejectAllBtn');

  const sApiBaseUrl = $('#s_apiBaseUrl');
  const sApiKey = $('#s_apiKey');
  const toggleKeyBtn = $('#toggleKeyBtn');
  const testConnBtn = $('#testConnBtn');
  const connStatus = $('#connStatus');
  const loadModelsBtn = $('#loadModelsBtn');
  const saveBtn = $('#saveBtn');
  const cancelBtn = $('#cancelBtn');

  let modelsList = [];
  let pickerValues = { chat: '', rerank: '', emb: '' };
  let openPicker = null;

  if (window.ChatMarkdown && window.ChatMarkdown.bindOverlayControls) {
    window.ChatMarkdown.bindOverlayControls();
  }

  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      const id = tab.dataset.tab;
      $$('.view').forEach(function (v) { v.classList.remove('active'); });
      $('#' + id + 'View').classList.add('active');
      if (id === 'settings') vscode.postMessage({ type: 'getSettings' });
    });
  });

  function countPendingChanges() {
    return document.querySelectorAll('.message.file-change:not(.fc-accepted):not(.fc-rejected):not(.fc-reverted)').length;
  }

  function updateBulkBar() {
    var n = countPendingChanges();
    if (n > 0) {
      bulkActionsEl.classList.add('visible');
      var word = 'изменений';
      if (n % 10 === 1 && n % 100 !== 11) word = 'изменение';
      else if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) word = 'изменения';
      bulkLabelEl.textContent = n + ' ' + word;
    } else {
      bulkActionsEl.classList.remove('visible');
    }
  }

  acceptAllBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'acceptAll' });
  });
  rejectAllBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'rejectAll' });
  });

  function appendMessage(text, role) {
    const el = document.createElement('div');
    el.className = 'message ' + role;
    if (role === 'assistant' && window.ChatMarkdown) {
      el.innerHTML = window.ChatMarkdown.renderMarkdown(text);
      window.ChatMarkdown.postRenderMessage(el);
    } else {
      el.textContent = text;
    }
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function getOrCreateStepBlock(step) {
    var existing = messagesEl.querySelector('.step-block[data-step="' + step + '"]');
    if (existing) return existing;

    var el = document.createElement('div');
    el.className = 'message step-block';
    el.dataset.step = String(step);

    var header = document.createElement('div');
    header.className = 'step-header';
    var num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = '\u0428\u0430\u0433 ' + step;
    header.appendChild(num);
    var status = document.createElement('span');
    status.className = 'step-status step-status-pending';
    status.textContent = '\u25CF';
    header.appendChild(status);
    el.appendChild(header);

    var body = document.createElement('div');
    body.className = 'step-body';
    el.appendChild(body);

    header.style.cursor = 'pointer';
    header.addEventListener('click', function () {
      body.classList.toggle('step-body-collapsed');
    });

    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function handleTraceEvent(msg) {
    var phase = msg.phase;
    var data = msg.data || {};
    var step = data.step;
    var text = msg.text || '';

    if (phase === 'agent-think' && step) {
      var block = getOrCreateStepBlock(step);
      var body = block.querySelector('.step-body');
      var old = body.querySelector('.step-think');
      if (old) old.remove();
      var think = document.createElement('div');
      think.className = 'step-think';
      think.textContent = text;
      body.insertBefore(think, body.firstChild);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    if (phase === 'agent-tool' && step) {
      var block = getOrCreateStepBlock(step);
      var body = block.querySelector('.step-body');
      var oldSpin = body.querySelector('.step-spinner');
      if (oldSpin) oldSpin.remove();

      var toolEl = document.createElement('div');
      toolEl.className = 'step-tool';
      var nameSpan = document.createElement('span');
      nameSpan.className = 'step-tool-name';
      nameSpan.textContent = '\uD83D\uDD27 ' + (data.tool || 'tool');
      toolEl.appendChild(nameSpan);
      if (data.reasoning) {
        var reason = document.createElement('span');
        reason.className = 'step-tool-reason';
        reason.textContent = ' \u2014 ' + data.reasoning;
        toolEl.appendChild(reason);
      }
      if (data.args && Object.keys(data.args).length > 0) {
        var argsEl = document.createElement('pre');
        argsEl.className = 'step-tool-args';
        argsEl.textContent = JSON.stringify(data.args);
        toolEl.appendChild(argsEl);
      }
      body.appendChild(toolEl);

      var spinner = document.createElement('div');
      spinner.className = 'step-spinner';
      spinner.textContent = '\u23F3 \u0412\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F\u2026';
      body.appendChild(spinner);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    if (phase === 'agent-result' && step) {
      var block = getOrCreateStepBlock(step);
      var body = block.querySelector('.step-body');
      var spinner = body.querySelector('.step-spinner');
      if (spinner) spinner.remove();

      var statusEl = block.querySelector('.step-status');
      if (statusEl) {
        statusEl.className = 'step-status step-status-done';
        statusEl.textContent = '\u2713';
      }

      var resultEl = document.createElement('div');
      resultEl.className = 'step-result';
      resultEl.textContent = '\u2713 [' + (data.tool || '') + '] \u2192 ' + (data.lines || '?') + ' \u0441\u0442\u0440\u043E\u043A';
      body.appendChild(resultEl);

      if (data.resultPreview) {
        var details = document.createElement('details');
        details.className = 'step-result-details';
        var summary = document.createElement('summary');
        summary.textContent = '\u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442';
        details.appendChild(summary);
        var pre = document.createElement('pre');
        pre.className = 'step-result-code';
        pre.textContent = data.resultPreview;
        details.appendChild(pre);
        body.appendChild(details);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    if (phase === 'agent-auto') {
      var toolName = data.tool || 'auto';
      var el = document.createElement('div');
      el.className = 'message step-block step-auto';
      el.dataset.autoTool = toolName;
      var row = document.createElement('div');
      row.className = 'step-auto-row';
      var label = document.createElement('span');
      label.className = 'step-auto-label';
      label.textContent = '\uD83D\uDCCB [\u0410\u0432\u0442\u043E] ' + toolName;
      row.appendChild(label);
      var spin = document.createElement('span');
      spin.className = 'step-auto-status';
      spin.textContent = ' \u23F3';
      row.appendChild(spin);
      el.appendChild(row);
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    if (phase === 'agent-auto-done') {
      var toolName = data.tool || 'auto';
      var el = messagesEl.querySelector('.step-auto[data-auto-tool="' + toolName + '"]');
      if (el) {
        var s = el.querySelector('.step-auto-status');
        if (s) { s.textContent = ' \u2713 \u2192 ' + (data.lines || '?') + ' \u0441\u0442\u0440\u043E\u043A'; s.classList.add('done'); }
      }
      return;
    }

    if (phase === 'agent-answer') {
      var existing = messagesEl.querySelector('.step-answer');
      if (existing) existing.remove();
      var el = document.createElement('div');
      el.className = 'message step-block step-answer';
      var row = document.createElement('div');
      row.className = 'step-auto-row';
      var label = document.createElement('span');
      label.className = 'step-auto-label';
      label.textContent = text;
      row.appendChild(label);
      var spin = document.createElement('span');
      spin.className = 'step-auto-status';
      spin.textContent = ' \u23F3';
      row.appendChild(spin);
      el.appendChild(row);
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return;
    }

    var lines = [text];
    if (data.step) lines.push('step: ' + data.step);
    if (data.error) lines.push('error: ' + String(data.error));
    appendMessage(lines.join('\n'), 'status');
  }

  var agentRunning = false;

  function setLoading(on) {
    agentRunning = on;
    inputEl.disabled = on;
    if (on) {
      sendBtn.textContent = '\u25A0 Stop';
      sendBtn.classList.add('btn-stop');
      sendBtn.classList.remove('btn-primary');
      sendBtn.disabled = false;
    } else {
      sendBtn.textContent = 'Send';
      sendBtn.classList.remove('btn-stop');
      sendBtn.classList.add('btn-primary');
      sendBtn.disabled = false;
    }
  }

  function sendText(raw) {
    const text = (raw || '').trim();
    if (!text || agentRunning) return;
    vscode.postMessage({ type: 'send', text });
    appendMessage(text, 'user');
    inputEl.value = '';
    setLoading(true);
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
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!agentRunning) sendText(inputEl.value);
    }
  });
  if (quickTagsEl) {
    quickTagsEl.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('.quick-tag') : null;
      if (!btn) return;
      sendText(btn.getAttribute('data-query') || '');
    });
  }

  var defaultTags = [
    { label: 'изучи проект подробно', query: 'изучи проект подробно' },
    { label: 'архитектурный обзор', query: 'сделай архитектурный обзор' },
    { label: 'риски и уязвимости', query: 'найди риски и уязвимости' },
    { label: 'связи фронт/бэк', query: 'объясни связи между фронтом и бэком' },
    { label: 'план рефакторинга', query: 'предложи план рефакторинга' }
  ];

  function renderTags(tags) {
    if (!quickTagsEl) return;
    quickTagsEl.innerHTML = '';
    tags.forEach(function (s) {
      var btn = document.createElement('button');
      btn.className = 'quick-tag';
      btn.setAttribute('data-query', s.query);
      btn.textContent = s.label;
      quickTagsEl.appendChild(btn);
    });
  }

  function updateQuickTags(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return;
    renderTags(suggestions);
  }

  renderTags(defaultTags);

  let toastTimer;
  function showToast(msg, ms = 2500) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms);
  }

  toggleKeyBtn.addEventListener('click', function () {
    const hidden = sApiKey.type === 'password';
    sApiKey.type = hidden ? 'text' : 'password';
    toggleKeyBtn.innerHTML = hidden ? '&#128274;' : '&#128065;';
  });

  testConnBtn.addEventListener('click', function () {
    vscode.postMessage({ type: 'testConnection', data: { apiBaseUrl: sApiBaseUrl.value.trim(), apiKey: sApiKey.value.trim() } });
    setConnStatus('loading', 'Проверяю...');
  });

  function setConnStatus(state, text) {
    connStatus.querySelector('.conn-dot').className = 'conn-dot ' + state;
    connStatus.querySelector('span:last-child').textContent = text;
  }

  loadModelsBtn.addEventListener('click', function () {
    loadModelsBtn.disabled = true;
    loadModelsBtn.textContent = '...';
    vscode.postMessage({ type: 'loadModels', data: { apiBaseUrl: sApiBaseUrl.value.trim(), apiKey: sApiKey.value.trim() } });
  });

  function createPicker(cid, key, placeholder) {
    const container = $('#' + cid);
    const isOptional = key !== 'chat';
    const trigger = document.createElement('button');
    trigger.className = 'model-picker-trigger placeholder';
    trigger.type = 'button';
    const triggerText = document.createElement('span');
    triggerText.textContent = placeholder;
    trigger.appendChild(triggerText);
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '\u25BC';
    trigger.appendChild(arrow);
    const dropdown = document.createElement('div');
    dropdown.className = 'model-dropdown';
    document.body.appendChild(dropdown);
    const searchInput = document.createElement('input');
    searchInput.className = 'model-dropdown-search';
    searchInput.placeholder = 'Search or type model name...';
    searchInput.spellcheck = false;
    dropdown.appendChild(searchInput);
    const listEl = document.createElement('div');
    listEl.className = 'model-dropdown-list';
    dropdown.appendChild(listEl);
    container.appendChild(trigger);

    function position() {
      const r = trigger.getBoundingClientRect();
      const vh = window.innerHeight;
      const maxH = 220;
      const below = vh - r.bottom - 4;
      const above = r.top - 4;
      dropdown.style.left = r.left + 'px';
      dropdown.style.width = r.width + 'px';
      if (below >= maxH || below >= above) {
        dropdown.style.top = r.bottom + 2 + 'px';
        dropdown.style.bottom = 'auto';
        dropdown.style.maxHeight = Math.min(maxH, below) + 'px';
      } else {
        dropdown.style.bottom = (vh - r.top + 2) + 'px';
        dropdown.style.top = 'auto';
        dropdown.style.maxHeight = Math.min(maxH, above) + 'px';
      }
    }

    function select(v) {
      pickerValues[key] = v;
      if (v) {
        triggerText.textContent = v;
        trigger.classList.remove('placeholder');
      } else {
        triggerText.textContent = isOptional ? '\u2014 \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u2014' : placeholder;
        trigger.classList.add('placeholder');
      }
      close();
    }

    function render(filter) {
      listEl.innerHTML = '';
      const q = (filter || '').toLowerCase();
      if (isOptional) {
        const none = document.createElement('div');
        none.className = 'model-option none-option' + (!pickerValues[key] ? ' selected' : '');
        none.textContent = '\u2014 \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u2014';
        none.addEventListener('mousedown', function (e) { e.preventDefault(); select(''); });
        listEl.appendChild(none);
      }
      let shown = 0;
      for (let i = 0; i < modelsList.length; i++) {
        const m = modelsList[i];
        if (q && !m.toLowerCase().includes(q)) continue;
        const opt = document.createElement('div');
        opt.className = 'model-option' + (pickerValues[key] === m ? ' selected' : '');
        opt.textContent = m;
        opt.addEventListener('mousedown', function (e) { e.preventDefault(); select(m); });
        listEl.appendChild(opt);
        shown++;
      }
      if (shown === 0 && q) {
        const custom = document.createElement('div');
        custom.className = 'model-option';
        custom.textContent = 'Use: ' + q;
        custom.addEventListener('mousedown', function (e) { e.preventDefault(); select(q); });
        listEl.appendChild(custom);
      } else if (shown === 0 && modelsList.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'model-dropdown-empty';
        empty.textContent = 'Press "Load list" or type name';
        listEl.appendChild(empty);
      }
    }

    function open() {
      if (openPicker && openPicker !== close) openPicker();
      position();
      dropdown.classList.add('open');
      searchInput.value = '';
      render('');
      setTimeout(function () { searchInput.focus(); }, 10);
      openPicker = close;
    }
    function close() {
      dropdown.classList.remove('open');
      if (openPicker === close) openPicker = null;
    }

    trigger.addEventListener('click', function (e) { e.stopPropagation(); dropdown.classList.contains('open') ? close() : open(); });
    searchInput.addEventListener('input', function () { render(searchInput.value); });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        const v = searchInput.value.trim();
        if (v) select(v);
      } else if (e.key === 'Escape') close();
    });
    dropdown.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    dropdown.addEventListener('click', function (e) { e.stopPropagation(); });
    return {
      setValue: function (v) { select(v); },
      refresh: function () { if (dropdown.classList.contains('open')) render(searchInput.value); },
      getDropdown: function () { return dropdown; }
    };
  }

  const pChat = createPicker('picker_chat', 'chat', 'Select chat model...');
  const pRerank = createPicker('picker_rerank', 'rerank', '\u2014 \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u2014');
  const pEmb = createPicker('picker_emb', 'emb', '\u2014 \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u2014');
  const allDd = [pChat, pRerank, pEmb].map(function (p) { return p.getDropdown(); });
  document.addEventListener('click', function () { if (openPicker) openPicker(); });
  window.addEventListener('scroll', function (e) {
    if (!openPicker) return;
    if (e.target && allDd.some(function (d) { return d.contains(e.target); })) return;
    openPicker();
  }, true);

  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    saveBtn.textContent = '...';
    vscode.postMessage({
      type: 'saveSettings',
      data: {
        apiBaseUrl: sApiBaseUrl.value.trim(),
        apiKey: sApiKey.value.trim(),
        model: pickerValues.chat,
        rerankModel: pickerValues.rerank,
        embeddingsModel: pickerValues.emb
      }
    });
  });

  cancelBtn.addEventListener('click', function () {
    $$('.tab').forEach(function (t) { t.classList.remove('active'); });
    $$('.tab')[0].classList.add('active');
    $$('.view').forEach(function (v) { v.classList.remove('active'); });
    chatView.classList.add('active');
  });

  function appendShellConfirm(msg) {
    var el = document.createElement('div');
    el.className = 'message step-block shell-confirm';
    el.dataset.confirmId = msg.confirmId;

    var header = document.createElement('div');
    header.className = 'sc-header';
    header.textContent = '\uD83D\uDD12 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 shell-\u043A\u043E\u043C\u0430\u043D\u0434\u0443';
    el.appendChild(header);

    var cmdRow = document.createElement('div');
    cmdRow.className = 'sc-cmd-row';
    var cmdPrefix = document.createElement('span');
    cmdPrefix.className = 'sc-cmd-prefix';
    cmdPrefix.textContent = '$';
    cmdRow.appendChild(cmdPrefix);
    var cmdInput = document.createElement('input');
    cmdInput.type = 'text';
    cmdInput.className = 'sc-cmd-input';
    cmdInput.value = msg.command;
    cmdInput.spellcheck = false;
    cmdRow.appendChild(cmdInput);
    el.appendChild(cmdRow);

    if (msg.cwd) {
      var cwdEl = document.createElement('div');
      cwdEl.className = 'sc-cwd';
      cwdEl.textContent = 'cwd: ' + msg.cwd;
      el.appendChild(cwdEl);
    }

    var actions = document.createElement('div');
    actions.className = 'sc-actions';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary btn-xs';
    approveBtn.textContent = '\u2713 \u0412\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C';
    approveBtn.addEventListener('click', function () {
      var finalCmd = cmdInput.value.trim();
      vscode.postMessage({ type: 'shellConfirmResult', confirmId: msg.confirmId, approved: true, command: finalCmd });
      cmdInput.readOnly = true;
      cmdInput.classList.add('sc-cmd-locked');
      actions.innerHTML = '<span class="sc-status sc-approved">\u2713 \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u043E</span>';
      el.classList.add('sc-resolved');
    });

    var denyBtn = document.createElement('button');
    denyBtn.className = 'btn btn-secondary btn-xs';
    denyBtn.textContent = '\u2717 \u041E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C';
    denyBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'shellConfirmResult', confirmId: msg.confirmId, approved: false, command: '' });
      cmdInput.readOnly = true;
      cmdInput.classList.add('sc-cmd-locked');
      actions.innerHTML = '<span class="sc-status sc-denied">\u2717 \u041E\u0442\u043A\u043B\u043E\u043D\u0435\u043D\u043E</span>';
      el.classList.add('sc-resolved');
    });

    cmdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); approveBtn.click(); }
    });

    actions.appendChild(approveBtn);
    actions.appendChild(denyBtn);
    el.appendChild(actions);

    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    cmdInput.focus();
    cmdInput.setSelectionRange(cmdInput.value.length, cmdInput.value.length);
  }

  function getChangeBadgeLabel(changeType) {
    var labels = {
      edit: 'EDIT', create: 'NEW', overwrite: 'OVERWRITE', delete: 'DELETE',
      'notebook-new-cell': 'NEW CELL', 'notebook-edit-cell': 'EDIT CELL'
    };
    return labels[changeType] || changeType;
  }

  function escapeHtmlText(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function appendFileChange(msg) {
    var el = document.createElement('div');
    el.className = 'message file-change';
    el.dataset.changeId = msg.changeId;
    el.dataset.filePath = msg.filePath || '';

    var header = document.createElement('div');
    header.className = 'fc-header';

    var badge = document.createElement('span');
    badge.className = 'fc-badge fc-badge-' + msg.changeType;
    badge.textContent = getChangeBadgeLabel(msg.changeType);
    header.appendChild(badge);

    var pathEl = document.createElement('span');
    pathEl.className = 'fc-path';
    pathEl.textContent = msg.filePath + (msg.cellIdx !== undefined ? ' [cell ' + msg.cellIdx + ']' : '');
    header.appendChild(pathEl);

    if (msg.tool) {
      var toolBadge = document.createElement('span');
      toolBadge.className = 'fc-tool';
      toolBadge.textContent = msg.tool;
      header.appendChild(toolBadge);
    }
    el.appendChild(header);

    if (msg.diffLines && msg.diffLines.length > 0) {
      var diff = document.createElement('div');
      diff.className = 'fc-diff fc-unified-diff';

      var table = document.createElement('table');
      table.className = 'diff-table';

      for (var di = 0; di < msg.diffLines.length; di++) {
        var dl = msg.diffLines[di];
        var tr = document.createElement('tr');
        tr.className = 'diff-row diff-row-' + dl.type;

        var tdOld = document.createElement('td');
        tdOld.className = 'diff-ln diff-ln-old';
        tdOld.textContent = dl.oldNo != null ? String(dl.oldNo) : '';

        var tdNew = document.createElement('td');
        tdNew.className = 'diff-ln diff-ln-new';
        tdNew.textContent = dl.newNo != null ? String(dl.newNo) : '';

        var tdSign = document.createElement('td');
        tdSign.className = 'diff-sign';
        if (dl.type === 'add') tdSign.textContent = '+';
        else if (dl.type === 'del') tdSign.textContent = '\u2212';
        else if (dl.type === 'sep') tdSign.textContent = '';
        else tdSign.textContent = ' ';

        var tdCode = document.createElement('td');
        tdCode.className = 'diff-code';
        if (dl.type === 'sep') {
          tdCode.classList.add('diff-sep-text');
          tdCode.textContent = dl.text;
        } else {
          tdCode.textContent = dl.text;
        }

        tr.appendChild(tdOld);
        tr.appendChild(tdNew);
        tr.appendChild(tdSign);
        tr.appendChild(tdCode);
        table.appendChild(tr);
      }

      diff.appendChild(table);
      el.appendChild(diff);
    } else if (msg.oldSnippet || msg.newSnippet) {
      var diff = document.createElement('div');
      diff.className = 'fc-diff';

      if (msg.oldSnippet) {
        var oldBlock = document.createElement('div');
        oldBlock.className = 'fc-diff-old';
        var oldLabel = document.createElement('div');
        oldLabel.className = 'fc-diff-label';
        oldLabel.textContent = '\u2212 Было';
        oldBlock.appendChild(oldLabel);
        var oldCode = document.createElement('pre');
        oldCode.className = 'fc-diff-code';
        oldCode.textContent = msg.oldSnippet;
        oldBlock.appendChild(oldCode);
        diff.appendChild(oldBlock);
      }

      if (msg.newSnippet) {
        var newBlock = document.createElement('div');
        newBlock.className = 'fc-diff-new';
        var newLabel = document.createElement('div');
        newLabel.className = 'fc-diff-label';
        newLabel.textContent = '+ Стало';
        newBlock.appendChild(newLabel);
        var newCode = document.createElement('pre');
        newCode.className = 'fc-diff-code';
        newCode.textContent = msg.newSnippet;
        newBlock.appendChild(newCode);
        diff.appendChild(newBlock);
      }

      el.appendChild(diff);
    }

    var actions = document.createElement('div');
    actions.className = 'fc-actions';

    var acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn btn-primary btn-xs fc-btn';
    acceptBtn.textContent = '\u2713 Принять';
    acceptBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'acceptChange', changeId: msg.changeId });
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-secondary btn-xs fc-btn';
    rejectBtn.textContent = '\u2717 Отклонить';
    rejectBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'rejectChange', changeId: msg.changeId });
    });

    var openBtn = document.createElement('button');
    openBtn.className = 'btn btn-secondary btn-xs fc-btn';
    openBtn.textContent = '\uD83D\uDCC4 Открыть';
    openBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'openChangedFile', filePath: msg.filePath });
    });

    var diffBtn = document.createElement('button');
    diffBtn.className = 'btn btn-secondary btn-xs fc-btn';
    diffBtn.textContent = '\u0394 Diff';
    diffBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'showDiff', changeId: msg.changeId });
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);
    actions.appendChild(openBtn);
    actions.appendChild(diffBtn);
    el.appendChild(actions);

    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    updateBulkBar();
  }

  function markChangeStatus(changeId, accepted) {
    var el = document.querySelector('[data-change-id="' + changeId + '"]');
    if (!el) return;
    el.classList.add(accepted ? 'fc-accepted' : 'fc-rejected');
    var actions = el.querySelector('.fc-actions');
    if (actions) {
      actions.innerHTML = accepted
        ? '<span class="fc-status fc-status-accepted">\u2713 Принято</span>'
        : '<span class="fc-status fc-status-rejected">\u2717 Отклонено (файл восстановлен)</span>';
    }
    updateBulkBar();
  }

  function appendCheckpoint(msg) {
    var el = document.createElement('div');
    el.className = 'message cp-marker';
    el.dataset.cpId = msg.id;

    var row = document.createElement('div');
    row.className = 'cp-row';

    var icon = document.createElement('span');
    icon.className = 'cp-icon';
    icon.textContent = '\uD83D\uDCCC';

    var label = document.createElement('span');
    label.className = 'cp-label';
    label.textContent = 'Checkpoint #' + msg.index;

    var info = document.createElement('span');
    info.className = 'cp-info';
    var d = new Date(msg.timestamp);
    var time = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') + ':' + d.getSeconds().toString().padStart(2, '0');
    info.textContent = time + (msg.fileCount > 0 ? ' \u00B7 ' + msg.fileCount + ' tracked files' : '');

    var revertBtn = document.createElement('button');
    revertBtn.className = 'btn btn-secondary btn-xs cp-revert-btn';
    revertBtn.textContent = '\u21A9 Откатить сюда';
    revertBtn.addEventListener('click', function () {
      revertBtn.disabled = true;
      revertBtn.textContent = '...';
      vscode.postMessage({ type: 'revertToCheckpoint', checkpointId: msg.id });
    });

    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(info);
    row.appendChild(revertBtn);
    el.appendChild(row);

    if (msg.userMessage) {
      var preview = document.createElement('div');
      preview.className = 'cp-preview';
      preview.textContent = msg.userMessage;
      el.appendChild(preview);
    }

    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function rebuildFcActions(el) {
    var changeId = el.dataset.changeId;
    var filePath = el.dataset.filePath;
    var actions = el.querySelector('.fc-actions');
    if (!actions) return;
    actions.innerHTML = '';

    var acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn btn-primary btn-xs fc-btn';
    acceptBtn.textContent = '\u2713 Принять';
    acceptBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'acceptChange', changeId: changeId });
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-secondary btn-xs fc-btn';
    rejectBtn.textContent = '\u2717 Отклонить';
    rejectBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'rejectChange', changeId: changeId });
    });

    var openBtn = document.createElement('button');
    openBtn.className = 'btn btn-secondary btn-xs fc-btn';
    openBtn.textContent = '\uD83D\uDCC4 Открыть';
    openBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'openChangedFile', filePath: filePath });
    });

    var diffBtn = document.createElement('button');
    diffBtn.className = 'btn btn-secondary btn-xs fc-btn';
    diffBtn.textContent = '\u0394 Diff';
    diffBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'showDiff', changeId: changeId });
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(rejectBtn);
    actions.appendChild(openBtn);
    actions.appendChild(diffBtn);
  }

  function markCheckpointReverted(msg) {
    var allCps = document.querySelectorAll('.cp-marker');
    allCps.forEach(function (cpEl) {
      cpEl.classList.remove('cp-active');
      var btn = cpEl.querySelector('.cp-revert-btn');
      if (btn) { btn.disabled = false; btn.textContent = '\u21A9 Откатить сюда'; }
      var undoBtn = cpEl.querySelector('.cp-undo-btn');
      if (undoBtn) undoBtn.remove();
    });

    var cpEl = document.querySelector('[data-cp-id="' + msg.checkpointId + '"]');
    if (!cpEl) return;
    cpEl.classList.add('cp-active');
    var revertBtn = cpEl.querySelector('.cp-revert-btn');
    if (revertBtn) revertBtn.style.display = 'none';

    var undoBtn = document.createElement('button');
    undoBtn.className = 'btn btn-secondary btn-xs cp-undo-btn';
    undoBtn.textContent = '\u21A9 Отменить откат';
    undoBtn.addEventListener('click', function () {
      undoBtn.disabled = true;
      undoBtn.textContent = '...';
      vscode.postMessage({ type: 'undoRevert' });
    });
    var row = cpEl.querySelector('.cp-row');
    if (row) row.appendChild(undoBtn);

    var sibling = cpEl.nextElementSibling;
    while (sibling) {
      sibling.classList.add('cp-hidden-by-revert');
      sibling = sibling.nextElementSibling;
    }

    updateBulkBar();
  }

  function handleUndoRevertDone(msg) {
    document.querySelectorAll('.cp-hidden-by-revert').forEach(function (el) {
      el.classList.remove('cp-hidden-by-revert');
    });

    var allCps = document.querySelectorAll('.cp-marker');
    allCps.forEach(function (cpEl) {
      cpEl.classList.remove('cp-active');
      var btn = cpEl.querySelector('.cp-revert-btn');
      if (btn) { btn.disabled = false; btn.textContent = '\u21A9 Откатить сюда'; btn.style.display = ''; }
      var undoBtn = cpEl.querySelector('.cp-undo-btn');
      if (undoBtn) undoBtn.remove();
    });

    var pendingSet = {};
    if (msg.restoredPendingIds && msg.restoredPendingIds.length) {
      for (var i = 0; i < msg.restoredPendingIds.length; i++) {
        pendingSet[msg.restoredPendingIds[i]] = true;
      }
    }

    var allCards = document.querySelectorAll('.message.file-change');
    allCards.forEach(function (card) {
      var cid = card.dataset.changeId;
      if (pendingSet[cid]) {
        card.classList.remove('fc-accepted', 'fc-rejected', 'fc-reverted');
        rebuildFcActions(card);
      }
    });

    updateBulkBar();
  }

  window.addEventListener('message', function (event) {
    const msg = event.data || {};
    if (msg.type === 'agentDone') {
      setLoading(false);
    } else if (msg.type === 'assistant') {
      var answerBlock = messagesEl.querySelector('.step-answer');
      if (answerBlock) answerBlock.remove();
      appendMessage(msg.text, 'assistant');
    } else if (msg.type === 'error') {
      var answerBlock2 = messagesEl.querySelector('.step-answer');
      if (answerBlock2) answerBlock2.remove();
      appendMessage(msg.text, 'error');
    } else if (msg.type === 'status') {
      appendMessage(msg.text, 'status');
    } else if (msg.type === 'traceReset') {
      appendMessage('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \u043D\u043E\u0432\u044B\u0439 \u0437\u0430\u043F\u0443\u0441\u043A \u0430\u043D\u0430\u043B\u0438\u0437\u0430 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', 'status');
    } else if (msg.type === 'traceEvent') {
      handleTraceEvent(msg);
    } else if (msg.type === 'shellConfirm') {
      appendShellConfirm(msg);
    } else if (msg.type === 'fileChange') {
      appendFileChange(msg);
    } else if (msg.type === 'changeAccepted') {
      markChangeStatus(msg.changeId, true);
    } else if (msg.type === 'changeRejected') {
      markChangeStatus(msg.changeId, false);
    } else if (msg.type === 'checkpoint') {
      appendCheckpoint(msg);
    } else if (msg.type === 'checkpointReverted') {
      markCheckpointReverted(msg);
    } else if (msg.type === 'undoRevertDone') {
      handleUndoRevertDone(msg);
    } else if (msg.type === 'updateSuggestions') {
      updateQuickTags(msg.suggestions);
    } else if (msg.type === 'settingsData') {
      const d = msg.data || {};
      sApiBaseUrl.value = d.apiBaseUrl || '';
      sApiKey.value = d.apiKey || '';
      modelsList = Array.isArray(d.models) ? d.models : [];
      pickerValues.chat = d.model || '';
      pickerValues.rerank = d.rerankModel || '';
      pickerValues.emb = d.embeddingsModel || '';
      pChat.setValue(d.model || '');
      pRerank.setValue(d.rerankModel || '');
      pEmb.setValue(d.embeddingsModel || '');
    } else if (msg.type === 'modelsLoaded') {
      modelsList = Array.isArray(msg.models) ? msg.models : [];
      pChat.refresh();
      pRerank.refresh();
      pEmb.refresh();
      loadModelsBtn.disabled = false;
      loadModelsBtn.textContent = 'Load list';
      showToast('Loaded ' + modelsList.length + ' models');
    } else if (msg.type === 'connectionResult') {
      if (msg.ok) setConnStatus('ok', 'Connected — ' + (msg.modelsCount || 0) + ' models');
      else setConnStatus('err', msg.error || 'Connection error');
    } else if (msg.type === 'settingsSaved') {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      showToast('Settings saved');
    }
  });
})();
