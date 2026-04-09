(function () {
  'use strict';

  function scrollToBottom(messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function createCheckpointController(ctx) {
    var messagesEl = ctx.messagesEl;
    var vscode = ctx.vscode;
    var updateBulkBar = ctx.updateBulkBar;
    var clearResolvedCard = ctx.clearResolvedCard;
    var rebuildChangeActions = ctx.rebuildChangeActions;
    var setChangeCardResolvedState = ctx.setChangeCardResolvedState;
    var onEditCheckpointRequest = typeof ctx.onEditCheckpointRequest === 'function'
      ? ctx.onEditCheckpointRequest
      : function () {};
    var onRepeatCheckpointRequest = typeof ctx.onRepeatCheckpointRequest === 'function'
      ? ctx.onRepeatCheckpointRequest
      : function () {};

    function findCheckpointNode(checkpointId) {
      return document.querySelector('[data-cp-id="' + checkpointId + '"]');
    }

    function ensureUserMeta(messageEl) {
      if (!messageEl) return null;
      var meta = messageEl.querySelector('.message-user-meta');
      if (meta) return meta;
      meta = document.createElement('div');
      meta.className = 'message-user-meta';
      messageEl.appendChild(meta);
      return meta;
    }

    function findAvailableUserMessage(preferLatest, targetIndex) {
      var userMessages = Array.prototype.slice.call(document.querySelectorAll('.message.user'));
      if (typeof targetIndex === 'number' && targetIndex >= 0 && userMessages[targetIndex]) {
        return userMessages[targetIndex];
      }
      if (preferLatest) userMessages.reverse();

      for (var index = 0; index < userMessages.length; index++) {
        if (!userMessages[index].querySelector('.cp-inline')) {
          return userMessages[index];
        }
      }
      return null;
    }

    function formatCheckpointStatus(status) {
      return status === 'running'
        ? 'В работе'
        : status === 'failed'
          ? 'Ошибка'
          : status === 'stopped'
            ? 'Остановлен'
            : 'Готов';
    }

    function formatCheckpointInfo(msg) {
      var parts = ['до выполнения этого запроса'];
      if (typeof msg.changedFiles === 'number') {
        parts.push('файлов: ' + msg.changedFiles);
      }
      return parts.join(' · ');
    }

    function createRevertButton(checkpointId) {
      var revertBtn = document.createElement('button');
      revertBtn.className = 'btn btn-secondary btn-xs cp-revert-btn';
      revertBtn.textContent = 'Откатить';
      revertBtn.addEventListener('click', function () {
        revertBtn.disabled = true;
        revertBtn.textContent = '...';
        vscode.postMessage({ type: 'revertToCheckpoint', checkpointId: checkpointId });
      });
      return revertBtn;
    }

    function createUndoButton(checkpointId) {
      var undoBtn = document.createElement('button');
      undoBtn.className = 'btn btn-secondary btn-xs cp-undo-btn';
      undoBtn.textContent = 'Отменить откат';
      undoBtn.addEventListener('click', function () {
        undoBtn.disabled = true;
        undoBtn.textContent = '...';
        vscode.postMessage({ type: 'undoRevert', checkpointId: checkpointId });
      });
      return undoBtn;
    }

    function createEditRequestButton(userMessage) {
      var editBtn = document.createElement('button');
      editBtn.className = 'btn btn-secondary btn-xs cp-edit-request-btn';
      editBtn.textContent = 'Редактировать запрос';
      editBtn.addEventListener('click', function () {
        onEditCheckpointRequest(userMessage || '');
      });
      return editBtn;
    }

    function createRepeatRequestButton(userMessage) {
      var repeatBtn = document.createElement('button');
      repeatBtn.className = 'btn btn-primary btn-xs cp-repeat-request-btn';
      repeatBtn.textContent = 'Повторить запрос';
      repeatBtn.addEventListener('click', function () {
        onRepeatCheckpointRequest(userMessage || '');
      });
      return repeatBtn;
    }

    function updateCheckpointNode(el, msg) {
      if (!el) return;
      if (msg.status) {
        el.dataset.cpStatus = msg.status;
      } else if (!el.dataset.cpStatus) {
        el.dataset.cpStatus = 'completed';
      }

      var label = el.querySelector('.cp-label');
      if (label && typeof msg.index === 'number') {
        label.textContent = 'Checkpoint #' + msg.index;
      }

      var info = el.querySelector('.cp-info');
      if (info) {
        var infoMsg = {
          changedFiles: typeof msg.changedFiles === 'number'
            ? msg.changedFiles
            : Number(el.dataset.cpChangedFiles || '0'),
        };
        info.textContent = formatCheckpointInfo(infoMsg);
        el.dataset.cpChangedFiles = String(infoMsg.changedFiles);
      }

      var status = el.querySelector('.cp-state');
      if (status) {
        var checkpointStatus = msg.status || el.dataset.cpStatus || 'completed';
        status.className = 'cp-state is-' + checkpointStatus;
        status.textContent = formatCheckpointStatus(checkpointStatus);
      }

      var preview = el.querySelector('.cp-preview');
      if (preview && msg.userMessage) preview.textContent = msg.userMessage;
      if (typeof msg.userMessage === 'string') {
        el.dataset.cpUserMessage = msg.userMessage;
      } else if (typeof el.dataset.cpUserMessage !== 'string') {
        el.dataset.cpUserMessage = '';
      }

      var revertBtn = el.querySelector('.cp-revert-btn');
      if (revertBtn) {
        var isRunning = (msg.status || el.dataset.cpStatus) === 'running';
        revertBtn.disabled = isRunning;
        revertBtn.textContent = isRunning ? 'Идёт запуск' : 'Откатить';
      }
    }

    function buildCheckpointNode(msg, inline) {
      var el = document.createElement('div');
      el.className = inline ? 'cp-inline' : 'message cp-marker';
      el.dataset.cpId = msg.id;

      var card = document.createElement('div');
      card.className = 'cp-card';

      var main = document.createElement('div');
      main.className = 'cp-main';

      var label = document.createElement('span');
      label.className = 'cp-label';
      main.appendChild(label);

      var info = document.createElement('span');
      info.className = 'cp-info';
      main.appendChild(info);

      var state = document.createElement('span');
      state.className = 'cp-state';
      main.appendChild(state);

      var actions = document.createElement('div');
      actions.className = 'cp-actions';
      actions.appendChild(createRevertButton(msg.id));

      card.appendChild(main);
      card.appendChild(actions);
      el.appendChild(card);

      if (!inline && msg.userMessage) {
        var preview = document.createElement('div');
        preview.className = 'cp-preview';
        preview.textContent = msg.userMessage;
        el.appendChild(preview);
      }

      updateCheckpointNode(el, msg);
      return el;
    }

    function appendCheckpoint(msg, options) {
      var existing = findCheckpointNode(msg.id);
      if (existing) {
        updateCheckpointNode(existing, msg);
        return;
      }

      var preferLatest = !options || options.preferLatest !== false;
      var targetIndex = typeof msg.userMessageIndex === 'number' ? msg.userMessageIndex : null;
      var userMessageEl = findAvailableUserMessage(preferLatest, targetIndex);
      if (userMessageEl) {
        ensureUserMeta(userMessageEl).appendChild(buildCheckpointNode(msg, true));
        return;
      }

      messagesEl.appendChild(buildCheckpointNode(msg, false));
      scrollToBottom(messagesEl);
    }

    function syncCheckpointsList(checkpoints) {
      if (!Array.isArray(checkpoints)) return;
      checkpoints
        .slice()
        .sort(function (left, right) { return left.index - right.index; })
        .forEach(function (checkpoint) {
          appendCheckpoint(checkpoint, { preferLatest: false });
        });
    }

    function updateCheckpoint(msg) {
      var existing = findCheckpointNode(msg.id);
      if (!existing) {
        appendCheckpoint(msg);
        return;
      }
      updateCheckpointNode(existing, msg);
    }

    function snapshotVisibleChangeStates() {
      document.querySelectorAll('.message.file-change').forEach(function (card) {
        if (card.classList.contains('cp-hidden-by-revert')) return;
        card.dataset.cpPrevState =
          card.classList.contains('fc-accepted')
            ? 'accepted'
            : card.classList.contains('fc-rejected')
              ? 'rejected'
              : 'pending';
      });
    }

    function clearStoredChangeStates() {
      document.querySelectorAll('.message.file-change').forEach(function (card) {
        delete card.dataset.cpPrevState;
      });
    }

    function restorePendingCards(restoredPendingIds) {
      var pendingSet = {};
      if (Array.isArray(restoredPendingIds)) {
        for (var index = 0; index < restoredPendingIds.length; index++) {
          pendingSet[restoredPendingIds[index]] = true;
        }
      }

      document.querySelectorAll('.message.file-change').forEach(function (card) {
        var changeId = card.dataset.changeId;
        if (!pendingSet[changeId]) return;
        clearResolvedCard(card);
        rebuildChangeActions(card);
      });
    }

    function restoreStoredChangeStates(restoredPendingIds) {
      var pendingSet = {};
      if (Array.isArray(restoredPendingIds)) {
        for (var index = 0; index < restoredPendingIds.length; index++) {
          pendingSet[restoredPendingIds[index]] = true;
        }
      }

      document.querySelectorAll('.message.file-change').forEach(function (card) {
        var prevState = card.dataset.cpPrevState || '';
        delete card.dataset.cpPrevState;

        if (pendingSet[card.dataset.changeId]) {
          clearResolvedCard(card);
          rebuildChangeActions(card);
          return;
        }

        if (prevState === 'accepted') {
          setChangeCardResolvedState(card, true);
          return;
        }

        if (prevState === 'rejected') {
          setChangeCardResolvedState(card, false);
        }
      });
    }

    function resetCheckpointUi() {
      document.querySelectorAll('[data-cp-id]').forEach(function (cpEl) {
        cpEl.classList.remove('cp-active');
        var revertBtn = cpEl.querySelector('.cp-revert-btn');
        if (revertBtn) {
          revertBtn.disabled = cpEl.dataset.cpStatus === 'running';
          revertBtn.textContent = cpEl.dataset.cpStatus === 'running' ? 'Идёт запуск' : 'Откатить';
          revertBtn.style.display = '';
        }
        var undoBtn = cpEl.querySelector('.cp-undo-btn');
        if (undoBtn) undoBtn.remove();
        var editBtn = cpEl.querySelector('.cp-edit-request-btn');
        if (editBtn) editBtn.remove();
        var repeatBtn = cpEl.querySelector('.cp-repeat-request-btn');
        if (repeatBtn) repeatBtn.remove();
      });
    }

    function markCheckpointReverted(msg) {
      document.querySelectorAll('.cp-hidden-by-revert').forEach(function (el) {
        el.classList.remove('cp-hidden-by-revert');
      });
      resetCheckpointUi();
      snapshotVisibleChangeStates();
      restorePendingCards(msg.restoredPendingIds);

      var cpEl = findCheckpointNode(msg.checkpointId);
      if (!cpEl) return;
      cpEl.classList.add('cp-active');
      var revertBtn = cpEl.querySelector('.cp-revert-btn');
      if (revertBtn) revertBtn.style.display = 'none';

      var actions = cpEl.querySelector('.cp-actions');
      if (actions) {
        var userMessage = cpEl.dataset.cpUserMessage || '';
        actions.appendChild(createUndoButton(msg.checkpointId));
        if (userMessage) {
          actions.appendChild(createEditRequestButton(userMessage));
          actions.appendChild(createRepeatRequestButton(userMessage));
        }
      }

      var turnEl = cpEl.closest('.chat-turn');
      if (turnEl) {
        var turnFlow = turnEl.querySelector('.chat-turn-flow');
        if (turnFlow) {
          turnFlow.classList.add('cp-hidden-by-revert');
        }
        var turnSibling = turnEl.nextElementSibling;
        while (turnSibling) {
          turnSibling.classList.add('cp-hidden-by-revert');
          turnSibling = turnSibling.nextElementSibling;
        }
      } else {
        var anchor = cpEl.closest('.message.user') || cpEl;
        var sibling = anchor.nextElementSibling;
        while (sibling) {
          sibling.classList.add('cp-hidden-by-revert');
          sibling = sibling.nextElementSibling;
        }
      }

      updateBulkBar();
    }

    function handleUndoRevertDone(msg) {
      document.querySelectorAll('.cp-hidden-by-revert').forEach(function (el) {
        el.classList.remove('cp-hidden-by-revert');
      });

      resetCheckpointUi();
      restoreStoredChangeStates(msg.restoredPendingIds);
      updateBulkBar();
    }

    function handleCheckpointBranchCommitted(msg) {
      if (Array.isArray(msg.prunedCheckpointIds)) {
        for (var index = 0; index < msg.prunedCheckpointIds.length; index++) {
          var cpEl = findCheckpointNode(msg.prunedCheckpointIds[index]);
          if (cpEl && !cpEl.closest('.cp-hidden-by-revert')) {
            cpEl.remove();
          }
        }
      }

      document.querySelectorAll('.cp-hidden-by-revert').forEach(function (el) {
        el.remove();
      });

      resetCheckpointUi();
      clearStoredChangeStates();
      updateBulkBar();
    }

    return {
      appendCheckpoint: appendCheckpoint,
      syncCheckpointsList: syncCheckpointsList,
      updateCheckpoint: updateCheckpoint,
      markCheckpointReverted: markCheckpointReverted,
      handleUndoRevertDone: handleUndoRevertDone,
      handleCheckpointBranchCommitted: handleCheckpointBranchCommitted,
    };
  }

  window.ChatCheckpoints = {
    createCheckpointController: createCheckpointController,
  };
})();
