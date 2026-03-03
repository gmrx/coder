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
  const subagentsPanel = $('#subagentsPanel');
  const subagentsList = $('#subagentsList');
  const subagentsCount = $('#subagentsCount');

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
  const subagents = new Map();

  function appendMessage(text, role) {
    const el = document.createElement('div');
    el.className = 'message ' + role;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setLoading(on) {
    sendBtn.disabled = on;
    sendBtn.textContent = on ? '...' : 'Send';
  }

  function ensureSubagentCard(data) {
    const id = data.id || ('sa-ui-' + Date.now());
    if (subagents.has(id)) return subagents.get(id);

    const card = document.createElement('div');
    card.className = 'subagent-card';
    card.innerHTML =
      '<div class="subagent-top">' +
      '<span class="subagent-id"></span>' +
      '<span class="subagent-state running">running</span>' +
      '</div>' +
      '<div class="subagent-purpose"></div>' +
      '<div class="subagent-meta"></div>' +
      '<div class="subagent-actions"></div>';
    const idEl = card.querySelector('.subagent-id');
    const purposeEl = card.querySelector('.subagent-purpose');
    const metaEl = card.querySelector('.subagent-meta');
    const actionsEl = card.querySelector('.subagent-actions');
    idEl.textContent = id;
    purposeEl.textContent = data.purpose || 'Без описания';
    metaEl.textContent = [data.subagentType || '', data.readonly ? 'readonly' : 'rw'].filter(Boolean).join(' · ');

    subagentsList.prepend(card);
    subagents.set(id, { id, stateEl: card.querySelector('.subagent-state'), actionsEl });
    renderSubagentSummary();
    return subagents.get(id);
  }

  function appendSubagentAction(entry, text) {
    const row = document.createElement('div');
    row.className = 'subagent-action';
    row.textContent = text;
    entry.actionsEl.appendChild(row);
  }

  function setSubagentState(entry, stateText, cssState) {
    entry.stateEl.textContent = stateText;
    entry.stateEl.className = 'subagent-state ' + cssState;
  }

  function renderSubagentSummary() {
    subagentsCount.textContent = String(subagents.size);
    subagentsPanel.classList.toggle('has-items', subagents.size > 0);
    const empty = subagentsList.querySelector('.subagents-empty');
    if (empty) empty.style.display = subagents.size > 0 ? 'none' : 'block';
  }

  function resetSubagents() {
    subagents.clear();
    subagentsList.innerHTML = '<div class="subagents-empty">Подагенты ещё не запускались</div>';
    renderSubagentSummary();
  }

  function handleSubagentEvent(msg) {
    const phase = msg.phase || '';
    const data = msg.data || {};
    const entry = ensureSubagentCard(data);
    if (phase === 'subagent-start') {
      appendSubagentAction(entry, 'Старт');
    } else if (phase === 'subagent-step') {
      appendSubagentAction(entry, 'Шаг ' + (data.step || '?') + '/' + (data.maxSteps || '?'));
    } else if (phase === 'subagent-tool') {
      appendSubagentAction(entry, 'Инструмент: ' + (data.tool || 'unknown'));
    } else if (phase === 'subagent-result') {
      appendSubagentAction(entry, 'Результат: ' + (data.tool || 'tool'));
    } else if (phase === 'subagent-done') {
      setSubagentState(entry, 'done', 'done');
      appendSubagentAction(entry, 'Завершён');
    } else if (phase === 'subagent-error') {
      setSubagentState(entry, 'error', 'error');
      appendSubagentAction(entry, 'Ошибка: ' + (data.error || 'unknown'));
    }
  }

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const id = tab.dataset.tab;
      $$('.view').forEach((v) => v.classList.remove('active'));
      $('#' + id + 'View').classList.add('active');
      if (id === 'settings') vscode.postMessage({ type: 'getSettings' });
    });
  });

  sendBtn.addEventListener('click', () => {
    const t = inputEl.value.trim();
    if (!t) return;
    vscode.postMessage({ type: 'send', text: t });
    appendMessage(t, 'user');
    inputEl.value = '';
    setLoading(true);
    resetSubagents();
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  let toastTimer;
  function showToast(message, ms = 2500) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  toggleKeyBtn.addEventListener('click', () => {
    const hidden = sApiKey.type === 'password';
    sApiKey.type = hidden ? 'text' : 'password';
    toggleKeyBtn.textContent = hidden ? '\uD83D\uDD12' : '\uD83D\uDC41';
  });

  testConnBtn.addEventListener('click', () => {
    vscode.postMessage({
      type: 'testConnection',
      data: { apiBaseUrl: sApiBaseUrl.value.trim(), apiKey: sApiKey.value.trim() }
    });
    setConnStatus('loading', 'Проверяю...');
  });

  function setConnStatus(state, text) {
    connStatus.querySelector('.conn-dot').className = 'conn-dot ' + state;
    connStatus.querySelector('span:last-child').textContent = text;
  }

  loadModelsBtn.addEventListener('click', () => {
    loadModelsBtn.disabled = true;
    loadModelsBtn.textContent = '...';
    vscode.postMessage({
      type: 'loadModels',
      data: { apiBaseUrl: sApiBaseUrl.value.trim(), apiKey: sApiKey.value.trim() }
    });
  });

  function createPicker(containerId, key, placeholder) {
    const container = $('#' + containerId);
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
      const spaceBelow = vh - r.bottom - 4;
      const spaceAbove = r.top - 4;
      dropdown.style.left = r.left + 'px';
      dropdown.style.width = r.width + 'px';
      if (spaceBelow >= maxH || spaceBelow >= spaceAbove) {
        dropdown.style.top = r.bottom + 2 + 'px';
        dropdown.style.bottom = 'auto';
        dropdown.style.maxHeight = Math.min(maxH, spaceBelow) + 'px';
      } else {
        dropdown.style.bottom = vh - r.top + 2 + 'px';
        dropdown.style.top = 'auto';
        dropdown.style.maxHeight = Math.min(maxH, spaceAbove) + 'px';
      }
    }

    function render(filter) {
      listEl.innerHTML = '';
      const q = (filter || '').toLowerCase();
      if (isOptional) {
        const none = document.createElement('div');
        none.className = 'model-option none-option' + (!pickerValues[key] ? ' selected' : '');
        none.textContent = '\u2014 \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u2014';
        none.addEventListener('mousedown', (e) => { e.preventDefault(); select(''); });
        listEl.appendChild(none);
      }
      let shown = 0;
      for (const m of modelsList) {
        if (q && !m.toLowerCase().includes(q)) continue;
        const opt = document.createElement('div');
        opt.className = 'model-option' + (pickerValues[key] === m ? ' selected' : '');
        opt.textContent = m;
        opt.addEventListener('mousedown', (e) => { e.preventDefault(); select(m); });
        listEl.appendChild(opt);
        shown++;
      }
      if (shown === 0 && q) {
        const custom = document.createElement('div');
        custom.className = 'model-option';
        custom.textContent = 'Use: ' + q;
        custom.addEventListener('mousedown', (e) => { e.preventDefault(); select(q); });
        listEl.appendChild(custom);
      } else if (shown === 0 && modelsList.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'model-dropdown-empty';
        empty.textContent = 'Press "Load list" or type name';
        listEl.appendChild(empty);
      }
    }

    function select(value) {
      pickerValues[key] = value;
      if (value) {
        triggerText.textContent = value;
        trigger.classList.remove('placeholder');
      } else {
        triggerText.textContent = isOptional
          ? '\u2014 \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u2014'
          : placeholder;
        trigger.classList.add('placeholder');
      }
      close();
    }

    function open() {
      if (openPicker && openPicker !== close) openPicker();
      position();
      dropdown.classList.add('open');
      searchInput.value = '';
      render('');
      setTimeout(() => searchInput.focus(), 10);
      openPicker = close;
    }

    function close() {
      dropdown.classList.remove('open');
      if (openPicker === close) openPicker = null;
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.contains('open') ? close() : open();
    });

    searchInput.addEventListener('input', () => render(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = searchInput.value.trim();
        if (v) select(v);
      } else if (e.key === 'Escape') close();
    });

    dropdown.addEventListener('mousedown', (e) => e.stopPropagation());
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    return {
      setValue(v) { select(v); },
      refresh() { if (dropdown.classList.contains('open')) render(searchInput.value); },
      getDropdown() { return dropdown; }
    };
  }

  const pChat = createPicker('picker_chat', 'chat', 'Select chat model...');
  const pRerank = createPicker('picker_rerank', 'rerank', '\u2014 \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u2014');
  const pEmb = createPicker('picker_emb', 'emb', '\u2014 \u041D\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u2014');
  const allDropdowns = [pChat, pRerank, pEmb].map((p) => p.getDropdown());
  document.addEventListener('click', () => { if (openPicker) openPicker(); });
  window.addEventListener('scroll', (e) => {
    if (!openPicker) return;
    if (e.target && allDropdowns.some((d) => d.contains(e.target))) return;
    openPicker();
  }, true);

  saveBtn.addEventListener('click', () => {
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

  cancelBtn.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.tab')[0].classList.add('active');
    $$('.view').forEach((v) => v.classList.remove('active'));
    chatView.classList.add('active');
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'assistant') {
      appendMessage(msg.text, 'assistant');
      setLoading(false);
    } else if (msg.type === 'error') {
      appendMessage(msg.text, 'error');
      setLoading(false);
    } else if (msg.type === 'status') {
      appendMessage(msg.text, 'status');
    } else if (msg.type === 'subagentEvent') {
      handleSubagentEvent(msg);
    } else if (msg.type === 'subagentReset') {
      resetSubagents();
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
      showToast('Загружено ' + modelsList.length + ' моделей');
    } else if (msg.type === 'connectionResult') {
      if (msg.ok) setConnStatus('ok', 'Connected — ' + (msg.modelsCount || 0) + ' моделей');
      else setConnStatus('err', msg.error || 'Ошибка подключения');
    } else if (msg.type === 'settingsSaved') {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      showToast('Настройки сохранены');
    }
  });
})();
