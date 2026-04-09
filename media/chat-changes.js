(function () {
  'use strict';

  function scrollToBottom(messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function findStepChildrenMount(messagesEl, step) {
    var stepKey = String(step || '').trim();
    if (!stepKey) return null;
    var allChildren = messagesEl.querySelectorAll('.trace-step[data-step-key="' + stepKey + '"] .trace-step-children');
    if (!allChildren || !allChildren.length) return null;
    var mount = allChildren[allChildren.length - 1];
    mount.classList.remove('hidden');
    var stepEl = mount.closest('.trace-step');
    if (stepEl && typeof stepEl.open === 'boolean') {
      stepEl.open = true;
    }
    return mount;
  }

  function getChangeBadgeLabel(changeType) {
    var labels = {
      edit: 'ПРАВКА',
      create: 'НОВЫЙ',
      overwrite: 'ПЕРЕЗАПИСЬ',
      delete: 'УДАЛЕНИЕ',
      'notebook-new-cell': 'НОВАЯ ЯЧЕЙКА',
      'notebook-edit-cell': 'ЯЧЕЙКА'
    };
    return labels[changeType] || changeType;
  }

  function appendChangeChipRow(container, chips) {
    var items = Array.isArray(chips) ? chips.filter(Boolean) : [];
    if (!items.length) return;

    var row = document.createElement('div');
    row.className = 'fc-chip-row';

    items.forEach(function (item) {
      var chip = document.createElement('span');
      chip.className = 'fc-chip' + (item.kind ? ' is-' + item.kind : '');
      chip.textContent = item.text;
      row.appendChild(chip);
    });

    container.appendChild(row);
  }

  function createChangeActionButtons(actionsEl, changeId, filePath, vscode) {
    actionsEl.innerHTML = '';

    var acceptBtn = document.createElement('button');
    acceptBtn.className = 'btn btn-primary btn-xs fc-btn';
    acceptBtn.textContent = 'Принять';
    acceptBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'acceptChange', changeId: changeId });
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-secondary btn-xs fc-btn';
    rejectBtn.textContent = 'Отклонить';
    rejectBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'rejectChange', changeId: changeId });
    });

    var openBtn = document.createElement('button');
    openBtn.className = 'btn btn-secondary btn-xs fc-btn';
    openBtn.textContent = 'Открыть';
    openBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'openChangedFile', filePath: filePath });
    });

    var diffBtn = document.createElement('button');
    diffBtn.className = 'btn btn-secondary btn-xs fc-btn';
    diffBtn.textContent = 'Δ Diff';
    diffBtn.addEventListener('click', function () {
      vscode.postMessage({ type: 'showDiff', changeId: changeId });
    });

    actionsEl.appendChild(acceptBtn);
    actionsEl.appendChild(rejectBtn);
    actionsEl.appendChild(openBtn);
    actionsEl.appendChild(diffBtn);
  }

  function clearResolvedCard(el) {
    if (!el) return;
    el.classList.remove('fc-accepted', 'fc-rejected', 'fc-reverted');
  }

  function setChangeCardResolvedState(el, accepted) {
    if (!el) return;
    clearResolvedCard(el);
    el.classList.add(accepted ? 'fc-accepted' : 'fc-rejected');
    var actions = el.querySelector('.fc-actions');
    if (actions) {
      actions.innerHTML = accepted
        ? '<span class="fc-status fc-status-accepted">Принято</span>'
        : '<span class="fc-status fc-status-rejected">Отклонено (файл восстановлен)</span>';
    }
  }

  function createChangeController(ctx) {
    var messagesEl = ctx.messagesEl;
    var vscode = ctx.vscode;
    var updateBulkBar = ctx.updateBulkBar;

    var approvals = window.ChatApprovals && window.ChatApprovals.createApprovalController
      ? window.ChatApprovals.createApprovalController({ messagesEl: messagesEl, vscode: vscode })
      : {
        appendApprovalRequest: function () {},
        resolveApproval: function () {},
        appendQuestionRequest: function () {},
        resolveQuestion: function () {}
      };

    var checkpoints = window.ChatCheckpoints && window.ChatCheckpoints.createCheckpointController
      ? window.ChatCheckpoints.createCheckpointController({
          messagesEl: messagesEl,
          vscode: vscode,
          updateBulkBar: updateBulkBar,
          clearResolvedCard: clearResolvedCard,
          rebuildChangeActions: rebuildFcActions,
          setChangeCardResolvedState: setChangeCardResolvedState,
          onEditCheckpointRequest: ctx.onEditCheckpointRequest,
          onRepeatCheckpointRequest: ctx.onRepeatCheckpointRequest
        })
      : {
          appendCheckpoint: function () {},
          syncCheckpointsList: function () {},
          updateCheckpoint: function () {},
          markCheckpointReverted: function () {},
          handleUndoRevertDone: function () {},
          handleCheckpointBranchCommitted: function () {}
        };

    function appendFileChange(msg) {
      var el = document.createElement('div');
      el.className = 'message file-change';
      el.dataset.changeId = msg.changeId;
      el.dataset.filePath = msg.filePath || '';
      el.dataset.added = String(msg.stats && Number.isFinite(msg.stats.added) ? msg.stats.added : 0);
      el.dataset.removed = String(msg.stats && Number.isFinite(msg.stats.removed) ? msg.stats.removed : 0);
      if (msg.step != null) {
        el.dataset.stepKey = String(msg.step);
      }

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

      if (msg.summary) {
        var summaryEl = document.createElement('div');
        summaryEl.className = 'fc-summary';
        summaryEl.textContent = msg.summary;
        el.appendChild(summaryEl);
      }

      appendChangeChipRow(el, [
        msg.stats && msg.stats.added ? { text: '+' + msg.stats.added, kind: 'add' } : null,
        msg.stats && msg.stats.removed ? { text: '-' + msg.stats.removed, kind: 'del' } : null,
        msg.stats ? { text: (msg.stats.beforeLines || 0) + ' -> ' + (msg.stats.afterLines || 0) + ' строк', kind: 'lines' } : null,
        msg.cellIdx !== undefined ? { text: 'ячейка ' + msg.cellIdx, kind: 'cell' } : null
      ]);

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
          tdSign.textContent = dl.type === 'add' ? '+' : dl.type === 'del' ? '−' : dl.type === 'sep' ? '' : ' ';

          var tdCode = document.createElement('td');
          tdCode.className = 'diff-code';
          if (dl.type === 'sep') tdCode.classList.add('diff-sep-text');
          tdCode.textContent = dl.text;

          tr.appendChild(tdOld);
          tr.appendChild(tdNew);
          tr.appendChild(tdSign);
          tr.appendChild(tdCode);
          table.appendChild(tr);
        }

        diff.appendChild(table);
        el.appendChild(diff);
      } else if (msg.oldSnippet || msg.newSnippet) {
        var fallbackDiff = document.createElement('div');
        fallbackDiff.className = 'fc-diff';

        if (msg.oldSnippet) {
          var oldBlock = document.createElement('div');
          oldBlock.className = 'fc-diff-old';
          var oldLabel = document.createElement('div');
          oldLabel.className = 'fc-diff-label';
          oldLabel.textContent = '− Было';
          oldBlock.appendChild(oldLabel);
          var oldCode = document.createElement('pre');
          oldCode.className = 'fc-diff-code';
          oldCode.textContent = msg.oldSnippet;
          oldBlock.appendChild(oldCode);
          fallbackDiff.appendChild(oldBlock);
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
          fallbackDiff.appendChild(newBlock);
        }

        el.appendChild(fallbackDiff);
      }

      var actions = document.createElement('div');
      actions.className = 'fc-actions';
      createChangeActionButtons(actions, msg.changeId, msg.filePath, vscode);
      el.appendChild(actions);

      var mount = msg.step != null ? findStepChildrenMount(messagesEl, msg.step) : null;
      if (!mount && messagesEl.__chatTimeline && typeof messagesEl.__chatTimeline.getDefaultArtifactMount === 'function') {
        mount = messagesEl.__chatTimeline.getDefaultArtifactMount();
      }
      (mount || messagesEl).appendChild(el);
      scrollToBottom(messagesEl);
      updateBulkBar();
    }

    function markChangeStatus(changeId, accepted) {
      var el = document.querySelector('[data-change-id="' + changeId + '"]');
      if (!el) return;
      setChangeCardResolvedState(el, accepted);
      updateBulkBar();
    }

    function rebuildFcActions(el) {
      var changeId = el.dataset.changeId;
      var filePath = el.dataset.filePath;
      var actions = el.querySelector('.fc-actions');
      if (!actions) return;
      createChangeActionButtons(actions, changeId, filePath, vscode);
    }

    function syncPendingChanges(pendingChangeIds) {
      var pendingMap = Object.create(null);
      (Array.isArray(pendingChangeIds) ? pendingChangeIds : []).forEach(function (changeId) {
        if (!changeId) return;
        pendingMap[String(changeId)] = true;
      });

      var cards = messagesEl.querySelectorAll('.message.file-change[data-change-id]');
      Array.prototype.forEach.call(cards, function (el) {
        var changeId = String(el.dataset.changeId || '').trim();
        if (!changeId || !pendingMap[changeId]) return;
        clearResolvedCard(el);
        rebuildFcActions(el);
      });

      updateBulkBar();
    }

    return {
      appendApprovalRequest: approvals.appendApprovalRequest,
      resolveApproval: approvals.resolveApproval,
      appendQuestionRequest: approvals.appendQuestionRequest,
      resolveQuestion: approvals.resolveQuestion,
      appendFileChange: appendFileChange,
      markChangeStatus: markChangeStatus,
      replayArtifact: function (artifact) {
        if (!artifact || !artifact.kind) return;
        if (artifact.kind === 'approvalRequest') {
          approvals.appendApprovalRequest(artifact.payload);
          return;
        }
        if (artifact.kind === 'approvalResolved') {
          approvals.resolveApproval(artifact.payload);
          return;
        }
        if (artifact.kind === 'questionRequest') {
          approvals.appendQuestionRequest(artifact.payload);
          return;
        }
        if (artifact.kind === 'questionResolved') {
          approvals.resolveQuestion(artifact.payload);
          return;
        }
        if (artifact.kind === 'checkpoint') {
          checkpoints.appendCheckpoint(artifact.payload, { preferLatest: false });
          return;
        }
        if (artifact.kind === 'checkpointUpdated') {
          checkpoints.updateCheckpoint(artifact.payload);
          return;
        }
        if (artifact.kind === 'checkpointReverted') {
          checkpoints.markCheckpointReverted(artifact.payload);
          return;
        }
        if (artifact.kind === 'undoRevertDone') {
          checkpoints.handleUndoRevertDone(artifact.payload);
          return;
        }
        if (artifact.kind === 'checkpointBranchCommitted') {
          checkpoints.handleCheckpointBranchCommitted(artifact.payload);
          return;
        }
        if (artifact.kind === 'fileChange') {
          appendFileChange(artifact.payload);
          return;
        }
        if (artifact.kind === 'changeStatus') {
          markChangeStatus(artifact.payload.changeId, artifact.payload.type === 'changeAccepted');
        }
      },
      appendCheckpoint: checkpoints.appendCheckpoint,
      syncCheckpointsList: checkpoints.syncCheckpointsList,
      updateCheckpoint: checkpoints.updateCheckpoint,
      markCheckpointReverted: checkpoints.markCheckpointReverted,
      handleUndoRevertDone: checkpoints.handleUndoRevertDone,
      handleCheckpointBranchCommitted: checkpoints.handleCheckpointBranchCommitted,
      syncPendingChanges: syncPendingChanges,
    };
  }

  window.ChatChanges = {
    createChangeController: createChangeController,
  };
})();
