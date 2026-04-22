(function () {
  'use strict';

  function scrollToBottom(messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function compactInline(value, maxLength) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    var limit = Math.max(16, Number(maxLength) || 96);
    return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…';
  }

  function buildResolvedStatusHtml(className, label, detail) {
    var safeLabel = escapeHtml(label);
    var safeDetail = compactInline(detail || '', 120);
    return '<div class="approval-status-wrap">'
      + '<span class="' + className + '">' + safeLabel + '</span>'
      + (safeDetail ? '<div class="approval-status-detail">' + escapeHtml(safeDetail) + '</div>' : '')
      + '</div>';
  }

  function resolveCard(el, fields, statusHtml, resolvedClass) {
    fields.forEach(function (field) {
      if (!field) return;
      field.readOnly = true;
      field.classList.add('pc-locked', 'sc-cmd-locked');
    });
    var actions = el.querySelector('[data-approval-actions]');
    if (actions) actions.innerHTML = statusHtml;
    el.classList.add('sc-resolved', 'pc-resolved');
    el.classList.add('is-collapsed');
    if (resolvedClass) el.classList.add(resolvedClass);
  }

  function findApprovalCard(messagesEl, confirmId) {
    if (!confirmId) return null;
    return messagesEl.querySelector('[data-confirm-id="' + String(confirmId) + '"]');
  }

  function findApprovalMount(messagesEl, request) {
    var step = request && request.step != null ? String(request.step) : '';
    if (step) {
      var allChildren = messagesEl.querySelectorAll('.trace-step[data-step-key="' + step + '"] .trace-step-children');
      if (allChildren && allChildren.length > 0) {
        var children = allChildren[allChildren.length - 1];
        children.classList.remove('hidden');
        return children;
      }
    }

    var activeChildren = messagesEl.querySelector('.trace-run.is-running .trace-step.is-running .trace-step-children');
    if (activeChildren) {
      activeChildren.classList.remove('hidden');
      return activeChildren;
    }

    if (messagesEl.__chatTimeline && typeof messagesEl.__chatTimeline.getDefaultArtifactMount === 'function') {
      return messagesEl.__chatTimeline.getDefaultArtifactMount();
    }

    return messagesEl;
  }

  function appendShellApproval(messagesEl, vscode, request) {
    var el = document.createElement('div');
    el.className = 'message step-block shell-confirm approval-request';
    el.dataset.confirmId = request.confirmId;
    el.dataset.approvalKind = 'shell';

    var header = document.createElement('div');
    header.className = 'sc-header';
    header.textContent = request.title || 'Подтвердите shell-команду';
    el.appendChild(header);

    if (request.description) {
      var desc = document.createElement('div');
      desc.className = 'pc-meta';
      desc.textContent = request.description;
      el.appendChild(desc);
    }

    appendMetaText(el, 'approval-summary', request.summary);
    appendChipRow(el, [
      request.commandKind ? { text: request.commandKind, kind: 'shell-kind' } : null,
      request.riskLabel ? { text: request.riskLabel, kind: request.destructive ? 'danger' : (request.readOnly ? 'safe' : 'caution') } : null,
      request.readOnly ? { text: 'без записи', kind: 'safe' } : { text: 'может менять проект', kind: request.destructive ? 'danger' : 'caution' },
      request.cwdLabel ? { text: request.cwdLabel, kind: 'cwd' } : null
    ]);

    var cmdRow = document.createElement('div');
    cmdRow.className = 'sc-cmd-row';

    var cmdPrefix = document.createElement('span');
    cmdPrefix.className = 'sc-cmd-prefix';
    cmdPrefix.textContent = '$';
    cmdRow.appendChild(cmdPrefix);

    var cmdInput = document.createElement('input');
    cmdInput.type = 'text';
    cmdInput.className = 'sc-cmd-input';
    cmdInput.value = request.command || '';
    cmdInput.spellcheck = false;
    cmdInput.readOnly = request.canEditCommand === false;
    cmdRow.appendChild(cmdInput);
    el.appendChild(cmdRow);

    if (request.cwd) {
      var cwdEl = document.createElement('div');
      cwdEl.className = 'sc-cwd';
      cwdEl.textContent = 'cwd: ' + request.cwd;
      el.appendChild(cwdEl);
    }

    var actions = document.createElement('div');
    actions.className = 'sc-actions';
    actions.dataset.approvalActions = 'true';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary btn-xs';
    approveBtn.textContent = request.destructive ? 'Разрешить выполнение' : (request.readOnly ? 'Запустить проверку' : 'Выполнить');
    approveBtn.addEventListener('click', function () {
      var commandValue = cmdInput.value.trim();
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'shell',
          confirmId: request.confirmId,
          approved: true,
          command: commandValue
        }
      });
      resolveCard(el, [cmdInput], buildResolvedStatusHtml('sc-status sc-approved', 'Подтверждено, выполняю команду', commandValue), 'sc-approved-card');
    });

    var denyBtn = document.createElement('button');
    denyBtn.className = 'btn btn-secondary btn-xs';
    denyBtn.textContent = 'Отклонить';
    denyBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'shell',
          confirmId: request.confirmId,
          approved: false,
          command: ''
        }
      });
      resolveCard(el, [cmdInput], buildResolvedStatusHtml('sc-status sc-denied', 'Отклонено', cmdInput.value.trim()), 'sc-rejected-card');
    });

    cmdInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        approveBtn.click();
      }
    });

    actions.appendChild(approveBtn);
    actions.appendChild(denyBtn);
    el.appendChild(actions);

    findApprovalMount(messagesEl, request).appendChild(el);
    scrollToBottom(messagesEl);
    cmdInput.focus();
    cmdInput.setSelectionRange(cmdInput.value.length, cmdInput.value.length);
  }

  function appendPlanApproval(messagesEl, vscode, request) {
    var el = document.createElement('div');
    el.className = 'message step-block plan-confirm approval-request';
    el.dataset.confirmId = request.confirmId;
    el.dataset.approvalKind = 'plan';

    var header = document.createElement('div');
    header.className = 'pc-header';
    header.textContent = request.title || (request.mutationQuery ? 'Утвердите план перед реализацией' : 'Утвердите итоговый план');
    el.appendChild(header);

    var meta = document.createElement('div');
    meta.className = 'pc-meta';
    meta.textContent = request.description || (request.mutationQuery
      ? 'Можно поправить текст плана перед запуском реализации.'
      : 'Можно поправить текст плана перед публикацией ответа.');
    el.appendChild(meta);

    var planInput = document.createElement('textarea');
    planInput.className = 'pc-plan-input';
    planInput.spellcheck = false;
    planInput.value = request.plan || '';
    planInput.rows = 12;
    el.appendChild(planInput);

    var feedbackInput = document.createElement('textarea');
    feedbackInput.className = 'pc-feedback-input';
    feedbackInput.placeholder = request.feedbackPlaceholder || 'Комментарий для доработки плана (необязательно)';
    feedbackInput.rows = 3;
    el.appendChild(feedbackInput);

    var actions = document.createElement('div');
    actions.className = 'pc-actions';
    actions.dataset.approvalActions = 'true';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary btn-xs';
    approveBtn.textContent = request.mutationQuery ? 'Одобрить и продолжить' : 'Одобрить';
    approveBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'plan',
          confirmId: request.confirmId,
          approved: true,
          plan: planInput.value.trim(),
          feedback: feedbackInput.value.trim()
        }
      });
      resolveCard(el, [planInput, feedbackInput], buildResolvedStatusHtml('pc-status pc-approved', 'План утверждён', 'Агент продолжит выполнение по этому плану.'), 'pc-approved-card');
    });

    var reviseBtn = document.createElement('button');
    reviseBtn.className = 'btn btn-secondary btn-xs';
    reviseBtn.textContent = 'Вернуть на доработку';
    reviseBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'plan',
          confirmId: request.confirmId,
          approved: false,
          plan: planInput.value.trim(),
          feedback: feedbackInput.value.trim()
        }
      });
      resolveCard(el, [planInput, feedbackInput], buildResolvedStatusHtml('pc-status pc-rejected', 'План отправлен на доработку', feedbackInput.value.trim()), 'pc-rejected-card');
    });

    actions.appendChild(approveBtn);
    actions.appendChild(reviseBtn);
    el.appendChild(actions);

    findApprovalMount(messagesEl, request).appendChild(el);
    scrollToBottom(messagesEl);
    planInput.focus();
  }

  function buildFileChangeLabel(changeType) {
    var labels = {
      edit: 'Точечная правка',
      create: 'Создание файла',
      overwrite: 'Перезапись файла',
      delete: 'Удаление файла',
      'notebook-new-cell': 'Новая ячейка',
      'notebook-edit-cell': 'Правка ячейки'
    };
    return labels[changeType] || 'Изменение файла';
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value >= 1024 * 1024) return (value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1) + ' МБ';
    if (value >= 1024) return Math.round(value / 1024) + ' КБ';
    return value + ' Б';
  }

  function buildFileApprovalActionLabel(changeType) {
    var labels = {
      edit: 'Разрешить правку',
      create: 'Создать файл',
      overwrite: 'Перезаписать файл',
      delete: 'Удалить файл',
      'notebook-new-cell': 'Добавить ячейку',
      'notebook-edit-cell': 'Разрешить правку'
    };
    return labels[changeType] || 'Разрешить';
  }

  function buildFileApprovalResolvedLabel(changeType, approved) {
    if (!approved) return 'Отменено';
    var labels = {
      edit: 'Правка разрешена',
      create: 'Создание разрешено',
      overwrite: 'Перезапись разрешена',
      delete: 'Удаление разрешено',
      'notebook-new-cell': 'Добавление разрешено',
      'notebook-edit-cell': 'Правка разрешена'
    };
    return labels[changeType] || 'Разрешено';
  }

  function buildAutoFileApprovalResolvedLabel(changeType) {
    var labels = {
      edit: 'Правка авторазрешена',
      create: 'Создание авторазрешено',
      overwrite: 'Перезапись авторазрешена',
      delete: 'Удаление авторазрешено',
      'notebook-new-cell': 'Добавление авторазрешено',
      'notebook-edit-cell': 'Правка авторазрешена'
    };
    return labels[changeType] || 'Действие авторазрешено';
  }

  function buildApprovalCancelledLabel(kind, changeType) {
    if (kind === 'shell') return 'Ожидание подтверждения прервано';
    if (kind === 'plan') return 'Согласование прервано';
    if (kind === 'file') return 'Подтверждение прервано';
    if (kind === 'worktree') return 'Ожидание подтверждения прервано';
    if (kind === 'mcp') return 'Вызов MCP tool прерван';
    if (kind === 'web') return 'Загрузка URL прервана';
    if (kind === 'question') return 'Ожидание ответа прервано';
    return 'Операция прервана';
  }

  function buildWorktreeApprovalLabel(action) {
    if (action === 'enter') return 'Создание worktree';
    if (action === 'remove') return 'Удаление worktree';
    return 'Выход из worktree';
  }

  function buildWorktreeApproveLabel(action) {
    if (action === 'enter') return 'Создать worktree';
    if (action === 'remove') return 'Удалить worktree';
    return 'Выйти из worktree';
  }

  function buildWorktreeResolvedLabel(action, approved) {
    if (!approved) return 'Отменено';
    if (action === 'enter') return 'Worktree создан';
    if (action === 'remove') return 'Worktree удалён';
    return 'Возврат из worktree выполнен';
  }

  function buildAutoWorktreeResolvedLabel(action) {
    if (action === 'enter') return 'Создание worktree авторазрешено';
    if (action === 'remove') return 'Удаление worktree авторазрешено';
    return 'Выход из worktree авторазрешён';
  }

  function appendMetaText(parent, className, text) {
    if (!text) return;
    var el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    parent.appendChild(el);
  }

  function appendChipRow(parent, chips) {
    if (!chips || !chips.length) return;
    var row = document.createElement('div');
    row.className = 'approval-chip-row';

    chips.forEach(function (chip) {
      if (!chip || !chip.text) return;
      var el = document.createElement('span');
      el.className = 'approval-chip' + (chip.kind ? ' is-' + chip.kind : '');
      el.textContent = chip.text;
      row.appendChild(el);
    });

    if (row.childElementCount > 0) {
      parent.appendChild(row);
    }
  }

  function appendSnippetBlock(parent, label, className, text) {
    if (!text) return;
    var block = document.createElement('div');
    block.className = 'approval-file-block ' + className;

    var title = document.createElement('div');
    title.className = 'approval-file-label';
    title.textContent = label;
    block.appendChild(title);

    var code = document.createElement('pre');
    code.className = 'approval-file-code';
    code.textContent = text;
    block.appendChild(code);
    parent.appendChild(block);
  }

  function getQuestionSelections(el, question, questionIndex) {
    var nodes = el.querySelectorAll('[data-question-index="' + String(questionIndex) + '"] input:checked');
    return Array.prototype.map.call(nodes, function (node) {
      return String(node.value || '').trim();
    }).filter(Boolean);
  }

  function getQuestionCustomValue(el, questionIndex) {
    var input = el.querySelector('[data-question-custom-input="' + String(questionIndex) + '"]');
    return input ? String(input.value || '').trim() : '';
  }

  function hasQuestionCustomAnswer(el, questionIndex) {
    var toggle = el.querySelector('[data-question-custom-toggle="' + String(questionIndex) + '"]');
    var value = getQuestionCustomValue(el, questionIndex);
    return !!((toggle && toggle.checked) || value);
  }

  function collectQuestionAnswers(el, request) {
    var answers = {};
    var questions = Array.isArray(request.questions) ? request.questions : [];
    questions.forEach(function (question, questionIndex) {
      var values = getQuestionSelections(el, question, questionIndex);
      var customValue = getQuestionCustomValue(el, questionIndex);
      if (customValue) {
        values = values.filter(function (value) { return value !== '__custom__'; });
        values.push('Свой вариант: ' + customValue);
      } else {
        values = values.filter(function (value) { return value !== '__custom__'; });
      }
      if (values.length) {
        answers[question.question] = values.join(', ');
      }
    });
    return answers;
  }

  function validateQuestionAnswers(el, request) {
    var questions = Array.isArray(request.questions) ? request.questions : [];
    for (var index = 0; index < questions.length; index++) {
      var question = questions[index];
      var values = getQuestionSelections(el, question, index);
      var customEnabled = hasQuestionCustomAnswer(el, index);
      var customValue = getQuestionCustomValue(el, index);
      var selectedValues = values.filter(function (value) { return value !== '__custom__'; });
      if (!selectedValues.length && !customEnabled) {
        return question.question || question.header || 'Нужно выбрать хотя бы один ответ.';
      }
      if (customEnabled && !customValue) {
        return 'Введите свой вариант ответа.';
      }
    }
    return '';
  }

  function buildQuestionAnswersLabel(answers) {
    var entries = Object.entries(answers || {});
    return entries.map(function (entry) {
      return entry[0] + ' → ' + entry[1];
    }).join(' • ');
  }

  function appendQuestionBlock(container, request, question, questionIndex) {
    var block = document.createElement('div');
    block.className = 'question-block';
    block.dataset.questionIndex = String(questionIndex);

    appendChipRow(block, [
      question.header ? { text: question.header, kind: 'question' } : null,
      question.multiSelect ? { text: 'несколько вариантов', kind: 'question-meta' } : { text: 'один вариант', kind: 'question-meta' }
    ]);

    var title = document.createElement('div');
    title.className = 'question-title';
    title.textContent = question.question || ('Вопрос ' + (questionIndex + 1));
    block.appendChild(title);

    var options = document.createElement('div');
    options.className = 'question-options';
    var inputType = question.multiSelect ? 'checkbox' : 'radio';
    var groupName = 'question-' + request.confirmId + '-' + questionIndex;

    (Array.isArray(question.options) ? question.options : []).forEach(function (option, optionIndex) {
      var label = document.createElement('label');
      label.className = 'question-option';

      var input = document.createElement('input');
      input.type = inputType;
      input.name = groupName;
      input.value = option.label || ('Вариант ' + (optionIndex + 1));
      label.appendChild(input);

      var body = document.createElement('div');
      body.className = 'question-option-body';

      var optionTitle = document.createElement('div');
      optionTitle.className = 'question-option-label';
      optionTitle.textContent = option.label || ('Вариант ' + (optionIndex + 1));
      body.appendChild(optionTitle);

      if (option.description) {
        var optionDescription = document.createElement('div');
        optionDescription.className = 'question-option-desc';
        optionDescription.textContent = option.description;
        body.appendChild(optionDescription);
      }

      label.appendChild(body);
      options.appendChild(label);
    });

    var customLabel = document.createElement('label');
    customLabel.className = 'question-option question-option-custom';

    var customInput = document.createElement('input');
    customInput.type = inputType;
    customInput.name = groupName;
    customInput.value = '__custom__';
    customInput.dataset.questionCustomToggle = String(questionIndex);
    customLabel.appendChild(customInput);

    var customBody = document.createElement('div');
    customBody.className = 'question-option-body';

    var customTitle = document.createElement('div');
    customTitle.className = 'question-option-label';
    customTitle.textContent = 'Свой вариант';
    customBody.appendChild(customTitle);

    var customDescription = document.createElement('div');
    customDescription.className = 'question-option-desc';
    customDescription.textContent = 'Можно ввести свой ответ вместо готовых вариантов.';
    customBody.appendChild(customDescription);

    var customTextarea = document.createElement('textarea');
    customTextarea.className = 'question-custom-input';
    customTextarea.rows = 2;
    customTextarea.placeholder = 'Введите свой вариант...';
    customTextarea.spellcheck = true;
    customTextarea.dataset.questionCustomInput = String(questionIndex);
    customTextarea.addEventListener('focus', function () {
      customInput.checked = true;
    });
    customTextarea.addEventListener('input', function () {
      if (customTextarea.value.trim()) {
        customInput.checked = true;
      }
    });
    customBody.appendChild(customTextarea);

    customLabel.appendChild(customBody);
    options.appendChild(customLabel);

    block.appendChild(options);
    container.appendChild(block);
  }

  function renderQuestionRequest(messagesEl, vscode, request) {
    var el = document.createElement('div');
    el.className = 'message step-block question-confirm approval-request';
    el.dataset.confirmId = request.confirmId;
    el.dataset.approvalKind = 'question';

    var header = document.createElement('div');
    header.className = 'pc-header';
    header.textContent = request.title || 'Нужно уточнение пользователя';
    el.appendChild(header);

    if (request.description) {
      var desc = document.createElement('div');
      desc.className = 'pc-meta';
      desc.textContent = request.description;
      el.appendChild(desc);
    }

    (Array.isArray(request.questions) ? request.questions : []).forEach(function (question, questionIndex) {
      appendQuestionBlock(el, request, question, questionIndex);
    });

    var validation = document.createElement('div');
    validation.className = 'question-validation hidden';
    el.appendChild(validation);

    var actions = document.createElement('div');
    actions.className = 'pc-actions';
    actions.dataset.approvalActions = 'true';

    var submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-primary btn-xs';
    submitBtn.textContent = 'Отправить ответы';
    submitBtn.addEventListener('click', function () {
      var validationError = validateQuestionAnswers(el, request);
      if (validationError) {
        validation.classList.remove('hidden');
        validation.textContent = validationError;
        return;
      }
      validation.classList.add('hidden');
      validation.textContent = '';
      var answers = collectQuestionAnswers(el, request);
      vscode.postMessage({
        type: 'questionResult',
        result: {
          kind: 'question',
          confirmId: request.confirmId,
          answered: true,
          answers: answers
        }
      });
      resolveCard(
        el,
        Array.prototype.slice.call(el.querySelectorAll('input, textarea')),
        buildResolvedStatusHtml('pc-status pc-approved', 'Ответы отправлены', buildQuestionAnswersLabel(answers)),
        'pc-approved-card'
      );
    });

    var skipBtn = document.createElement('button');
    skipBtn.className = 'btn btn-secondary btn-xs';
    skipBtn.textContent = 'Пропустить';
    skipBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'questionResult',
        result: {
          kind: 'question',
          confirmId: request.confirmId,
          answered: false,
          answers: {}
        }
      });
      resolveCard(
        el,
        Array.prototype.slice.call(el.querySelectorAll('input, textarea')),
        buildResolvedStatusHtml('pc-status pc-rejected', 'Ответ не выбран', ''),
        'pc-rejected-card'
      );
    });

    actions.appendChild(submitBtn);
    actions.appendChild(skipBtn);
    el.appendChild(actions);

    findApprovalMount(messagesEl, request).appendChild(el);
    scrollToBottom(messagesEl);
  }

  function appendFileApproval(messagesEl, vscode, request) {
    var el = document.createElement('div');
    el.className = 'message step-block file-approval approval-request';
    el.dataset.confirmId = request.confirmId;
    el.dataset.approvalKind = 'file';
    el.dataset.changeType = request.changeType || '';

    var header = document.createElement('div');
    header.className = 'fa-header';
    header.textContent = request.title || buildFileChangeLabel(request.changeType);
    el.appendChild(header);

    if (request.description) {
      var desc = document.createElement('div');
      desc.className = 'pc-meta';
      desc.textContent = request.description;
      el.appendChild(desc);
    }

    appendMetaText(el, 'approval-summary', request.summary);

    var path = document.createElement('div');
    path.className = 'fa-path';
    path.textContent = request.filePath + (typeof request.cellIdx === 'number' ? ' [cell ' + request.cellIdx + ']' : '');
    el.appendChild(path);

    appendChipRow(el, [
      { text: buildFileChangeLabel(request.changeType), kind: request.changeType === 'delete' ? 'danger' : 'file' },
      typeof request.cellIdx === 'number' ? { text: 'ячейка ' + request.cellIdx, kind: 'notebook' } : null,
      request.language ? { text: request.language, kind: 'notebook' } : null,
      request.stats && Number.isFinite(request.stats.added) ? { text: '+' + request.stats.added, kind: 'add' } : null,
      request.stats && Number.isFinite(request.stats.removed) ? { text: '-' + request.stats.removed, kind: 'del' } : null,
      request.stats ? { text: (request.stats.beforeLines || 0) + ' -> ' + (request.stats.afterLines || 0) + ' строк', kind: 'lines' } : null,
      request.stats ? { text: formatBytes(request.stats.oldBytes || 0) + ' -> ' + formatBytes(request.stats.newBytes || 0), kind: 'bytes' } : null,
      request.stats && request.stats.changedLines ? { text: '~' + request.stats.changedLines + ' строк изменено', kind: 'delta' } : null
    ]);

    appendMetaText(el, 'fa-meta-row', buildFileChangeLabel(request.changeType));

    var diff = document.createElement('div');
    diff.className = 'approval-file-preview';
    appendSnippetBlock(diff, 'Было', 'is-old', request.oldSnippet || '');
    appendSnippetBlock(diff, 'Станет', 'is-new', request.newSnippet || '');
    if (diff.childElementCount > 0) {
      el.appendChild(diff);
    }

    var actions = document.createElement('div');
    actions.className = 'pc-actions';
    actions.dataset.approvalActions = 'true';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary btn-xs';
    approveBtn.textContent = buildFileApprovalActionLabel(request.changeType);
    approveBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'file',
          confirmId: request.confirmId,
          approved: true
        }
      });
      resolveCard(el, [], buildResolvedStatusHtml('pc-status pc-approved', 'Подтверждено, применяю изменение', request.filePath), 'pc-approved-card');
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-secondary btn-xs';
    rejectBtn.textContent = 'Отклонить';
    rejectBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'file',
          confirmId: request.confirmId,
          approved: false
        }
      });
      resolveCard(el, [], buildResolvedStatusHtml('pc-status pc-rejected', buildFileApprovalResolvedLabel(request.changeType, false), request.filePath), 'pc-rejected-card');
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    el.appendChild(actions);

    findApprovalMount(messagesEl, request).appendChild(el);
    scrollToBottom(messagesEl);
  }

  function appendWorktreeApproval(messagesEl, vscode, request) {
    var el = document.createElement('div');
    el.className = 'message step-block worktree-approval approval-request';
    el.dataset.confirmId = request.confirmId;
    el.dataset.approvalKind = 'worktree';
    el.dataset.worktreeAction = request.action || 'enter';

    var header = document.createElement('div');
    header.className = 'fa-header';
    header.textContent = request.title || buildWorktreeApprovalLabel(request.action);
    el.appendChild(header);

    if (request.description) {
      var desc = document.createElement('div');
      desc.className = 'pc-meta';
      desc.textContent = request.description;
      el.appendChild(desc);
    }

    appendMetaText(el, 'approval-summary', request.summary);
    appendChipRow(el, [
      { text: buildWorktreeApprovalLabel(request.action), kind: request.action === 'remove' ? 'danger' : 'file' },
      request.worktreeBranch ? { text: request.worktreeBranch, kind: 'cwd' } : null,
      request.slug ? { text: request.slug, kind: 'question-meta' } : null,
      request.destructive ? { text: 'может удалить worktree и ветку', kind: 'danger' } : null
    ]);

    if (request.worktreePath) {
      var worktreePath = document.createElement('div');
      worktreePath.className = 'fa-path';
      worktreePath.textContent = request.worktreePath;
      el.appendChild(worktreePath);
    }

    if (request.originalRootPath) {
      var originalRoot = document.createElement('div');
      originalRoot.className = 'pc-meta';
      originalRoot.textContent = 'Исходный root: ' + request.originalRootPath;
      el.appendChild(originalRoot);
    }

    var actions = document.createElement('div');
    actions.className = 'pc-actions';
    actions.dataset.approvalActions = 'true';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary btn-xs';
    approveBtn.textContent = buildWorktreeApproveLabel(request.action);
    approveBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'worktree',
          confirmId: request.confirmId,
          approved: true
        }
      });
      resolveCard(
        el,
        [],
        buildResolvedStatusHtml('pc-status pc-approved', 'Подтверждено, выполняю действие', request.worktreePath || request.originalRootPath || ''),
        'pc-approved-card'
      );
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-secondary btn-xs';
    rejectBtn.textContent = 'Отклонить';
    rejectBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'worktree',
          confirmId: request.confirmId,
          approved: false
        }
      });
      resolveCard(
        el,
        [],
        buildResolvedStatusHtml('pc-status pc-rejected', 'Отменено', request.worktreePath || request.originalRootPath || ''),
        'pc-rejected-card'
      );
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    el.appendChild(actions);

    findApprovalMount(messagesEl, request).appendChild(el);
    scrollToBottom(messagesEl);
  }

  function appendMcpApproval(messagesEl, vscode, request) {
    var el = document.createElement('div');
    el.className = 'message step-block worktree-approval approval-request';
    el.dataset.confirmId = request.confirmId;
    el.dataset.approvalKind = 'mcp';

    var header = document.createElement('div');
    header.className = 'fa-header';
    header.textContent = request.title || 'Подтвердите вызов MCP tool';
    el.appendChild(header);

    if (request.description) {
      var desc = document.createElement('div');
      desc.className = 'pc-meta';
      desc.textContent = request.description;
      el.appendChild(desc);
    }

    appendMetaText(el, 'approval-summary', request.summary);
    appendChipRow(el, [
      request.server ? { text: request.server, kind: 'cwd' } : null,
      request.mcpToolName ? { text: request.mcpToolName, kind: 'shell-kind' } : null,
      request.readOnlyHint ? { text: 'read-only hint', kind: 'safe' } : null,
      request.destructiveHint ? { text: 'destructive hint', kind: 'danger' } : { text: 'внешняя MCP операция', kind: 'caution' }
    ]);

    if (request.argsJson) {
      var argsEl = document.createElement('pre');
      argsEl.className = 'model-test-response';
      argsEl.textContent = request.argsJson;
      el.appendChild(argsEl);
    }

    var actions = document.createElement('div');
    actions.className = 'pc-actions';
    actions.dataset.approvalActions = 'true';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary btn-xs';
    approveBtn.textContent = request.readOnlyHint ? 'Разрешить вызов' : 'Разрешить внешнюю операцию';
    approveBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'mcp',
          confirmId: request.confirmId,
          approved: true
        }
      });
      resolveCard(
        el,
        [],
        buildResolvedStatusHtml('pc-status pc-approved', 'Подтверждено, вызываю MCP tool', (request.server || '') + (request.mcpToolName ? ' • ' + request.mcpToolName : '')),
        'pc-approved-card'
      );
    });

    var alwaysAllowBtn = document.createElement('button');
    alwaysAllowBtn.className = 'btn btn-secondary btn-xs';
    alwaysAllowBtn.textContent = 'Всегда разрешать';
    alwaysAllowBtn.title = 'Больше не спрашивать подтверждение для этой утилиты на этом MCP сервере';
    alwaysAllowBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'mcp',
          confirmId: request.confirmId,
          approved: true,
          rememberTool: true,
          server: request.server,
          mcpToolName: request.mcpToolName
        }
      });
      resolveCard(
        el,
        [],
        buildResolvedStatusHtml('pc-status pc-approved', 'Разрешено и сохранено для этой утилиты', (request.server || '') + (request.mcpToolName ? ' • ' + request.mcpToolName : '')),
        'pc-approved-card'
      );
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-secondary btn-xs';
    rejectBtn.textContent = 'Отклонить';
    rejectBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'mcp',
          confirmId: request.confirmId,
          approved: false
        }
      });
      resolveCard(
        el,
        [],
        buildResolvedStatusHtml('pc-status pc-rejected', 'Отменено', (request.server || '') + (request.mcpToolName ? ' • ' + request.mcpToolName : '')),
        'pc-rejected-card'
      );
    });

    actions.appendChild(approveBtn);
    actions.appendChild(alwaysAllowBtn);
    actions.appendChild(rejectBtn);
    el.appendChild(actions);

    findApprovalMount(messagesEl, request).appendChild(el);
    scrollToBottom(messagesEl);
  }

  function appendWebApproval(messagesEl, vscode, request) {
    var el = document.createElement('div');
    el.className = 'message step-block worktree-approval approval-request';
    el.dataset.confirmId = request.confirmId;
    el.dataset.approvalKind = 'web';

    var header = document.createElement('div');
    header.className = 'fa-header';
    header.textContent = request.title || 'Подтвердите загрузку URL';
    el.appendChild(header);

    if (request.description) {
      var desc = document.createElement('div');
      desc.className = 'pc-meta';
      desc.textContent = request.description;
      el.appendChild(desc);
    }

    appendMetaText(el, 'approval-summary', request.summary);
    appendChipRow(el, [
      request.host ? { text: request.host, kind: 'cwd' } : null,
      request.trustKind === 'external' ? { text: 'внешний host', kind: 'caution' } : null,
      request.prompt ? { text: 'с извлечением ответа', kind: 'question-meta' } : { text: 'только чтение URL', kind: 'safe' }
    ]);

    if (request.url) {
      var urlEl = document.createElement('div');
      urlEl.className = 'fa-path';
      urlEl.textContent = request.url;
      el.appendChild(urlEl);
    }

    if (request.prompt) {
      var promptEl = document.createElement('pre');
      promptEl.className = 'model-test-response';
      promptEl.textContent = 'prompt: ' + request.prompt;
      el.appendChild(promptEl);
    }

    var actions = document.createElement('div');
    actions.className = 'pc-actions';
    actions.dataset.approvalActions = 'true';

    var approveBtn = document.createElement('button');
    approveBtn.className = 'btn btn-primary btn-xs';
    approveBtn.textContent = 'Открыть URL';
    approveBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'web',
          confirmId: request.confirmId,
          approved: true
        }
      });
      resolveCard(
        el,
        [],
        buildResolvedStatusHtml('pc-status pc-approved', 'URL разрешён', request.url || request.host || ''),
        'pc-approved-card'
      );
    });

    var allowHostBtn = document.createElement('button');
    allowHostBtn.className = 'btn btn-secondary btn-xs';
    allowHostBtn.textContent = 'Всегда разрешать домен';
    allowHostBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'web',
          confirmId: request.confirmId,
          approved: true,
          rememberHost: true
        }
      });
      resolveCard(
        el,
        [],
        buildResolvedStatusHtml('pc-status pc-approved', 'Домен сохранён как доверенный', request.host || request.url || ''),
        'pc-approved-card'
      );
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'btn btn-secondary btn-xs';
    rejectBtn.textContent = 'Отклонить';
    rejectBtn.addEventListener('click', function () {
      vscode.postMessage({
        type: 'approvalResult',
        result: {
          kind: 'web',
          confirmId: request.confirmId,
          approved: false
        }
      });
      resolveCard(
        el,
        [],
        buildResolvedStatusHtml('pc-status pc-rejected', 'URL отклонён', request.url || request.host || ''),
        'pc-rejected-card'
      );
    });

    actions.appendChild(approveBtn);
    actions.appendChild(allowHostBtn);
    actions.appendChild(rejectBtn);
    el.appendChild(actions);

    findApprovalMount(messagesEl, request).appendChild(el);
    scrollToBottom(messagesEl);
  }

  function createApprovalController(ctx) {
    var messagesEl = ctx.messagesEl;
    var vscode = ctx.vscode;

    function appendApprovalRequest(request) {
      if (!request || !request.kind || !request.confirmId) return;
      if (request.kind === 'shell') {
        appendShellApproval(messagesEl, vscode, request);
        return;
      }
      if (request.kind === 'plan') {
        appendPlanApproval(messagesEl, vscode, request);
        return;
      }
      if (request.kind === 'file') {
        appendFileApproval(messagesEl, vscode, request);
        return;
      }
      if (request.kind === 'worktree') {
        appendWorktreeApproval(messagesEl, vscode, request);
        return;
      }
      if (request.kind === 'mcp') {
        appendMcpApproval(messagesEl, vscode, request);
        return;
      }
      if (request.kind === 'web') {
        appendWebApproval(messagesEl, vscode, request);
      }
    }

    function appendQuestionRequest(request) {
      if (!request || !request.confirmId) return;
      renderQuestionRequest(messagesEl, vscode, request);
    }

    function resolveApproval(result) {
      if (!result || !result.confirmId || !result.kind) return;
      var el = findApprovalCard(messagesEl, result.confirmId);
      if (!el || el.classList.contains('pc-resolved') || el.classList.contains('sc-resolved')) return;

      if (result.kind === 'shell') {
        var shellInput = el.querySelector('.sc-cmd-input');
        var shellStatus = result.cancelled
          ? buildApprovalCancelledLabel('shell')
          : (result.approved ? (result.reason === 'auto_approved' ? 'Авторазрешено' : 'Подтверждено') : 'Отменено');
        resolveCard(
          el,
          shellInput ? [shellInput] : [],
          buildResolvedStatusHtml(
            result.approved ? 'sc-status sc-approved' : 'sc-status sc-denied',
            shellStatus,
            result.command || (shellInput && shellInput.value) || ''
          ),
          result.approved ? 'sc-approved-card' : 'sc-rejected-card'
        );
        return;
      }

      if (result.kind === 'plan') {
        var planInput = el.querySelector('.pc-plan-input');
        var feedbackInput = el.querySelector('.pc-feedback-input');
        var planStatus = result.cancelled
          ? buildApprovalCancelledLabel('plan')
          : (result.approved ? (result.reason === 'auto_approved' ? 'План утверждён автоматически' : 'План утверждён') : 'Согласование отменено');
        resolveCard(
          el,
          [planInput, feedbackInput],
          buildResolvedStatusHtml(
            result.approved ? 'pc-status pc-approved' : 'pc-status pc-rejected',
            planStatus,
            result.cancelled ? (result.reason || '') : (result.feedback || '')
          ),
          result.approved ? 'pc-approved-card' : 'pc-rejected-card'
        );
        return;
      }

      if (result.kind === 'file') {
        var fileStatus = result.cancelled
          ? buildApprovalCancelledLabel('file', el.dataset.changeType || '')
          : (result.reason === 'auto_approved' && result.approved
            ? buildAutoFileApprovalResolvedLabel(el.dataset.changeType || '')
            : buildFileApprovalResolvedLabel(el.dataset.changeType || '', !!result.approved));
        resolveCard(
          el,
          [],
          buildResolvedStatusHtml(
            result.approved ? 'pc-status pc-approved' : 'pc-status pc-rejected',
            fileStatus,
            el.querySelector('.fa-path') ? el.querySelector('.fa-path').textContent : ''
          ),
          result.approved ? 'pc-approved-card' : 'pc-rejected-card'
        );
        return;
      }

      if (result.kind === 'worktree') {
        var worktreeAction = el.dataset.worktreeAction || 'enter';
        var worktreeStatus = result.cancelled
          ? buildApprovalCancelledLabel('worktree')
          : (result.reason === 'auto_approved' && result.approved
            ? buildAutoWorktreeResolvedLabel(worktreeAction)
            : buildWorktreeResolvedLabel(worktreeAction, !!result.approved));
        resolveCard(
          el,
          [],
          buildResolvedStatusHtml(
            result.approved ? 'pc-status pc-approved' : 'pc-status pc-rejected',
            worktreeStatus,
            el.querySelector('.fa-path') ? el.querySelector('.fa-path').textContent : ''
          ),
          result.approved ? 'pc-approved-card' : 'pc-rejected-card'
        );
        return;
      }

      if (result.kind === 'mcp') {
        var mcpStatus = result.cancelled
          ? buildApprovalCancelledLabel('mcp')
          : (result.approved
            ? (result.reason === 'auto_approved' ? 'Вызов MCP авторазрешён' : 'Вызов MCP разрешён')
            : 'Вызов MCP отменён');
        resolveCard(
          el,
          [],
          buildResolvedStatusHtml(
            result.approved ? 'pc-status pc-approved' : 'pc-status pc-rejected',
            mcpStatus,
            compactInline(el.textContent || '', 120)
          ),
          result.approved ? 'pc-approved-card' : 'pc-rejected-card'
        );
        return;
      }

      if (result.kind === 'web') {
        var webStatus = result.cancelled
          ? buildApprovalCancelledLabel('web')
          : (result.approved
            ? (result.reason === 'auto_approved'
              ? 'URL авторазрешён'
              : (result.rememberHost ? 'Домен разрешён и сохранён' : 'URL разрешён'))
            : 'URL отклонён');
        resolveCard(
          el,
          [],
          buildResolvedStatusHtml(
            result.approved ? 'pc-status pc-approved' : 'pc-status pc-rejected',
            webStatus,
            compactInline(el.textContent || '', 140)
          ),
          result.approved ? 'pc-approved-card' : 'pc-rejected-card'
        );
      }
    }

    function resolveQuestion(result) {
      if (!result || !result.confirmId) return;
      var el = findApprovalCard(messagesEl, result.confirmId);
      if (!el || el.classList.contains('pc-resolved') || el.classList.contains('sc-resolved')) return;
      var status = result.cancelled
        ? buildApprovalCancelledLabel('question')
        : (result.answered ? 'Ответ получен' : 'Ответ не выбран');
      resolveCard(
        el,
        Array.prototype.slice.call(el.querySelectorAll('input, textarea')),
        buildResolvedStatusHtml(
          result.answered ? 'pc-status pc-approved' : 'pc-status pc-rejected',
          status,
          result.cancelled ? (result.reason || '') : buildQuestionAnswersLabel(result.answers || {})
        ),
        result.answered ? 'pc-approved-card' : 'pc-rejected-card'
      );
    }

    return {
      appendApprovalRequest: appendApprovalRequest,
      resolveApproval: resolveApproval,
      appendQuestionRequest: appendQuestionRequest,
      resolveQuestion: resolveQuestion,
    };
  }

  window.ChatApprovals = {
    createApprovalController: createApprovalController,
  };
})();
