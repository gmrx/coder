(function () {
  'use strict';

  function createSettingsController(options) {
    var vscode = options.vscode;
    var showToast = options.showToast || function () {};
    var onOpenTab = options.onOpenTab || function () {};
    var onCancel = options.onCancel || function () { onOpenTab('chat'); };
    var $ = function (selector) { return document.querySelector(selector); };

    var sApiBaseUrl = $('#s_apiBaseUrl');
    var sApiKey = $('#s_apiKey');
    var sSystemPrompt = $('#s_systemPrompt');
    var toggleKeyBtn = $('#toggleKeyBtn');
    var testConnBtn = $('#testConnBtn');
    var testModelsBtn = $('#testModelsBtn');
    var connStatus = $('#connStatus');
    var modelIssueCard = $('#modelIssueCard');
    var modelIssueText = $('#modelIssueText');
    var modelIssueMeta = $('#modelIssueMeta');
    var modelTestsEl = $('#modelTests');
    var modelTestsSummaryEl = $('#modelTestsSummary');
    var modelTestsListEl = $('#modelTestsList');
    var saveBtn = $('#saveBtn');
    var cancelBtn = $('#cancelBtn');
    var saveStatus = $('#saveStatus');

    var sJiraBaseUrl = $('#s_jiraBaseUrl');
    var sJiraUsername = $('#s_jiraUsername');
    var sJiraPassword = $('#s_jiraPassword');
    var toggleJiraPasswordBtn = $('#toggleJiraPasswordBtn');
    var jiraCheckBtn = $('#jiraCheckBtn');
    var jiraStatusCard = $('#jiraStatusCard');
    var jiraStatusDot = $('#jiraStatusDot');
    var jiraStatusText = $('#jiraStatusText');
    var jiraStatusMeta = $('#jiraStatusMeta');
    var jiraProjectList = $('#jiraProjectList');

    var sMcpConfigPath = $('#s_mcpConfigPath');
    var mcpServerList = $('#mcpServerList');
    var mcpStatusCard = $('#mcpStatusCard');
    var mcpStatusDot = $('#mcpStatusDot');
    var mcpStatusText = $('#mcpStatusText');
    var mcpAddStdioBtn = $('#mcpAddStdioBtn');
    var mcpAddHttpBtn = $('#mcpAddHttpBtn');
    var mcpInspectBtn = $('#mcpInspectBtn');
    var mcpClearBtn = $('#mcpClearBtn');
    var mcpInspectionStatusCard = $('#mcpInspectionStatusCard');
    var mcpInspectionStatusDot = $('#mcpInspectionStatusDot');
    var mcpInspectionStatusText = $('#mcpInspectionStatusText');
    var mcpInspectionList = $('#mcpInspectionList');
    var webTrustHeaderBadge = $('#webTrustHeaderBadge');
    var webTrustedHostList = $('#webTrustedHostList');
    var webBlockedHostList = $('#webBlockedHostList');
    var webTrustStatusCard = $('#webTrustStatusCard');
    var webTrustStatusDot = $('#webTrustStatusDot');
    var webTrustStatusText = $('#webTrustStatusText');
    var webTrustStatusMeta = $('#webTrustStatusMeta');
    var webAddTrustedHostBtn = $('#webAddTrustedHostBtn');
    var webAddBlockedHostBtn = $('#webAddBlockedHostBtn');
    var webUseDocsExamplesBtn = $('#webUseDocsExamplesBtn');
    var webClearHostRulesBtn = $('#webClearHostRulesBtn');

    var modelsList = [];
    var pickerValues = { chat: '', rerank: '', emb: '' };
    var openPicker = null;
    var mcpState = {
      nextId: 0,
      source: 'none',
      sourceLabel: '',
      configExists: false,
      loadError: '',
      servers: [],
      disabledTools: [],
      trustedTools: [],
      inspection: null,
      inspecting: false
    };
    var webTrustState = {
      nextId: 0,
      trustedHosts: [],
      blockedHosts: []
    };

    function nextMcpId(prefix) {
      mcpState.nextId += 1;
      return prefix + '-' + mcpState.nextId;
    }

    function buildMcpToolKey(serverName, toolName) {
      return String(serverName || '').trim() + '::' + String(toolName || '').trim();
    }

    function nextWebHostId(prefix) {
      webTrustState.nextId += 1;
      return prefix + '-' + webTrustState.nextId;
    }

    function isNonEmptyText(value) {
      return String(value || '').trim() !== '';
    }

    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function normalizeHostInput(value) {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
        .replace(/:\d+$/, '');
    }

    function createHostDraft(value) {
      return {
        id: nextWebHostId('host'),
        value: normalizeHostInput(value)
      };
    }

    function serializeHostDrafts(items) {
      var rows = Array.isArray(items) ? items : [];
      var seen = Object.create(null);
      var normalized = [];
      rows.forEach(function (item) {
        var host = normalizeHostInput(item && item.value);
        if (!host || seen[host]) return;
        seen[host] = true;
        normalized.push(host);
      });
      return normalized;
    }

    function setConnStatus(state, text) {
      connStatus.querySelector('.conn-dot').className = 'conn-dot ' + state;
      connStatus.querySelector('span:last-child').textContent = text;
    }

    function setModelTestsVisible(visible) {
      if (!modelTestsEl) return;
      modelTestsEl.classList.toggle('hidden', !visible);
    }

    function renderModelIssue(issue) {
      if (!modelIssueCard || !modelIssueText || !modelIssueMeta) return;
      var hasIssue = !!(issue && issue.message);
      modelIssueCard.classList.toggle('hidden', !hasIssue);
      if (!hasIssue) {
        modelIssueText.textContent = 'Текущая chat-модель недоступна.';
        modelIssueMeta.textContent = 'Выберите модель из списка и сохраните настройки.';
        return;
      }
      modelIssueText.textContent = issue.message || 'Текущая chat-модель недоступна.';
      modelIssueMeta.textContent = issue.detail || 'Выберите модель из списка и сохраните настройки.';
    }

    function buildCurrentChatModelIssue() {
      var currentModel = String(pickerValues.chat || '').trim();
      if (!currentModel || !Array.isArray(modelsList) || modelsList.length === 0) {
        return null;
      }
      if (modelsList.indexOf(currentModel) !== -1) {
        return null;
      }
      return {
        message: 'Модель "' + currentModel + '" не найдена в списке доступных моделей. Нужно выбрать chat-модель из списка.',
        detail: 'Список моделей успешно загружен, но текущей chat-модели там нет. Выберите модель в разделе «Модели» и сохраните настройки.'
      };
    }

    function setSaveStatus(text, tone) {
      if (!saveStatus) return;
      saveStatus.textContent = text || '';
      saveStatus.className = 'save-status' + (tone ? ' is-' + tone : '');
    }

    function buildBasePayload() {
      return {
        apiBaseUrl: sApiBaseUrl.value.trim(),
        apiKey: sApiKey.value.trim(),
        model: pickerValues.chat,
        rerankModel: pickerValues.rerank,
        embeddingsModel: pickerValues.emb,
        systemPrompt: sSystemPrompt ? String(sSystemPrompt.value || '').trim() : '',
        jiraBaseUrl: sJiraBaseUrl ? sJiraBaseUrl.value.trim() : '',
        jiraUsername: sJiraUsername ? sJiraUsername.value.trim() : '',
        jiraPassword: sJiraPassword ? sJiraPassword.value.trim() : ''
      };
    }

    function isToolDisabled(serverName, toolName) {
      var key = buildMcpToolKey(serverName, toolName);
      return mcpState.disabledTools.indexOf(key) !== -1;
    }

    function toggleMcpToolDisabled(serverName, toolName) {
      var key = buildMcpToolKey(serverName, toolName);
      var index = mcpState.disabledTools.indexOf(key);
      if (index >= 0) {
        mcpState.disabledTools.splice(index, 1);
        return true;
      }
      mcpState.disabledTools.push(key);
      return false;
    }

    function buildModelTestEntries(mode) {
      return [
        {
          kind: 'chat',
          label: 'Чат',
          model: pickerValues.chat || '',
          state: pickerValues.chat ? mode : 'skipped',
          request: 'Скажи привет.',
          response: pickerValues.chat
            ? mode === 'pending'
              ? 'Жду ответ чат-модели...'
              : 'Чат-модель выбрана, проверка ещё не запускалась.'
            : 'Чат-модель не выбрана.'
        },
        {
          kind: 'rerank',
          label: 'Rerank',
          model: pickerValues.rerank || '',
          state: pickerValues.rerank ? mode : 'skipped',
          request: 'Запрос + 2 тестовых документа',
          response: pickerValues.rerank
            ? mode === 'pending'
              ? 'Жду ответ rerank-модели...'
              : 'Rerank-модель выбрана, проверка ещё не запускалась.'
            : 'Rerank-модель не выбрана.'
        },
        {
          kind: 'embeddings',
          label: 'Эмбеддинги',
          model: pickerValues.emb || '',
          state: pickerValues.emb ? mode : 'skipped',
          request: 'Один короткий embeddings input',
          response: pickerValues.emb
            ? mode === 'pending'
              ? 'Жду ответ модели эмбеддингов...'
              : 'Модель эмбеддингов выбрана, проверка ещё не запускалась.'
            : 'Модель эмбеддингов не выбрана.'
        }
      ];
    }

    function renderModelTests(tests, summary) {
      if (!modelTestsEl || !modelTestsSummaryEl || !modelTestsListEl) return;

      var visibleTests = Array.isArray(tests)
        ? tests.filter(function (test) { return test && test.model; })
        : [];

      modelTestsSummaryEl.textContent = summary || 'Выберите модели и нажмите «Проверить».';
      modelTestsListEl.innerHTML = '';

      if (visibleTests.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'model-test-card is-idle';
        var emptyBody = document.createElement('div');
        emptyBody.className = 'model-test-body';
        emptyBody.textContent = 'После выбора моделей здесь появятся отдельные результаты для chat, embeddings и rerank.';
        empty.appendChild(emptyBody);
        modelTestsListEl.appendChild(empty);
        return;
      }

      visibleTests.forEach(function (test) {
        var card = document.createElement('div');
        var state = test.state || 'idle';
        card.className = 'model-test-card is-' + state;

        var header = document.createElement('div');
        header.className = 'model-test-header';

        var title = document.createElement('div');
        title.className = 'model-test-title';
        title.textContent = test.label || test.kind || 'Модель';

        var badge = document.createElement('span');
        badge.className = 'model-test-badge is-' + state;
        badge.textContent =
          state === 'passed' ? 'OK' :
          state === 'failed' ? 'Ошибка' :
          state === 'pending' ? 'Проверка' :
          state === 'skipped' ? 'Пропуск' : 'Готово';

        header.appendChild(title);
        header.appendChild(badge);

        var model = document.createElement('div');
        model.className = 'model-test-model';
        model.textContent = 'model: ' + (test.model || '—');

        var request = document.createElement('div');
        request.className = 'model-test-request';
        request.textContent = test.request || '';

        var response = document.createElement('pre');
        response.className = 'model-test-response';
        response.textContent = test.response || '';

        card.appendChild(header);
        card.appendChild(model);
        card.appendChild(request);
        card.appendChild(response);
        modelTestsListEl.appendChild(card);
      });
    }

    function createPicker(containerId, key, placeholder) {
      var container = $('#' + containerId);
      var isOptional = key !== 'chat';
      var trigger = document.createElement('button');
      trigger.className = 'model-picker-trigger placeholder';
      trigger.type = 'button';
      var triggerText = document.createElement('span');
      triggerText.textContent = placeholder;
      trigger.appendChild(triggerText);
      var arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '▼';
      trigger.appendChild(arrow);

      var dropdown = document.createElement('div');
      dropdown.className = 'model-dropdown';
      document.body.appendChild(dropdown);
      var searchInput = document.createElement('input');
      searchInput.className = 'model-dropdown-search';
      searchInput.placeholder = 'Найти или ввести имя модели...';
      searchInput.spellcheck = false;
      dropdown.appendChild(searchInput);
      var listEl = document.createElement('div');
      listEl.className = 'model-dropdown-list';
      dropdown.appendChild(listEl);
      container.appendChild(trigger);

      function select(value) {
        pickerValues[key] = value;
        if (value) {
          triggerText.textContent = value;
          trigger.classList.remove('placeholder');
        } else {
          triggerText.textContent = isOptional ? '— Не использовать —' : placeholder;
          trigger.classList.add('placeholder');
        }
        close();
      }

      function position() {
        var rect = trigger.getBoundingClientRect();
        var viewportHeight = window.innerHeight;
        var maxHeight = 220;
        var below = viewportHeight - rect.bottom - 4;
        var above = rect.top - 4;
        dropdown.style.left = rect.left + 'px';
        dropdown.style.width = rect.width + 'px';
        if (below >= maxHeight || below >= above) {
          dropdown.style.top = rect.bottom + 2 + 'px';
          dropdown.style.bottom = 'auto';
          dropdown.style.maxHeight = Math.min(maxHeight, below) + 'px';
        } else {
          dropdown.style.bottom = (viewportHeight - rect.top + 2) + 'px';
          dropdown.style.top = 'auto';
          dropdown.style.maxHeight = Math.min(maxHeight, above) + 'px';
        }
      }

      function render(filter) {
        var query = (filter || '').toLowerCase();
        listEl.innerHTML = '';

        if (isOptional) {
          var none = document.createElement('div');
          none.className = 'model-option none-option' + (!pickerValues[key] ? ' selected' : '');
          none.textContent = '— Не использовать —';
          none.addEventListener('mousedown', function (event) {
            event.preventDefault();
            select('');
          });
          listEl.appendChild(none);
        }

        var shown = 0;
        for (var index = 0; index < modelsList.length; index++) {
          var model = modelsList[index];
          if (query && model.toLowerCase().indexOf(query) === -1) continue;
          var option = document.createElement('div');
          option.className = 'model-option' + (pickerValues[key] === model ? ' selected' : '');
          option.textContent = model;
          option.addEventListener('mousedown', function (event) {
            event.preventDefault();
            select(this.textContent);
          });
          listEl.appendChild(option);
          shown++;
        }

        if (shown === 0 && query) {
          var custom = document.createElement('div');
          custom.className = 'model-option';
          custom.textContent = 'Использовать: ' + query;
          custom.addEventListener('mousedown', function (event) {
            event.preventDefault();
            select(query);
          });
          listEl.appendChild(custom);
        } else if (shown === 0 && modelsList.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'model-dropdown-empty';
          empty.textContent = 'Проверьте подключение или введите имя модели';
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

      trigger.addEventListener('click', function (event) {
        event.stopPropagation();
        if (dropdown.classList.contains('open')) close();
        else open();
      });
      searchInput.addEventListener('input', function () { render(searchInput.value); });
      searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          var value = searchInput.value.trim();
          if (value) select(value);
        } else if (event.key === 'Escape') {
          close();
        }
      });
      dropdown.addEventListener('mousedown', function (event) { event.stopPropagation(); });
      dropdown.addEventListener('click', function (event) { event.stopPropagation(); });

      return {
        setValue: function (value) { select(value); },
        refresh: function () { if (dropdown.classList.contains('open')) render(searchInput.value); },
        getDropdown: function () { return dropdown; },
        setWarning: function (message) {
          var hasWarning = !!message;
          trigger.classList.toggle('is-warning', hasWarning);
          if (hasWarning) {
            trigger.setAttribute('title', message);
          } else {
            trigger.removeAttribute('title');
          }
        }
      };
    }

    function createValueRow(value) {
      return {
        id: nextMcpId('row'),
        value: String(value || '')
      };
    }

    function createKeyValueRow(key, value) {
      return {
        id: nextMcpId('row'),
        key: String(key || ''),
        value: String(value || '')
      };
    }

    function objectToRows(record) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
      return Object.keys(record).map(function (key) {
        return createKeyValueRow(key, record[key]);
      });
    }

    function arrayToRows(items) {
      if (!Array.isArray(items)) return [];
      return items.map(function (value) {
        return createValueRow(value);
      });
    }

    function createServerDraft(name, raw) {
      var value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      var type = value.type === 'http' ? 'http' : 'stdio';
      var oauth = value.oauth && typeof value.oauth === 'object' && !Array.isArray(value.oauth) ? value.oauth : {};
      return {
        id: nextMcpId('server'),
        name: String(name || ''),
        type: type,
        command: String(value.command || ''),
        args: arrayToRows(value.args),
        env: objectToRows(value.env),
        cwd: String(value.cwd || ''),
        url: String(value.url || ''),
        headers: objectToRows(value.headers),
        oauthEnabled: !!(oauth && Object.keys(oauth).length > 0),
        oauthClientId: String(oauth.clientId || ''),
        oauthCallbackPort: String(oauth.callbackPort || ''),
        oauthAuthServerMetadataUrl: String(oauth.authServerMetadataUrl || ''),
        oauthAuthorizationEndpoint: String(oauth.authorizationEndpoint || ''),
        oauthTokenEndpoint: String(oauth.tokenEndpoint || ''),
        oauthRegistrationEndpoint: String(oauth.registrationEndpoint || ''),
        oauthResource: String(oauth.resource || ''),
        oauthScopes: arrayToRows(oauth.scopes)
      };
    }

    function setMcpServersFromConfig(record) {
      var entries = [];
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        entries = Object.keys(record).map(function (name) {
          return createServerDraft(name, record[name]);
        });
      }
      mcpState.servers = entries;
      renderMcpServerList();
    }

    function buildMcpExampleConfig() {
      return {
        'local-files': {
          type: 'stdio',
          command: 'node',
          args: ['./server.js'],
          cwd: '${workspaceFolder}',
          env: {
            NODE_ENV: 'production'
          }
        },
        'remote-api': {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: {
            Authorization: 'Bearer ${env:MY_MCP_TOKEN}'
          },
          oauth: {
            clientId: 'cursorcoder-vscode',
            authServerMetadataUrl: 'https://example.com/.well-known/oauth-authorization-server',
            scopes: ['read:issues', 'write:issues']
          }
        }
      };
    }

    function findServer(serverId) {
      for (var index = 0; index < mcpState.servers.length; index++) {
        if (mcpState.servers[index].id === serverId) return mcpState.servers[index];
      }
      return null;
    }

    function findCollectionRow(collection, rowId) {
      for (var index = 0; index < collection.length; index++) {
        if (collection[index].id === rowId) return collection[index];
      }
      return null;
    }

    function renderValueRows(server, collectionName, emptyText) {
      var rows = server[collectionName] || [];
      if (!rows.length) {
        return '<div class="mcp-empty-inline">' + escapeHtml(emptyText) + '</div>';
      }
      return rows.map(function (row) {
        return '' +
          '<div class="mcp-inline-row">' +
            '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-collection="' + escapeHtml(collectionName) + '" data-row-id="' + escapeHtml(row.id) + '" data-part="value" spellcheck="false" value="' + escapeHtml(row.value) + '" />' +
            '<button class="btn btn-secondary btn-xs" type="button" data-action="remove-row" data-server-id="' + escapeHtml(server.id) + '" data-collection="' + escapeHtml(collectionName) + '" data-row-id="' + escapeHtml(row.id) + '">Удалить</button>' +
          '</div>';
      }).join('');
    }

    function renderKeyValueRows(server, collectionName, emptyText, keyPlaceholder, valuePlaceholder) {
      var rows = server[collectionName] || [];
      if (!rows.length) {
        return '<div class="mcp-empty-inline">' + escapeHtml(emptyText) + '</div>';
      }
      return rows.map(function (row) {
        return '' +
          '<div class="mcp-inline-row is-pair">' +
            '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-collection="' + escapeHtml(collectionName) + '" data-row-id="' + escapeHtml(row.id) + '" data-part="key" spellcheck="false" placeholder="' + escapeHtml(keyPlaceholder) + '" value="' + escapeHtml(row.key) + '" />' +
            '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-collection="' + escapeHtml(collectionName) + '" data-row-id="' + escapeHtml(row.id) + '" data-part="value" spellcheck="false" placeholder="' + escapeHtml(valuePlaceholder) + '" value="' + escapeHtml(row.value) + '" />' +
            '<button class="btn btn-secondary btn-xs" type="button" data-action="remove-row" data-server-id="' + escapeHtml(server.id) + '" data-collection="' + escapeHtml(collectionName) + '" data-row-id="' + escapeHtml(row.id) + '">Удалить</button>' +
          '</div>';
      }).join('');
    }

    function renderMcpServerCard(server, index) {
      var cardTitle = String(server.name || '').trim() || ('Сервер #' + (index + 1));
      var transportOptions =
        '<option value="stdio"' + (server.type === 'stdio' ? ' selected' : '') + '>stdio</option>' +
        '<option value="http"' + (server.type === 'http' ? ' selected' : '') + '>http</option>';

      var content = '' +
        '<div class="mcp-server-card" data-server-id="' + escapeHtml(server.id) + '">' +
          '<div class="mcp-server-card-header">' +
            '<div class="mcp-server-title">' + escapeHtml(cardTitle) + '</div>' +
            '<button class="btn btn-secondary btn-xs" type="button" data-action="remove-server" data-server-id="' + escapeHtml(server.id) + '">Удалить</button>' +
          '</div>' +
          '<div class="mcp-server-grid mcp-server-grid-primary">' +
            '<div class="field">' +
              '<div class="field-label" title="Короткое уникальное имя, которым агент будет ссылаться на сервер.">Имя сервера</div>' +
              '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="name" spellcheck="false" placeholder="my-server" value="' + escapeHtml(server.name) + '" />' +
            '</div>' +
            '<div class="field">' +
              '<div class="field-label" title="Тип подключения к MCP серверу.">Transport</div>' +
              '<select class="field-input mcp-select" data-server-id="' + escapeHtml(server.id) + '" data-field="type">' + transportOptions + '</select>' +
            '</div>';

      if (server.type === 'stdio') {
        content += '' +
          '<div class="field">' +
            '<div class="field-label" title="Исполняемая команда, которая запускает MCP сервер.">Command</div>' +
            '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="command" spellcheck="false" placeholder="node" value="' + escapeHtml(server.command) + '" />' +
          '</div>';
      } else {
        content += '' +
          '<div class="field mcp-grid-span-2">' +
            '<div class="field-label" title="HTTP endpoint MCP сервера.">URL</div>' +
            '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="url" spellcheck="false" placeholder="https://example.com/mcp" value="' + escapeHtml(server.url) + '" />' +
          '</div>';
      }

      content += '</div>';

      content += '' +
        '<details class="mcp-server-details">' +
          '<summary>Дополнительно</summary>' +
          '<div class="mcp-server-details-body">' +
            (server.type === 'stdio'
              ? '' +
                '<div class="field">' +
                  '<div class="field-label" title="Рабочая директория процесса MCP сервера.">cwd <span class="badge badge-optional">необязательно</span></div>' +
                  '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="cwd" spellcheck="false" placeholder="${workspaceFolder}" value="' + escapeHtml(server.cwd) + '" />' +
                '</div>' +
                '<div class="mcp-subsection">' +
                  '<div class="mcp-subsection-header"><span title="Аргументы командной строки для запуска сервера.">Args</span><button class="btn btn-secondary btn-xs" type="button" data-action="add-row" data-server-id="' + escapeHtml(server.id) + '" data-collection="args" title="Добавить ещё один аргумент">+ аргумент</button></div>' +
                  renderValueRows(server, 'args', 'Нет аргументов.') +
                '</div>' +
                '<div class="mcp-subsection">' +
                  '<div class="mcp-subsection-header"><span title="Переменные окружения для процесса сервера.">Env</span><button class="btn btn-secondary btn-xs" type="button" data-action="add-row" data-server-id="' + escapeHtml(server.id) + '" data-collection="env" title="Добавить переменную окружения">+ переменная</button></div>' +
                  renderKeyValueRows(server, 'env', 'Нет env-переменных.', 'KEY', 'value') +
                '</div>'
              : '' +
                '<div class="mcp-subsection mcp-grid-span-2">' +
                  '<div class="mcp-subsection-header"><span title="HTTP headers, которые будут отправляться в каждый запрос к MCP серверу.">Headers</span><button class="btn btn-secondary btn-xs" type="button" data-action="add-row" data-server-id="' + escapeHtml(server.id) + '" data-collection="headers" title="Добавить HTTP header">+ header</button></div>' +
                  renderKeyValueRows(server, 'headers', 'Нет HTTP headers.', 'Header-Name', 'value') +
                '</div>' +
                '<div class="mcp-subsection mcp-grid-span-2">' +
                  '<div class="mcp-subsection-header">' +
                    '<span title="Browser-based OAuth для серверов, которым нужна авторизация.">OAuth</span>' +
                    '<label class="mcp-toggle-row" title="Включить OAuth-настройки для этого сервера."><input type="checkbox" data-server-id="' + escapeHtml(server.id) + '" data-field="oauthEnabled"' + (server.oauthEnabled ? ' checked' : '') + ' /> <span>Включить</span></label>' +
                  '</div>' +
                  (server.oauthEnabled
                    ? '' +
                      '<div class="mcp-server-grid">' +
                        '<div class="field">' +
                          '<div class="field-label" title="OAuth clientId. Если пусто, расширение попробует dynamic client registration, если сервер это поддерживает.">clientId <span class="badge badge-optional">необязательно</span></div>' +
                          '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="oauthClientId" spellcheck="false" placeholder="cursorcoder-vscode" value="' + escapeHtml(server.oauthClientId) + '" />' +
                        '</div>' +
                        '<div class="field">' +
                          '<div class="field-label" title="Локальный callback port. Если пусто, порт будет выбран автоматически.">callbackPort <span class="badge badge-optional">необязательно</span></div>' +
                          '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="oauthCallbackPort" spellcheck="false" placeholder="43110" value="' + escapeHtml(server.oauthCallbackPort) + '" />' +
                        '</div>' +
                        '<div class="field mcp-grid-span-2">' +
                          '<div class="field-label" title="Предпочтительный well-known metadata endpoint OAuth сервера.">authServerMetadataUrl <span class="badge badge-optional">необязательно</span></div>' +
                          '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="oauthAuthServerMetadataUrl" spellcheck="false" placeholder="https://example.com/.well-known/oauth-authorization-server" value="' + escapeHtml(server.oauthAuthServerMetadataUrl) + '" />' +
                        '</div>' +
                        '<div class="field mcp-grid-span-2">' +
                          '<div class="field-label" title="Fallback endpoint авторизации, если metadata endpoint недоступен.">authorizationEndpoint <span class="badge badge-optional">fallback</span></div>' +
                          '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="oauthAuthorizationEndpoint" spellcheck="false" placeholder="https://example.com/oauth/authorize" value="' + escapeHtml(server.oauthAuthorizationEndpoint) + '" />' +
                        '</div>' +
                        '<div class="field mcp-grid-span-2">' +
                          '<div class="field-label" title="Fallback endpoint получения токена.">tokenEndpoint <span class="badge badge-optional">fallback</span></div>' +
                          '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="oauthTokenEndpoint" spellcheck="false" placeholder="https://example.com/oauth/token" value="' + escapeHtml(server.oauthTokenEndpoint) + '" />' +
                        '</div>' +
                        '<div class="field mcp-grid-span-2">' +
                          '<div class="field-label" title="Fallback endpoint client registration.">registrationEndpoint <span class="badge badge-optional">fallback</span></div>' +
                          '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="oauthRegistrationEndpoint" spellcheck="false" placeholder="https://example.com/oauth/register" value="' + escapeHtml(server.oauthRegistrationEndpoint) + '" />' +
                        '</div>' +
                        '<div class="field mcp-grid-span-2">' +
                          '<div class="field-label" title="OAuth resource / audience, если сервер его требует.">resource <span class="badge badge-optional">необязательно</span></div>' +
                          '<input class="field-input" data-server-id="' + escapeHtml(server.id) + '" data-field="oauthResource" spellcheck="false" placeholder="api://example-resource" value="' + escapeHtml(server.oauthResource) + '" />' +
                        '</div>' +
                      '</div>' +
                      '<div class="mcp-subsection">' +
                        '<div class="mcp-subsection-header"><span title="OAuth scopes для доступа к серверу.">OAuth scopes</span><button class="btn btn-secondary btn-xs" type="button" data-action="add-row" data-server-id="' + escapeHtml(server.id) + '" data-collection="oauthScopes" title="Добавить scope">+ scope</button></div>' +
                        renderValueRows(server, 'oauthScopes', 'Нет scopes.') +
                      '</div>'
                    : '<div class="mcp-empty-inline">OAuth выключен.</div>') +
                '</div>') +
          '</div>' +
        '</details>' +
      '</div>';
      return content;
    }

    function renderMcpServerList() {
      if (!mcpServerList) return;
      if (!mcpState.servers.length) {
        mcpServerList.innerHTML =
          '<div class="mcp-empty-state">' +
            '<div class="mcp-empty-title">Пока нет MCP серверов</div>' +
            '<div class="mcp-empty-desc">Добавь <code>stdio</code> или <code>http</code> сервер.</div>' +
          '</div>';
        return;
      }
      mcpServerList.innerHTML = mcpState.servers.map(function (server, index) {
        return renderMcpServerCard(server, index);
      }).join('');
    }

    function collectRowsObject(serverName, label, rows) {
      var result = {};
      for (var index = 0; index < rows.length; index++) {
        var row = rows[index];
        var key = String(row.key || '').trim();
        var value = String(row.value || '').trim();
        if (!key && !value) continue;
        if (!key || !value) {
          return {
            ok: false,
            error: 'В секции ' + label + ' у сервера "' + serverName + '" заполните и ключ, и значение.'
          };
        }
        result[key] = value;
      }
      return { ok: true, value: result };
    }

    function collectRowsArray(rows) {
      var result = [];
      for (var index = 0; index < rows.length; index++) {
        var value = String(rows[index].value || '').trim();
        if (!value) continue;
        result.push(value);
      }
      return result;
    }

    function serializeMcpServers() {
      var result = {};
      var usedNames = {};

      for (var index = 0; index < mcpState.servers.length; index++) {
        var server = mcpState.servers[index];
        var name = String(server.name || '').trim();
        if (!name) {
          return { ok: false, error: 'У каждого MCP сервера должно быть имя.' };
        }
        if (usedNames[name]) {
          return { ok: false, error: 'Имена MCP серверов должны быть уникальными. Повтор: "' + name + '".' };
        }
        usedNames[name] = true;

        if (server.type === 'http') {
          var url = String(server.url || '').trim();
          if (!url) {
            return { ok: false, error: 'У HTTP сервера "' + name + '" обязательно поле URL.' };
          }
          var headers = collectRowsObject(name, 'Headers', server.headers || []);
          if (!headers.ok) return headers;
          var scopes = collectRowsArray(server.oauthScopes || []);

          result[name] = {
            type: 'http',
            url: url
          };
          if (Object.keys(headers.value).length > 0) {
            result[name].headers = headers.value;
          }
          if (server.oauthEnabled) {
            var oauth = {};
            if (isNonEmptyText(server.oauthClientId)) oauth.clientId = String(server.oauthClientId).trim();
            if (isNonEmptyText(server.oauthCallbackPort)) {
              var callbackPort = Number(String(server.oauthCallbackPort).trim());
              if (!Number.isInteger(callbackPort) || callbackPort <= 0) {
                return { ok: false, error: 'oauth.callbackPort у сервера "' + name + '" должен быть положительным числом.' };
              }
              oauth.callbackPort = callbackPort;
            }
            if (isNonEmptyText(server.oauthAuthServerMetadataUrl)) oauth.authServerMetadataUrl = String(server.oauthAuthServerMetadataUrl).trim();
            if (isNonEmptyText(server.oauthAuthorizationEndpoint)) oauth.authorizationEndpoint = String(server.oauthAuthorizationEndpoint).trim();
            if (isNonEmptyText(server.oauthTokenEndpoint)) oauth.tokenEndpoint = String(server.oauthTokenEndpoint).trim();
            if (isNonEmptyText(server.oauthRegistrationEndpoint)) oauth.registrationEndpoint = String(server.oauthRegistrationEndpoint).trim();
            if (isNonEmptyText(server.oauthResource)) oauth.resource = String(server.oauthResource).trim();
            if (scopes.length > 0) oauth.scopes = scopes;
            result[name].oauth = oauth;
          }
          continue;
        }

        var command = String(server.command || '').trim();
        if (!command) {
          return { ok: false, error: 'У stdio сервера "' + name + '" обязательно поле Command.' };
        }
        var args = collectRowsArray(server.args || []);
        var env = collectRowsObject(name, 'Env', server.env || []);
        if (!env.ok) return env;

        result[name] = {
          type: 'stdio',
          command: command
        };
        if (args.length > 0) {
          result[name].args = args;
        }
        if (Object.keys(env.value).length > 0) {
          result[name].env = env.value;
        }
        if (isNonEmptyText(server.cwd)) {
          result[name].cwd = String(server.cwd).trim();
        }
      }

      return {
        ok: true,
        value: result,
        count: Object.keys(result).length
      };
    }

    function renderMcpDraftState() {
      if (!mcpStatusDot || !mcpStatusText || !mcpStatusCard) return;

      var configPath = sMcpConfigPath ? sMcpConfigPath.value.trim() : '';
      var serialized = serializeMcpServers();
      var state = 'idle';
      var text = 'Можно оставить MCP пустым.';

      if (!serialized.ok) {
        state = 'err';
        text = 'MCP-конфиг пока некорректен.';
      } else {
        var effectivePath = configPath || (serialized.count > 0 ? '.mcp.json' : '');

        if (mcpState.loadError) {
          state = 'err';
          text = 'MCP-файл прочитан с ошибкой. Сохранение его перезапишет.';
        } else if (serialized.count > 0) {
          state = 'ok';
          text = mcpState.configExists
            ? 'Серверов: ' + serialized.count + '. Файл ' + (effectivePath || mcpState.sourceLabel || '.mcp.json') + ' будет обновлён.'
            : 'Серверов: ' + serialized.count + '. Будет создан файл ' + (effectivePath || '.mcp.json') + '.';
        } else if (isNonEmptyText(configPath)) {
          state = 'idle';
          text = 'Путь задан, серверов пока нет.';
        } else if (mcpState.source === 'workspace-file') {
          text = 'MCP загружен из файла.';
        }
      }

      mcpStatusDot.className = 'conn-dot ' + state;
      mcpStatusText.textContent = text;
      mcpStatusCard.className = 'settings-status-card is-compact is-' + state;
    }

    function findHostDraft(collection, rowId) {
      for (var index = 0; index < collection.length; index++) {
        if (collection[index].id === rowId) return collection[index];
      }
      return null;
    }

    function setWebHostsFromConfig(trustedHosts, blockedHosts) {
      webTrustState.trustedHosts = serializeHostDrafts((trustedHosts || []).map(function (host) {
        return { value: host };
      })).map(function (host) {
        return createHostDraft(host);
      });
      webTrustState.blockedHosts = serializeHostDrafts((blockedHosts || []).map(function (host) {
        return { value: host };
      })).map(function (host) {
        return createHostDraft(host);
      });
      renderWebHostLists();
      renderWebTrustState();
    }

    function renderWebHostRows(items, kind) {
      var rows = Array.isArray(items) ? items : [];
      if (!rows.length) {
        return '<div class="web-host-empty">' + escapeHtml(
          kind === 'trusted'
            ? 'Пока нет пользовательских trusted hosts. Для docs/code доменов всё равно действует встроенный allowlist.'
            : 'Пока нет blocked hosts. Внешние домены вне allowlist будут спрашивать подтверждение.'
        ) + '</div>';
      }
      return rows.map(function (row) {
        return '' +
          '<div class="web-host-row">' +
            '<input class="field-input" data-web-kind="' + escapeHtml(kind) + '" data-row-id="' + escapeHtml(row.id) + '" spellcheck="false" placeholder="example.com" value="' + escapeHtml(row.value) + '" />' +
            '<button class="btn btn-secondary btn-xs" type="button" data-action="remove-web-host" data-web-kind="' + escapeHtml(kind) + '" data-row-id="' + escapeHtml(row.id) + '">Удалить</button>' +
          '</div>';
      }).join('');
    }

    function renderWebHostLists() {
      if (webTrustedHostList) {
        webTrustedHostList.innerHTML = renderWebHostRows(webTrustState.trustedHosts, 'trusted');
      }
      if (webBlockedHostList) {
        webBlockedHostList.innerHTML = renderWebHostRows(webTrustState.blockedHosts, 'blocked');
      }
    }

    function renderWebTrustState() {
      if (!webTrustStatusCard || !webTrustStatusDot || !webTrustStatusText || !webTrustStatusMeta || !webTrustHeaderBadge) return;

      var trustedHosts = serializeHostDrafts(webTrustState.trustedHosts);
      var blockedHosts = serializeHostDrafts(webTrustState.blockedHosts);
      var overlap = trustedHosts.filter(function (host) { return blockedHosts.indexOf(host) !== -1; });
      var state = 'idle';
      var badge = 'Только встроенные';
      var text = 'Сейчас работают только встроенные доверенные documentation hosts.';
      var meta = 'Остальные домены будут спрашивать подтверждение. Блок-лист имеет приоритет над trusted hosts.';

      if (overlap.length > 0) {
        state = 'err';
        badge = 'Проверь списки';
        text = 'Один и тот же домен есть и в trusted, и в blocked.';
        meta = 'Совпадение: ' + overlap.join(', ') + '. Блок-лист имеет приоритет, но лучше убрать дубли.';
      } else if (trustedHosts.length > 0 || blockedHosts.length > 0) {
        state = 'ok';
        badge = 'Trusted ' + trustedHosts.length + ' • Blocked ' + blockedHosts.length;
        text = trustedHosts.length > 0
          ? 'Пользовательские trusted hosts добавлены: ' + trustedHosts.length + '.'
          : 'Пользовательские blocked hosts добавлены: ' + blockedHosts.length + '.';
        meta = 'Trusted: ' + (trustedHosts.length ? trustedHosts.join(', ') : 'нет')
          + ' • Blocked: ' + (blockedHosts.length ? blockedHosts.join(', ') : 'нет');
      }

      webTrustHeaderBadge.textContent = badge;
      webTrustStatusDot.className = 'conn-dot ' + state;
      webTrustStatusText.textContent = text;
      webTrustStatusMeta.textContent = meta;
      webTrustStatusCard.className = 'settings-status-card is-' + state;
    }

    function markWebTrustDirty(message, tone) {
      renderWebTrustState();
      setSaveStatus(message || 'Есть несохранённые web-fetch изменения.', tone || 'idle');
    }

    function setJiraStatus(state, text, meta) {
      if (!jiraStatusCard || !jiraStatusDot || !jiraStatusText || !jiraStatusMeta) return;
      jiraStatusDot.className = 'conn-dot ' + state;
      jiraStatusText.textContent = text || '';
      jiraStatusMeta.textContent = meta || '';
      jiraStatusCard.className = 'settings-status-card is-compact' + (state === 'ok' ? ' is-ok' : state === 'err' ? ' is-err' : '');
    }

    function renderJiraProjects(projects) {
      if (!jiraProjectList) return;
      var rows = Array.isArray(projects)
        ? projects.filter(function (project) {
            var tasks = Array.isArray(project.tasks) ? project.tasks : [];
            return tasks.length || (Number(project.taskCount) || 0) > 0;
          })
        : [];
      if (!rows.length) {
        jiraProjectList.innerHTML = '';
        return;
      }
      jiraProjectList.innerHTML = rows.map(function (project) {
        var title = String(project.key || '') + (project.name ? ' • ' + String(project.name) : '');
        var count = Number(project.taskCount) || 0;
        var tasks = Array.isArray(project.tasks) ? project.tasks : [];
        var taskRows = tasks.map(function (task) {
          var taskTitle = String(task.key || '') + (task.title ? ' • ' + String(task.title) : '');
          var description = String(task.description || '').trim();
          return '' +
            '<div class="jira-task-row" title="' + escapeHtml(task.url || '') + '">' +
              '<div class="jira-task-title">' + escapeHtml(taskTitle) + '</div>' +
              '<div class="jira-task-description' + (description ? '' : ' is-empty') + '">' +
                escapeHtml(description || 'Описание не заполнено.') +
              '</div>' +
              '<div class="jira-task-url">' + escapeHtml(task.url || '') + '</div>' +
            '</div>';
        }).join('');
        var taskList = taskRows
          ? '<div class="jira-task-list">' + taskRows + '</div>'
          : '<div class="jira-task-empty">Задачи в проекте не загружены.</div>';
        return '' +
          '<div class="jira-project-row" title="' + escapeHtml(project.url || '') + '">' +
            '<div class="jira-project-head">' +
              '<div>' +
                '<div class="jira-project-title">' + escapeHtml(title) + '</div>' +
                '<div class="jira-project-meta">' + escapeHtml(project.url || '') + '</div>' +
              '</div>' +
              '<div class="jira-project-count">' + escapeHtml(String(count)) + '</div>' +
            '</div>' +
            taskList +
          '</div>';
      }).join('');
    }

    function handleJiraCheckResult(msg) {
      if (jiraCheckBtn) {
        jiraCheckBtn.disabled = false;
        jiraCheckBtn.textContent = 'Проверить Jira';
      }
      if (!msg || !msg.ok) {
        setJiraStatus('err', 'Jira не прошла проверку', (msg && msg.error) || 'Ошибка подключения или авторизации.');
        renderJiraProjects([]);
        setSaveStatus('Jira не прошла проверку.', 'error');
        return;
      }
      setJiraStatus(
        'ok',
        'Авторизация Jira успешна: ' + (msg.authUser || 'пользователь определён'),
        'Проектов: ' + String(msg.projectsCount || 0) + ' • задач пользователя: ' + String(msg.totalTasks || 0) + (msg.warning ? ' • ' + msg.warning : '')
      );
      renderJiraProjects(msg.projects || []);
      setSaveStatus('Jira проверена.', 'ok');
    }

    function collectSettingsPayload(options) {
      var payload = buildBasePayload();
      payload.mcpDisabledTools = mcpState.disabledTools.slice();
      payload.mcpTrustedTools = mcpState.trustedTools.slice();
      payload.webTrustedHosts = serializeHostDrafts(webTrustState.trustedHosts);
      payload.webBlockedHosts = serializeHostDrafts(webTrustState.blockedHosts);
      if (options && options.includeMcp === false) {
        return { ok: true, payload: payload };
      }

      var serialized = serializeMcpServers();
      if (!serialized.ok) {
        return { ok: false, error: serialized.error };
      }

      payload.mcpConfigPath = sMcpConfigPath ? sMcpConfigPath.value.trim() : '';
      payload.mcpServers = serialized.value || {};
      return { ok: true, payload: payload };
    }

    function updateSettingsData(data) {
      var modelIssue = data.modelSelectionIssue || null;
      sApiBaseUrl.value = data.apiBaseUrl || '';
      sApiKey.value = data.apiKey || '';
      if (sSystemPrompt) sSystemPrompt.value = data.systemPrompt || '';
      if (sJiraBaseUrl) sJiraBaseUrl.value = data.jiraBaseUrl || '';
      if (sJiraUsername) sJiraUsername.value = data.jiraUsername || '';
      if (sJiraPassword) sJiraPassword.value = data.jiraPassword || '';
      if (sMcpConfigPath) sMcpConfigPath.value = data.mcpConfigPath || '';
      modelsList = Array.isArray(data.models) ? data.models : [];
      pickerValues.chat = data.model || '';
      pickerValues.rerank = data.rerankModel || '';
      pickerValues.emb = data.embeddingsModel || '';
      pChat.setValue(data.model || '');
      pRerank.setValue(data.rerankModel || '');
      pEmb.setValue(data.embeddingsModel || '');
      pChat.setWarning(modelIssue ? (modelIssue.message || 'Выберите chat-модель из списка.') : '');
      pRerank.setWarning('');
      pEmb.setWarning('');
      mcpState.source = data.mcpSource || 'none';
      mcpState.sourceLabel = data.mcpSourceLabel || '';
      mcpState.configExists = !!data.mcpConfigExists;
      mcpState.loadError = data.mcpLoadError || '';
      mcpState.disabledTools = Array.isArray(data.mcpDisabledTools) ? data.mcpDisabledTools.slice() : [];
      mcpState.trustedTools = Array.isArray(data.mcpTrustedTools) ? data.mcpTrustedTools.slice() : [];
      setMcpServersFromConfig(data.mcpServers || {});
      setWebHostsFromConfig(data.webTrustedHosts || [], data.webBlockedHosts || []);
      renderModelIssue(modelIssue);
      setModelTestsVisible(false);
      modelTestsListEl.innerHTML = '';
      modelTestsSummaryEl.textContent = 'Выберите модели и нажмите «Проверить».';
      renderMcpDraftState();
      renderMcpInspectionState();
      setSaveStatus(
        mcpState.loadError
          ? 'MCP-файл прочитан с ошибкой. Можно поправить поля и сохранить заново.'
          : 'Настройки загружены.',
        mcpState.loadError ? 'error' : 'idle'
      );
    }

    function handleConnectionResult(msg) {
      var statusText = msg.ok
        ? 'Подключено — моделей: ' + (msg.modelsCount || 0)
        : (msg.error || 'Ошибка подключения');
      if (msg.ok) {
        modelsList = Array.isArray(msg.models) ? msg.models : [];
        pChat.refresh();
        pRerank.refresh();
        pEmb.refresh();
        var issue = buildCurrentChatModelIssue();
        renderModelIssue(issue);
        pChat.setWarning(issue ? issue.message : '');
        setConnStatus('ok', statusText);
        setModelTestsVisible(false);
        if (!msg.silent) showToast('Загружено моделей: ' + modelsList.length);
        return;
      }
      setConnStatus('err', statusText);
      setModelTestsVisible(false);
    }

    function markMcpDirty(message, tone) {
      renderMcpDraftState();
      renderMcpInspectionState();
      setSaveStatus(message || 'Есть несохранённые MCP-изменения.', tone || 'idle');
    }

    function renderMcpInspectionState() {
      if (!mcpInspectionStatusDot || !mcpInspectionStatusText || !mcpInspectionStatusCard || !mcpInspectionList) {
        return;
      }

      var inspection = mcpState.inspection;
      var state = 'idle';
      var text = 'Нажми «Проверить MCP», чтобы проверить серверы и увидеть их tools.';

      if (mcpState.inspecting) {
        state = 'pending';
        text = 'Проверяю MCP серверы и загружаю их tools.';
      } else if (inspection) {
        state = inspection.ok ? 'ok' : 'err';
        text = inspection.summary || 'Проверка MCP завершена.';
      }

      mcpInspectionStatusDot.className = 'conn-dot ' + state;
      mcpInspectionStatusText.textContent = text;
      mcpInspectionStatusCard.className = 'settings-status-card is-compact is-' + state;

      if (!inspection || !inspection.servers || !inspection.servers.length) {
        mcpInspectionList.innerHTML = '<div class="mcp-empty-inline">После проверки здесь появятся серверы и все доступные MCP tools.</div>';
        return;
      }

      mcpInspectionList.innerHTML = inspection.servers.map(function (server) {
        var toolRows = (server.tools || []).map(function (tool) {
          var enabled = !isToolDisabled(server.name, tool.name);
          var toolHint = [
            tool.name ? 'tool: ' + tool.name : '',
            tool.description || '',
            tool.schemaSummary ? 'schema: ' + tool.schemaSummary : '',
            enabled ? 'Нажми, чтобы выключить эту утилиту.' : 'Нажми, чтобы включить эту утилиту.'
          ].filter(Boolean).join(' | ');
          return (
            '<button class="mcp-tool-row' + (enabled ? '' : ' is-disabled') + '" type="button" ' +
              'data-action="toggle-mcp-tool" data-server-name="' + escapeHtml(server.name) + '" data-tool-name="' + escapeHtml(tool.name) + '" title="' + escapeHtml(toolHint) + '">' +
              '<span class="mcp-tool-title">' + escapeHtml(tool.title || tool.name) + '</span>' +
              '<span class="mcp-tool-flag ' + (enabled ? 'is-enabled' : 'is-disabled') + '" aria-label="' + escapeHtml(enabled ? 'включено' : 'выключено') + '">' + (enabled ? '✓' : '×') + '</span>' +
            '</button>'
          );
        }).join('');

        return (
          '<section class="mcp-inspection-server is-' + escapeHtml(server.status || 'ok') + '" title="' + escapeHtml(server.sourceLabel || '') + '">' +
            '<div class="mcp-inspection-server-header">' +
              '<div>' +
                '<div class="mcp-inspection-server-title">' + escapeHtml(server.name) + '</div>' +
                '<div class="mcp-inspection-server-meta">' + escapeHtml(server.type) + '</div>' +
              '</div>' +
              '<div class="mcp-inspection-server-side">' +
                '<span class="settings-inline-badge ' + (server.status === 'ok' ? 'is-ok' : 'is-danger') + '">' + (server.status === 'ok' ? 'доступен' : 'ошибка') + '</span>' +
                '<span class="settings-inline-badge">' + escapeHtml(String(server.enabledToolCount) + '/' + String(server.toolCount) + ' tools') + '</span>' +
              '</div>' +
            '</div>' +
            (server.failure ? '<div class="mcp-inspection-server-error">' + escapeHtml(server.failure) + '</div>' : '') +
            '<div class="mcp-tool-list">' + (toolRows || '<div class="mcp-empty-inline">Server ответил, но tools не вернул.</div>') + '</div>' +
          '</section>'
        );
      }).join('');
    }

    function bindMcpListEvents() {
      if (!mcpServerList) return;

      mcpServerList.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.dataset) return;
        var action = target.dataset.action;
        var serverId = target.dataset.serverId;
        var collectionName = target.dataset.collection;
        var rowId = target.dataset.rowId;
        var server = findServer(serverId);

        if (action === 'remove-server' && server) {
          mcpState.servers = mcpState.servers.filter(function (item) { return item.id !== server.id; });
          renderMcpServerList();
          markMcpDirty('MCP сервер удалён.', 'idle');
          return;
        }

        if (action === 'add-row' && server && collectionName) {
          if (collectionName === 'args') {
            server.args.push(createValueRow(''));
          } else if (collectionName === 'env') {
            server.env.push(createKeyValueRow('', ''));
          } else if (collectionName === 'headers') {
            server.headers.push(createKeyValueRow('', ''));
          } else if (collectionName === 'oauthScopes') {
            server.oauthScopes.push(createValueRow(''));
          }
          renderMcpServerList();
          markMcpDirty('Добавлено новое поле в MCP сервере.', 'idle');
          return;
        }

        if (action === 'remove-row' && server && collectionName && rowId) {
          server[collectionName] = (server[collectionName] || []).filter(function (row) { return row.id !== rowId; });
          renderMcpServerList();
          markMcpDirty('Поле MCP сервера удалено.', 'idle');
        }
      });

      mcpServerList.addEventListener('input', function (event) {
        var target = event.target;
        if (!target || !target.dataset) return;
        var serverId = target.dataset.serverId;
        var server = findServer(serverId);
        if (!server) return;

        if (target.dataset.field) {
          server[target.dataset.field] = target.value;
          markMcpDirty('Есть несохранённые MCP-изменения.', 'idle');
          return;
        }

        if (target.dataset.collection && target.dataset.rowId) {
          var row = findCollectionRow(server[target.dataset.collection] || [], target.dataset.rowId);
          if (!row) return;
          row[target.dataset.part || 'value'] = target.value;
          markMcpDirty('Есть несохранённые MCP-изменения.', 'idle');
        }
      });

      mcpServerList.addEventListener('change', function (event) {
        var target = event.target;
        if (!target || !target.dataset) return;
        var serverId = target.dataset.serverId;
        var server = findServer(serverId);
        if (!server) return;

        if (target.dataset.field === 'type') {
          server.type = target.value === 'http' ? 'http' : 'stdio';
          renderMcpServerList();
          markMcpDirty('Тип MCP сервера обновлён.', 'idle');
          return;
        }

        if (target.dataset.field === 'oauthEnabled') {
          server.oauthEnabled = !!target.checked;
          renderMcpServerList();
          markMcpDirty('OAuth-настройка MCP сервера обновлена.', 'idle');
        }
      });

      if (mcpInspectionList) {
        mcpInspectionList.addEventListener('click', function (event) {
          var target = event.target;
          var row = target && target.closest ? target.closest('[data-action="toggle-mcp-tool"]') : null;
          if (!row || !row.dataset) return;
          var serverName = row.dataset.serverName;
          var toolName = row.dataset.toolName;
          if (!serverName || !toolName) return;
          var enabled = toggleMcpToolDisabled(serverName, toolName);
          renderMcpInspectionState();
          markMcpDirty(
            enabled
              ? 'MCP tool включён. Не забудь сохранить настройки.'
              : 'MCP tool выключен. Не забудь сохранить настройки.',
            'idle'
          );
        });
      }
    }

    function bindWebTrustEvents() {
      if (webTrustedHostList) {
        webTrustedHostList.addEventListener('click', function (event) {
          var target = event.target;
          if (!target || !target.dataset || target.dataset.action !== 'remove-web-host') return;
          var rowId = target.dataset.rowId;
          webTrustState.trustedHosts = webTrustState.trustedHosts.filter(function (row) {
            return row.id !== rowId;
          });
          renderWebHostLists();
          markWebTrustDirty('Trusted host удалён.', 'idle');
        });

        webTrustedHostList.addEventListener('input', function (event) {
          var target = event.target;
          if (!target || !target.dataset || target.dataset.webKind !== 'trusted') return;
          var row = findHostDraft(webTrustState.trustedHosts, target.dataset.rowId);
          if (!row) return;
          row.value = target.value;
          markWebTrustDirty('Есть несохранённые web-fetch изменения.', 'idle');
        });
      }

      if (webBlockedHostList) {
        webBlockedHostList.addEventListener('click', function (event) {
          var target = event.target;
          if (!target || !target.dataset || target.dataset.action !== 'remove-web-host') return;
          var rowId = target.dataset.rowId;
          webTrustState.blockedHosts = webTrustState.blockedHosts.filter(function (row) {
            return row.id !== rowId;
          });
          renderWebHostLists();
          markWebTrustDirty('Blocked host удалён.', 'idle');
        });

        webBlockedHostList.addEventListener('input', function (event) {
          var target = event.target;
          if (!target || !target.dataset || target.dataset.webKind !== 'blocked') return;
          var row = findHostDraft(webTrustState.blockedHosts, target.dataset.rowId);
          if (!row) return;
          row.value = target.value;
          markWebTrustDirty('Есть несохранённые web-fetch изменения.', 'idle');
        });
      }
    }

    var pChat = createPicker('picker_chat', 'chat', 'Выберите чат-модель...');
    var pRerank = createPicker('picker_rerank', 'rerank', '— Не использовать —');
    var pEmb = createPicker('picker_emb', 'emb', '— Не использовать —');
    var allDropdowns = [pChat, pRerank, pEmb].map(function (picker) { return picker.getDropdown(); });

    function bindEvents() {
      toggleKeyBtn.addEventListener('click', function () {
        var hidden = sApiKey.type === 'password';
        sApiKey.type = hidden ? 'text' : 'password';
        toggleKeyBtn.innerHTML = hidden ? '&#128274;' : '&#128065;';
      });

      if (toggleJiraPasswordBtn && sJiraPassword) {
        toggleJiraPasswordBtn.addEventListener('click', function () {
          var hidden = sJiraPassword.type === 'password';
          sJiraPassword.type = hidden ? 'text' : 'password';
          toggleJiraPasswordBtn.innerHTML = hidden ? '&#128274;' : '&#128065;';
        });
      }

      [sJiraBaseUrl, sJiraUsername, sJiraPassword].forEach(function (input) {
        if (!input) return;
        input.addEventListener('input', function () {
          setSaveStatus('Есть несохранённые Jira-настройки.', 'idle');
          setJiraStatus('idle', 'Jira ещё не проверялась.', 'Проверка покажет пользователя, количество проектов и задачи пользователя с названием и описанием.');
          renderJiraProjects([]);
        });
      });

      if (jiraCheckBtn) {
        jiraCheckBtn.addEventListener('click', function () {
          jiraCheckBtn.disabled = true;
          jiraCheckBtn.textContent = 'Проверяю...';
          setJiraStatus('loading', 'Проверяю авторизацию Jira...', 'Загружаю задачи пользователя, названия и описания.');
          renderJiraProjects([]);
          vscode.postMessage({ type: 'checkJira', data: buildBasePayload() });
        });
      }

      testConnBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'testConnection', data: buildBasePayload() });
        setConnStatus('loading', 'Проверяю подключение...');
      });

      testModelsBtn.addEventListener('click', function () {
        setModelTestsVisible(true);
        vscode.postMessage({ type: 'testModels', data: buildBasePayload() });
        renderModelTests(buildModelTestEntries('pending'), 'Проверяю выбранные модели отдельными запросами.');
      });

      saveBtn.addEventListener('click', function () {
        var collected = collectSettingsPayload();
        if (!collected.ok) {
          renderMcpDraftState();
          setSaveStatus(collected.error || 'Исправьте MCP-конфиг перед сохранением.', 'error');
          showToast('Исправьте MCP-конфиг перед сохранением');
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = '...';
        setSaveStatus('Сохраняю настройки и MCP-конфиг...', 'pending');
        vscode.postMessage({ type: 'saveSettings', data: collected.payload });
      });

      cancelBtn.addEventListener('click', function () {
        onCancel();
      });

      if (sMcpConfigPath) {
        sMcpConfigPath.addEventListener('input', function () {
          markMcpDirty('Есть несохранённые MCP-изменения.', 'idle');
        });
      }

      if (mcpAddStdioBtn) {
        mcpAddStdioBtn.addEventListener('click', function () {
          mcpState.servers.push(createServerDraft('', { type: 'stdio' }));
          renderMcpServerList();
          markMcpDirty('Добавлен новый stdio сервер.', 'idle');
        });
      }

      if (mcpAddHttpBtn) {
        mcpAddHttpBtn.addEventListener('click', function () {
          mcpState.servers.push(createServerDraft('', { type: 'http' }));
          renderMcpServerList();
          markMcpDirty('Добавлен новый http сервер.', 'idle');
        });
      }

      if (mcpClearBtn) {
        mcpClearBtn.addEventListener('click', function () {
          mcpState.servers = [];
          mcpState.inspection = null;
          renderMcpServerList();
          markMcpDirty('MCP серверы очищены.', 'idle');
        });
      }

      if (mcpInspectBtn) {
        mcpInspectBtn.addEventListener('click', function () {
          var collected = collectSettingsPayload();
          if (!collected.ok) {
            renderMcpDraftState();
            setSaveStatus(collected.error || 'Исправьте MCP-конфиг перед проверкой.', 'error');
            showToast('Исправьте MCP-конфиг перед проверкой');
            return;
          }
          mcpState.inspecting = true;
          renderMcpInspectionState();
          vscode.postMessage({ type: 'inspectMcp', data: collected.payload });
        });
      }

      bindMcpListEvents();
      bindWebTrustEvents();

      if (webAddTrustedHostBtn) {
        webAddTrustedHostBtn.addEventListener('click', function () {
          webTrustState.trustedHosts.push(createHostDraft(''));
          renderWebHostLists();
          markWebTrustDirty('Добавлен новый trusted host.', 'idle');
        });
      }

      if (webAddBlockedHostBtn) {
        webAddBlockedHostBtn.addEventListener('click', function () {
          webTrustState.blockedHosts.push(createHostDraft(''));
          renderWebHostLists();
          markWebTrustDirty('Добавлен новый blocked host.', 'idle');
        });
      }

      if (webUseDocsExamplesBtn) {
        webUseDocsExamplesBtn.addEventListener('click', function () {
          ['platform.openai.com', 'developer.mozilla.org', 'react.dev'].forEach(function (host) {
            var normalized = normalizeHostInput(host);
            if (!serializeHostDrafts(webTrustState.trustedHosts).includes(normalized)) {
              webTrustState.trustedHosts.push(createHostDraft(normalized));
            }
          });
          renderWebHostLists();
          markWebTrustDirty('Добавлены примеры trusted hosts.', 'ok');
        });
      }

      if (webClearHostRulesBtn) {
        webClearHostRulesBtn.addEventListener('click', function () {
          webTrustState.trustedHosts = [];
          webTrustState.blockedHosts = [];
          renderWebHostLists();
          markWebTrustDirty('Пользовательские web-fetch списки очищены.', 'idle');
        });
      }

      document.addEventListener('click', function () {
        if (openPicker) openPicker();
      });

      window.addEventListener('scroll', function (event) {
        if (!openPicker) return;
        if (event.target && allDropdowns.some(function (dropdown) { return dropdown.contains(event.target); })) return;
        openPicker();
      }, true);
    }

    renderModelTests([], 'Выберите модели и нажмите «Проверить».');
    renderMcpServerList();
    renderMcpDraftState();
    renderWebHostLists();
    renderWebTrustState();
    bindEvents();

    return {
      requestSettings: function () {
        vscode.postMessage({ type: 'getSettings' });
      },
      handleSettingsData: function (msg) {
        updateSettingsData((msg && msg.data) || {});
      },
      handleConnectionResult: handleConnectionResult,
      handleModelTestsResult: function (msg) {
        setModelTestsVisible(true);
        renderModelTests(msg.tests || [], msg.summary || 'Проверка моделей завершена.');
      },
      handleMcpInspectionResult: function (msg) {
        mcpState.inspecting = false;
        mcpState.inspection = {
          ok: !!msg.ok,
          summary: msg.summary || '',
          servers: Array.isArray(msg.servers) ? msg.servers : [],
          configErrors: Array.isArray(msg.configErrors) ? msg.configErrors : [],
          failures: Array.isArray(msg.failures) ? msg.failures : []
        };
        renderMcpInspectionState();
        setSaveStatus(msg.summary || 'Проверка MCP завершена.', msg.ok ? 'ok' : 'error');
      },
      handleJiraCheckResult: handleJiraCheckResult,
      handleSettingsSaved: function (msg) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Сохранить';
        if (msg && msg.mcpSavedPath) {
          if (sMcpConfigPath) sMcpConfigPath.value = msg.mcpSavedPath;
          mcpState.source = 'workspace-file';
          mcpState.sourceLabel = msg.mcpSavedPath;
          mcpState.configExists = true;
          mcpState.loadError = '';
          renderMcpDraftState();
          setSaveStatus(
            msg.mcpCreatedFile
              ? 'Настройки сохранены. MCP config создан: ' + msg.mcpSavedPath
              : 'Настройки сохранены. MCP config обновлён: ' + msg.mcpSavedPath,
            'ok'
          );
        } else {
          renderMcpDraftState();
          setSaveStatus('Настройки сохранены.', 'ok');
        }
        renderWebTrustState();
        showToast('Настройки сохранены');
      }
    };
  }

  window.ChatSettings = {
    createSettingsController: createSettingsController
  };
})();
