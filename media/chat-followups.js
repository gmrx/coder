(function () {
  'use strict';

  var STARTER_ITEMS = [
    {
      label: 'Изучить проект',
      query: 'изучи проект подробно',
      hint: 'Быстро собрать карту проекта и ключевые модули.',
    },
    {
      label: 'Архитектурный обзор',
      query: 'сделай архитектурный обзор проекта',
      hint: 'Понять слои, связи и точки входа.',
    },
    {
      label: 'Найти риски',
      query: 'найди риски, узкие места и потенциальные баги',
      hint: 'Проверить слабые места до изменений.',
    },
    {
      label: 'План рефакторинга',
      query: 'предложи пошаговый план рефакторинга',
      hint: 'Разбить улучшения на понятные этапы.',
    },
  ];

  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter(function (item) {
        return item && typeof item.label === 'string' && typeof item.query === 'string';
      })
      .map(function (item) {
        var query = item.query.trim();
        return {
          label: item.label.trim().slice(0, 40),
          query: query.slice(0, 260),
          hint: typeof item.hint === 'string' && item.hint.trim()
            ? item.hint.trim().slice(0, 84)
            : query.slice(0, 84),
        };
      })
      .filter(function (item) {
        return item.label && item.query;
      });
  }

  function createSkeletonCard() {
    var card = document.createElement('div');
    card.className = 'followup-card is-skeleton';

    var title = document.createElement('span');
    title.className = 'followup-skeleton-line is-title';
    card.appendChild(title);

    var body = document.createElement('span');
    body.className = 'followup-skeleton-line';
    card.appendChild(body);

    return card;
  }

  function createFollowupController(options) {
    var panelEl = options.panelEl;
    var titleEl = options.titleEl;
    var metaEl = options.metaEl;
    var badgeEl = options.badgeEl;
    var listEl = options.listEl;
    var refreshBtn = options.refreshBtn;
    var onSelect = typeof options.onSelect === 'function' ? options.onSelect : function () {};
    var onRefresh = typeof options.onRefresh === 'function' ? options.onRefresh : function () {};

    if (!panelEl || !titleEl || !metaEl || !badgeEl || !listEl || !refreshBtn) {
      return {
        setBusy: function () {},
        markRequestStarted: function () {},
        setSuggestions: function () {},
        setState: function () {},
        restore: function () {},
      };
    }

    var state = {
      mode: 'starters',
      summary: 'Быстрые действия для старта работы с проектом.',
      items: [],
      busy: false,
      hasConversation: false,
      hidden: false,
    };

    function getDisplayItems() {
      var normalized = normalizeItems(state.items);
      if (normalized.length > 0) return normalized;
      return STARTER_ITEMS.slice();
    }

    function getMetaText() {
      if (state.mode === 'loading' || state.mode === 'waiting' || state.mode === 'error') {
        return state.summary || '';
      }
      return '';
    }

    function getTitleText() {
      if (!state.hasConversation && state.mode === 'starters') return 'Быстрый старт';
      return 'Следующие шаги';
    }

    function getBadgeText() {
      if (!state.hasConversation && state.mode === 'starters') return 'Старт';
      if (state.mode === 'loading' || state.mode === 'waiting') return 'Обновление';
      if (state.mode === 'error') return 'Резерв';
      return 'AI';
    }

    function render() {
      var items = getDisplayItems();
      var shouldShowSkeletons = state.mode === 'loading' && normalizeItems(state.items).length === 0;

      panelEl.className =
        'followups-panel is-' + state.mode +
        (state.busy ? ' is-busy' : '') +
        (state.hasConversation ? ' has-conversation' : ' is-starter-mode') +
        (state.hidden ? ' hidden' : '');

      titleEl.textContent = getTitleText();
      metaEl.textContent = getMetaText();
      badgeEl.textContent = getBadgeText();
      refreshBtn.classList.toggle('hidden', !state.hasConversation);
      refreshBtn.disabled = state.busy || state.mode === 'loading';

      listEl.innerHTML = '';

      if (shouldShowSkeletons) {
        for (var index = 0; index < 3; index++) {
          listEl.appendChild(createSkeletonCard());
        }
        return;
      }

      items.forEach(function (item) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'followup-card';
        button.disabled = state.busy;
        button.setAttribute('data-query', item.query);
        button.title = item.hint || item.query;

        var label = document.createElement('span');
        label.className = 'followup-card-title';
        label.textContent = item.label;

        var hint = document.createElement('span');
        hint.className = 'followup-card-hint';
        hint.textContent = item.hint;

        button.appendChild(label);
        button.appendChild(hint);
        listEl.appendChild(button);
      });
    }

    listEl.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('.followup-card') : null;
      if (!button || button.disabled) return;
      onSelect(button.getAttribute('data-query') || '');
    });

    refreshBtn.addEventListener('click', function () {
      if (refreshBtn.disabled) return;
      onRefresh();
    });

    render();

    return {
      setBusy: function (busy) {
        state.busy = !!busy;
        render();
      },
      markRequestStarted: function () {
        state.hasConversation = true;
        state.mode = normalizeItems(state.items).length > 0 ? 'waiting' : 'starters';
        state.summary = 'Выполняю запрос. После ответа предложу следующие шаги.';
        render();
      },
      setSuggestions: function (payload) {
        state.hasConversation = true;
        state.mode = payload && payload.state ? payload.state : 'ready';
        state.summary = payload && payload.summary
          ? payload.summary
          : 'Следующие действия по текущему диалогу.';
        state.items = normalizeItems(payload && payload.suggestions);
        render();
      },
        setState: function (payload) {
          if (payload && payload.state) {
            state.mode = payload.state;
        }
        if (payload && typeof payload.summary === 'string') {
          state.summary = payload.summary;
        }
        if (payload && typeof payload.hasConversation === 'boolean') {
          state.hasConversation = payload.hasConversation;
        }
        render();
      },
        restore: function (payload) {
          var messages = payload && Array.isArray(payload.messages) ? payload.messages : [];
        state.hasConversation = messages.some(function (message) {
          return message && (message.role === 'user' || message.role === 'assistant');
        });
        state.items = normalizeItems(payload && payload.suggestions);
        state.mode = payload && payload.suggestionsState
          ? payload.suggestionsState
          : (state.items.length > 0 ? 'ready' : 'starters');
          state.summary = payload && typeof payload.suggestionsSummary === 'string' && payload.suggestionsSummary
            ? payload.suggestionsSummary
            : (state.hasConversation
            ? 'Следующие действия по текущему диалогу.'
            : 'Быстрые действия для старта работы с проектом.');
          render();
        },
        setHidden: function (hidden) {
          state.hidden = !!hidden;
          render();
        },
      };
  }

  window.ChatFollowups = {
    createFollowupController: createFollowupController,
  };
})();
