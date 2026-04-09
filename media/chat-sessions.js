(function () {
  'use strict';

  function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    var diff = Math.max(0, Date.now() - timestamp);
    if (diff < 60 * 1000) return 'только что';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / (60 * 1000)) + 'м назад';
    if (diff < 24 * 60 * 60 * 1000) return Math.floor(diff / (60 * 60 * 1000)) + 'ч назад';
    return Math.floor(diff / (24 * 60 * 60 * 1000)) + 'д назад';
  }

  function createSessionController(options) {
    var vscode = options.vscode;
    var titleEl = options.titleEl;
    var metaEl = options.metaEl;
    var listEl = options.listEl;
    var newBtn = options.newBtn;
    var quickNewBtn = options.quickNewBtn;
    var clearBtn = options.clearBtn;
    var activeId = '';
    var sessions = [];
    var busy = false;

    function render() {
      if (!titleEl || !metaEl || !listEl) return;
      listEl.innerHTML = '';

      var active = sessions.find(function (item) { return item.id === activeId; }) || sessions[0] || null;
      titleEl.textContent = active ? active.title : 'Новый чат';
      if (active) {
        var activeMeta = [(active.messageCount || 0) + ' сообщ.'];
        var updatedLabel = formatRelativeTime(active.updatedAt);
        if (updatedLabel) activeMeta.push(updatedLabel);
        metaEl.textContent = activeMeta.join(' • ');
      } else {
        metaEl.textContent = 'Нет сохранённых чатов';
      }

      if (sessions.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'chat-session-empty';
        empty.textContent = 'Чаты появятся здесь после первого запуска агента.';
        listEl.appendChild(empty);
      }

      sessions.forEach(function (session) {
        var item = document.createElement('div');
        item.className = 'chat-session-chip' + (session.id === activeId ? ' is-active' : '');
        item.title = session.preview || session.title;

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'chat-session-main';
        button.disabled = busy || session.id === activeId;

        var title = document.createElement('span');
        title.className = 'chat-session-chip-title';
        title.textContent = session.title || 'Новый чат';

        var meta = document.createElement('span');
        meta.className = 'chat-session-chip-meta';
        meta.textContent = (session.messageCount || 0) + ' сообщ. • ' + formatRelativeTime(session.updatedAt);

        button.appendChild(title);
        button.appendChild(meta);
        button.addEventListener('click', function () {
          if (busy || session.id === activeId) return;
          vscode.postMessage({ type: 'switchConversation', conversationId: session.id });
        });

        var deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'chat-session-delete';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Удалить чат';
        deleteBtn.disabled = busy;
        deleteBtn.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (busy) return;
          vscode.postMessage({ type: 'deleteConversation', conversationId: session.id });
        });

        item.appendChild(button);
        item.appendChild(deleteBtn);
        listEl.appendChild(item);
      });

      if (newBtn) newBtn.disabled = busy;
      if (quickNewBtn) quickNewBtn.disabled = busy;
      if (clearBtn) clearBtn.disabled = busy;
    }

    function handleCreateConversation() {
      if (busy) return;
      vscode.postMessage({ type: 'createConversation' });
    }

    if (newBtn) {
      newBtn.addEventListener('click', function () {
        handleCreateConversation();
      });
    }

    if (quickNewBtn) {
      quickNewBtn.addEventListener('click', function () {
        if (busy) return;
        handleCreateConversation();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (busy) return;
        vscode.postMessage({ type: 'clearConversation' });
      });
    }

    return {
      setBusy: function (value) {
        busy = !!value;
        render();
      },
      setSessions: function (message) {
        sessions = Array.isArray(message.sessions) ? message.sessions.slice() : [];
        activeId = message.activeId || '';
        render();
      },
    };
  }

  window.ChatSessions = {
    createSessionController: createSessionController,
  };
})();
