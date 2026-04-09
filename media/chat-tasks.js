(function () {
  'use strict';

  function pluralize(count) {
    var mod10 = count % 10;
    var mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return count + ' задача';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return count + ' задачи';
    return count + ' задач';
  }

  function isActiveTask(task) {
    return !!task && (task.status === 'pending' || task.status === 'in_progress');
  }

  function shortPath(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    var normalized = text.replace(/\\/g, '/');
    var parts = normalized.split('/').filter(Boolean);
    if (parts.length <= 2) return normalized;
    return parts.slice(-2).join('/');
  }

  function formatTimeAgo(timestamp) {
    var value = Number(timestamp || 0);
    if (!value) return '';
    var diffSec = Math.max(0, Math.floor((Date.now() - value) / 1000));
    if (diffSec < 5) return 'только что';
    if (diffSec < 60) return diffSec + 'с назад';
    var diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return diffMin + 'м назад';
    var diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return diffHours + 'ч назад';
    var diffDays = Math.floor(diffHours / 24);
    return diffDays + 'д назад';
  }

  function formatDateTime(timestamp) {
    var value = Number(timestamp || 0);
    if (!value) return '';
    try {
      return new Date(value).toLocaleString('ru-RU', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return '';
    }
  }

  function formatDurationMs(ms) {
    var value = Number(ms || 0);
    if (!value || value < 1000) return '<1с';
    if (value < 60_000) return Math.round(value / 1000) + 'с';
    if (value < 3_600_000) return Math.round(value / 60_000) + 'м';
    var hours = Math.floor(value / 3_600_000);
    var minutes = Math.round((value % 3_600_000) / 60_000);
    if (!minutes) return hours + 'ч';
    return hours + 'ч ' + minutes + 'м';
  }

  function formatTaskDuration(task) {
    if (!task) return '';
    var startedAt = Number(task.startedAt || 0);
    if (!startedAt) return '';
    var finishedAt = Number(task.finishedAt || 0);
    var end = finishedAt || Date.now();
    if (end <= startedAt) return '';
    return formatDurationMs(end - startedAt);
  }

  function buildStatusLabel(task) {
    switch (task.status) {
      case 'pending': return 'В очереди';
      case 'in_progress': return 'В работе';
      case 'completed': return 'Готово';
      case 'failed': return 'Ошибка';
      case 'cancelled': return 'Остановлено';
      case 'blocked': return 'Заблокировано';
      default: return task.status || 'Неизвестно';
    }
  }

  function createMeta(task) {
    var parts = [];
    parts.push(task.kind === 'shell' ? 'фоновая shell-команда' : 'фоновая задача');
    if (task.cwd) parts.push(shortPath(task.cwd));

    if (task.status === 'in_progress' && task.startedAt) {
      parts.push('запущена ' + formatTimeAgo(task.startedAt));
    } else if (task.status === 'pending' && task.createdAt) {
      parts.push('создана ' + formatTimeAgo(task.createdAt));
    } else if (task.updatedAt) {
      parts.push('обновлена ' + formatTimeAgo(task.updatedAt));
    }

    var duration = formatTaskDuration(task);
    if (duration) parts.push('длительность ' + duration);
    if (typeof task.exitCode === 'number') parts.push('exit ' + task.exitCode);
    if (task.signal) parts.push(String(task.signal));
    if (task.stopRequestedAt && isActiveTask(task)) parts.push('остановка запрошена');
    return parts.join(' • ');
  }

  function createActionButton(label, className, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-xs ' + className;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function appendTextBlock(card, title, text, className) {
    var value = String(text || '').trim();
    if (!value) return;

    var section = document.createElement('div');
    section.className = 'task-block ' + (className || '');

    var heading = document.createElement('div');
    heading.className = 'task-block-title';
    heading.textContent = title;
    section.appendChild(heading);

    var body = document.createElement('pre');
    body.className = 'task-block-body';
    body.textContent = value;
    section.appendChild(body);

    card.appendChild(section);
  }

  function appendSection(listEl, title, items, renderTaskCard) {
    if (!items.length) return;

    var section = document.createElement('section');
    section.className = 'task-group';

    var header = document.createElement('div');
    header.className = 'task-group-header';

    var heading = document.createElement('div');
    heading.className = 'task-group-title';
    heading.textContent = title;

    var count = document.createElement('span');
    count.className = 'task-group-count';
    count.textContent = pluralize(items.length);

    header.appendChild(heading);
    header.appendChild(count);
    section.appendChild(header);

    var groupList = document.createElement('div');
    groupList.className = 'task-group-list';
    items.forEach(function (task) {
      groupList.appendChild(renderTaskCard(task));
    });
    section.appendChild(groupList);

    listEl.appendChild(section);
  }

  function createTaskController(options) {
    var panelEl = options.panelEl;
    var metaEl = options.metaEl;
    var listEl = options.listEl;
    var refreshBtn = options.refreshBtn;
    var onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : null;
    var vscode = options.vscode;

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'getTasksState' });
      });
    }

    function renderTaskCard(task) {
      var card = document.createElement('div');
      card.className = 'task-card task-status-' + (task.status || 'unknown');

      var top = document.createElement('div');
      top.className = 'task-top';

      var heading = document.createElement('div');
      heading.className = 'task-heading';

      var title = document.createElement('div');
      title.className = 'task-title';
      title.textContent = task.subject || task.id;
      title.title = task.subject || task.id;

      var subtitle = document.createElement('div');
      subtitle.className = 'task-subtitle';
      var subtitleParts = ['#' + task.id];
      if (task.description && task.description !== task.subject) subtitleParts.push(task.description);
      subtitle.textContent = subtitleParts.join(' · ');
      subtitle.title = subtitle.textContent;

      heading.appendChild(title);
      heading.appendChild(subtitle);

      var status = document.createElement('span');
      status.className = 'task-status-chip is-' + (task.status || 'unknown');
      status.textContent = buildStatusLabel(task);

      top.appendChild(heading);
      top.appendChild(status);
      card.appendChild(top);

      var meta = document.createElement('div');
      meta.className = 'task-meta';
      meta.textContent = createMeta(task);
      meta.title = [
        task.startedAt ? 'запущена: ' + formatDateTime(task.startedAt) : '',
        task.finishedAt ? 'завершена: ' + formatDateTime(task.finishedAt) : '',
        task.updatedAt ? 'обновлена: ' + formatDateTime(task.updatedAt) : ''
      ].filter(Boolean).join('\n');
      card.appendChild(meta);

      if (task.command) {
        appendTextBlock(card, 'Команда', task.command, 'task-block-command');
      }

      if (task.activeForm && task.status === 'in_progress') {
        var active = document.createElement('div');
        active.className = 'task-note task-note-active';
        active.textContent = 'Сейчас: ' + task.activeForm;
        card.appendChild(active);
      }

      if (task.stopRequestedAt && isActiveTask(task)) {
        var stopRequested = document.createElement('div');
        stopRequested.className = 'task-note task-note-warning';
        stopRequested.textContent = 'Остановка запрошена ' + formatTimeAgo(task.stopRequestedAt) + '.';
        card.appendChild(stopRequested);
      }

      if (task.note) {
        var note = document.createElement('div');
        note.className = 'task-note';
        note.textContent = task.note;
        card.appendChild(note);
      }

      appendTextBlock(card, 'stdout', task.stdoutPreview, 'task-block-output');
      appendTextBlock(card, 'stderr', task.stderrPreview, 'task-block-output');
      if (!task.stdoutPreview && !task.stderrPreview && task.preview) {
        appendTextBlock(card, 'Последний вывод', task.preview, 'task-block-output');
      }

      var actions = document.createElement('div');
      actions.className = 'task-actions';

      if (task.taskFilePath) {
        actions.appendChild(createActionButton('Открыть task.json', 'task-action-open', function () {
          vscode.postMessage({ type: 'openTaskFile', filePath: task.taskFilePath });
        }));
      }

      if (task.stdoutPath) {
        actions.appendChild(createActionButton('Открыть stdout', 'task-action-open', function () {
          vscode.postMessage({ type: 'openTaskFile', filePath: task.stdoutPath });
        }));
      }

      if (task.stderrPath) {
        actions.appendChild(createActionButton('Открыть stderr', 'task-action-open', function () {
          vscode.postMessage({ type: 'openTaskFile', filePath: task.stderrPath });
        }));
      }

      if (isActiveTask(task)) {
        actions.appendChild(createActionButton('Остановить', 'task-action-stop', function () {
          vscode.postMessage({ type: 'stopTask', taskId: task.id });
        }));
      }

      actions.appendChild(createActionButton('Обновить список', 'task-action-refresh', function () {
        vscode.postMessage({ type: 'getTasksState' });
      }));

      card.appendChild(actions);
      return card;
    }

    function render(payload) {
      var items = Array.isArray(payload && payload.tasks) ? payload.tasks.slice() : [];
      if (!panelEl || !metaEl || !listEl) return;

      listEl.innerHTML = '';
      metaEl.textContent = payload && payload.summary
        ? String(payload.summary)
        : items.length === 0
          ? 'Нет фоновых задач'
          : pluralize(items.length);

      if (onStateChange) {
        onStateChange({
          hasTasks: items.length > 0,
          activeCount: Number(payload && payload.activeCount || 0),
          totalCount: Number(payload && payload.totalCount || items.length),
          summary: payload && payload.summary ? String(payload.summary) : '',
        });
      }

      if (items.length === 0) return;

      var active = items.filter(isActiveTask);
      var history = items.filter(function (task) { return !isActiveTask(task); });

      appendSection(listEl, 'Активные', active, renderTaskCard);
      appendSection(listEl, 'История', history, renderTaskCard);
    }

    return {
      setTasks: render,
    };
  }

  window.ChatTasks = {
    createTaskController: createTaskController,
  };
})();
