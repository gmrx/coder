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
    var jiraProjectSelectEl = options.jiraProjectSelectEl;
    var jiraRefreshBtn = options.jiraRefreshBtn;
    var jiraStatusEl = options.jiraStatusEl;
    var newBtn = options.newBtn;
    var quickNewBtn = options.quickNewBtn;
    var clearBtn = options.clearBtn;
    var activeId = '';
    var sessions = [];
    var mode = 'free';
    var taskFilter = '';
    var taskSearchWrapEl = null;
    var taskSearchInputEl = null;
    var lastJiraProjectKey = '';
    var jira = {
      selectedProjectKey: '',
      selectedProjectName: '',
      authOk: false,
      authUser: '',
      error: '',
      projectsLoading: false,
      tasksLoading: false,
      tasksError: '',
      projects: []
    };
    var busy = false;
    var jiraProjectPicker = jiraProjectSelectEl
      ? createJiraProjectPicker(jiraProjectSelectEl, function (projectKey) {
          if (busy) return;
          vscode.postMessage({ type: 'selectJiraProject', projectKey: projectKey || '' });
        })
      : null;

    function normalizeJiraState(value) {
      var source = value && typeof value === 'object' ? value : {};
      return {
        selectedProjectKey: String(source.selectedProjectKey || ''),
        selectedProjectName: String(source.selectedProjectName || ''),
        authOk: source.authOk === true,
        authUser: String(source.authUser || ''),
        error: String(source.error || ''),
        projectsLoading: source.projectsLoading === true,
        tasksLoading: source.tasksLoading === true,
        tasksError: String(source.tasksError || ''),
        projects: Array.isArray(source.projects) ? source.projects.slice() : []
      };
    }

    function createJiraProjectPicker(selectEl, onSelect) {
      var row = selectEl.parentElement;
      var projects = [];
      var selectedValue = selectEl.value || '';
      var disabled = false;

      selectEl.classList.add('is-native-hidden');
      selectEl.setAttribute('aria-hidden', 'true');
      selectEl.tabIndex = -1;

      var trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'jira-project-picker-trigger placeholder';
      trigger.title = 'Выбрать проект Jira или обычный чат';

      var triggerText = document.createElement('span');
      triggerText.className = 'jira-project-picker-text';
      trigger.appendChild(triggerText);

      var arrow = document.createElement('span');
      arrow.className = 'jira-project-picker-arrow';
      arrow.textContent = '▼';
      trigger.appendChild(arrow);

      if (row) row.insertBefore(trigger, selectEl);

      var dropdown = document.createElement('div');
      dropdown.className = 'jira-project-dropdown';
      document.body.appendChild(dropdown);

      var searchInput = document.createElement('input');
      searchInput.className = 'jira-project-dropdown-search';
      searchInput.placeholder = 'Найти проект Jira...';
      searchInput.spellcheck = false;
      dropdown.appendChild(searchInput);

      var list = document.createElement('div');
      list.className = 'jira-project-dropdown-list';
      dropdown.appendChild(list);

      function getProjectLabel(project) {
        if (!project) return '';
        return (project.key || '') + (project.name ? ' • ' + project.name : '');
      }

      function findProject(value) {
        var key = String(value || '').toUpperCase();
        return projects.find(function (project) {
          return String(project.key || '').toUpperCase() === key;
        }) || null;
      }

      function updateTrigger() {
        var project = selectedValue ? findProject(selectedValue) : null;
        if (selectedValue && project) {
          triggerText.textContent = getProjectLabel(project);
          trigger.classList.remove('placeholder');
        } else if (selectedValue) {
          triggerText.textContent = selectedValue;
          trigger.classList.remove('placeholder');
        } else {
          triggerText.textContent = 'Обычный чат';
          trigger.classList.add('placeholder');
        }
        trigger.disabled = disabled;
      }

      function select(value, silent) {
        selectedValue = String(value || '');
        selectEl.value = selectedValue;
        updateTrigger();
        close();
        if (!silent && typeof onSelect === 'function') onSelect(selectedValue);
      }

      function position() {
        var rect = trigger.getBoundingClientRect();
        var viewportHeight = window.innerHeight;
        var maxHeight = 260;
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

      function projectMatches(project, query) {
        if (!query) return true;
        return [project.key, project.name, project.url].some(function (value) {
          return String(value || '').toLowerCase().indexOf(query) !== -1;
        });
      }

      function render(filter) {
        var query = String(filter || '').trim().toLowerCase();
        list.innerHTML = '';

        var free = document.createElement('div');
        free.className = 'jira-project-option none-option' + (!selectedValue ? ' selected' : '');
        free.textContent = 'Обычный чат';
        free.addEventListener('mousedown', function (event) {
          event.preventDefault();
          select('');
        });
        list.appendChild(free);

        var shown = 0;
        projects.forEach(function (project) {
          if (!projectMatches(project, query)) return;
          var key = String(project.key || '');
          var option = document.createElement('div');
          option.className = 'jira-project-option' + (String(selectedValue).toUpperCase() === key.toUpperCase() ? ' selected' : '');
          option.dataset.projectKey = key;
          option.title = getProjectLabel(project);

          var keyEl = document.createElement('span');
          keyEl.className = 'jira-project-option-key';
          keyEl.textContent = key || 'Jira';
          option.appendChild(keyEl);

          if (project.name) {
            var nameEl = document.createElement('span');
            nameEl.className = 'jira-project-option-name';
            nameEl.textContent = project.name;
            option.appendChild(nameEl);
          }

          option.addEventListener('mousedown', function (event) {
            event.preventDefault();
            select(this.dataset.projectKey || '');
          });
          list.appendChild(option);
          shown++;
        });

        if (shown === 0 && projects.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'jira-project-dropdown-empty';
          empty.textContent = jira.projectsLoading ? 'Загружаю проекты...' : 'Проекты Jira не загружены';
          list.appendChild(empty);
        } else if (shown === 0 && query) {
          var nothing = document.createElement('div');
          nothing.className = 'jira-project-dropdown-empty';
          nothing.textContent = 'Проекты не найдены';
          list.appendChild(nothing);
        }
      }

      function open() {
        if (disabled) return;
        position();
        dropdown.classList.add('open');
        searchInput.value = '';
        render('');
        setTimeout(function () { searchInput.focus(); }, 10);
      }

      function close() {
        dropdown.classList.remove('open');
      }

      trigger.addEventListener('click', function (event) {
        event.stopPropagation();
        if (dropdown.classList.contains('open')) close();
        else open();
      });
      searchInput.addEventListener('input', function () { render(searchInput.value); });
      searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          close();
        } else if (event.key === 'Enter') {
          var first = list.querySelector('.jira-project-option[data-project-key]');
          if (first) select(first.dataset.projectKey || '');
          else if (!searchInput.value.trim()) select('');
        }
      });
      dropdown.addEventListener('mousedown', function (event) { event.stopPropagation(); });
      dropdown.addEventListener('click', function (event) { event.stopPropagation(); });
      document.addEventListener('mousedown', close);
      window.addEventListener('resize', function () {
        if (dropdown.classList.contains('open')) position();
      });

      updateTrigger();
      return {
        setProjects: function (items) {
          projects = Array.isArray(items) ? items.slice() : [];
          updateTrigger();
          if (dropdown.classList.contains('open')) render(searchInput.value);
        },
        setValue: function (value) {
          selectedValue = String(value || '');
          selectEl.value = selectedValue;
          updateTrigger();
          if (dropdown.classList.contains('open')) render(searchInput.value);
        },
        setDisabled: function (value) {
          disabled = !!value;
          updateTrigger();
          if (disabled) close();
        },
        close: close
      };
    }

    function renderJiraScope() {
      if (jiraProjectSelectEl) {
        var previous = jiraProjectSelectEl.value;
        jiraProjectSelectEl.innerHTML = '';
        var freeOption = document.createElement('option');
        freeOption.value = '';
        freeOption.textContent = 'Обычный чат';
        jiraProjectSelectEl.appendChild(freeOption);
        jira.projects.forEach(function (project) {
          var option = document.createElement('option');
          option.value = project.key || '';
          option.textContent = (project.key || '') + (project.name ? ' • ' + project.name : '');
          jiraProjectSelectEl.appendChild(option);
        });
        jiraProjectSelectEl.value = jira.selectedProjectKey || '';
        if (jiraProjectSelectEl.value !== (jira.selectedProjectKey || '')) {
          jiraProjectSelectEl.value = previous && !jira.selectedProjectKey ? previous : '';
        }
        jiraProjectSelectEl.disabled = busy || jira.projectsLoading;
      }
      if (jiraProjectPicker) {
        jiraProjectPicker.setProjects(jira.projects);
        jiraProjectPicker.setValue(jira.selectedProjectKey || '');
        jiraProjectPicker.setDisabled(busy || jira.projectsLoading);
      }

      if (jiraRefreshBtn) {
        jiraRefreshBtn.disabled = busy || jira.projectsLoading || jira.tasksLoading;
        jiraRefreshBtn.textContent = jira.projectsLoading || jira.tasksLoading ? '…' : '↻';
      }

      if (jiraStatusEl) {
        var text = 'Обычный режим: чаты не связаны с Jira.';
        var tone = 'idle';
        if (jira.projectsLoading) {
          text = 'Проверяю авторизацию Jira и загружаю проекты...';
          tone = 'loading';
        } else if (jira.error) {
          text = jira.error;
          tone = 'error';
        } else if (mode === 'jira') {
          text = jira.tasksLoading
            ? 'Загружаю задачи проекта...'
            : 'Jira: ' + (jira.selectedProjectKey || 'проект') + (jira.authUser ? ' • ' + jira.authUser : '');
          if (jira.tasksError) {
            text = jira.tasksError;
            tone = 'error';
          } else {
            tone = 'ok';
          }
        } else if (jira.authOk && jira.authUser) {
          text = 'Jira авторизована: ' + jira.authUser + '. Выберите проект, чтобы открыть задачи как чаты.';
          tone = 'ok';
        }
        jiraStatusEl.textContent = text;
        jiraStatusEl.className = 'jira-chat-scope-status is-' + tone;
      }
    }

    function ensureTaskSearch() {
      if (taskSearchWrapEl || !listEl || !listEl.parentElement) return;
      taskSearchWrapEl = document.createElement('div');
      taskSearchWrapEl.className = 'jira-task-search hidden';

      taskSearchInputEl = document.createElement('input');
      taskSearchInputEl.className = 'jira-task-search-input';
      taskSearchInputEl.type = 'search';
      taskSearchInputEl.placeholder = 'Найти задачу...';
      taskSearchInputEl.spellcheck = false;
      taskSearchWrapEl.appendChild(taskSearchInputEl);

      listEl.parentElement.insertBefore(taskSearchWrapEl, listEl);
      taskSearchInputEl.addEventListener('input', function () {
        taskFilter = taskSearchInputEl.value || '';
        render();
      });
    }

    function normalizeQuery(value) {
      return String(value || '').trim().toLowerCase();
    }

    function sessionMatchesQuery(session, query) {
      if (!query) return true;
      var source = session && session.source && session.source.type === 'jira' ? session.source : {};
      return [
        session && session.title,
        session && session.preview,
        source.issueKey,
        source.issueTitle,
        source.issueStatus,
        source.issueDescription,
        source.projectKey,
        source.projectName
      ].some(function (value) {
        return String(value || '').toLowerCase().indexOf(query) !== -1;
      });
    }

    function getVisibleSessions() {
      if (mode !== 'jira') return sessions;
      var query = normalizeQuery(taskFilter);
      return sessions.filter(function (session) {
        return sessionMatchesQuery(session, query);
      });
    }

    function buildSessionHoverTitle(session) {
      var source = session && session.source && session.source.type === 'jira' ? session.source : null;
      if (!source) return (session && (session.preview || session.title)) || '';
      return [
        source.issueKey ? 'Задача: ' + source.issueKey : '',
        source.issueTitle ? 'Название: ' + source.issueTitle : '',
        source.issueStatus ? 'Статус: ' + source.issueStatus : '',
        source.projectKey ? 'Проект: ' + source.projectKey + (source.projectName ? ' • ' + source.projectName : '') : '',
        source.issueUrl ? 'URL: ' + source.issueUrl : '',
        source.issueDescription ? 'Описание: ' + source.issueDescription : ''
      ].filter(Boolean).join('\n');
    }

    function getSessionStatus(session) {
      var status = session && session.source && session.source.type === 'jira'
        ? String(session.source.issueStatus || '').trim()
        : '';
      return status || 'Без статуса';
    }

    function groupJiraSessionsByStatus(items) {
      var groups = [];
      var byStatus = Object.create(null);
      items.forEach(function (session) {
        var status = getSessionStatus(session);
        if (!byStatus[status]) {
          byStatus[status] = {
            status: status,
            sessions: []
          };
          groups.push(byStatus[status]);
        }
        byStatus[status].sessions.push(session);
      });
      return groups;
    }

    function renderSessionItem(session, targetEl) {
      var item = document.createElement('div');
      var isJira = session.source && session.source.type === 'jira';
      item.className = 'chat-session-chip' + (session.id === activeId ? ' is-active' : '') + (isJira ? ' is-jira' : '');
      item.title = buildSessionHoverTitle(session);

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'chat-session-main';
      button.disabled = busy || session.id === activeId;
      button.title = item.title;

      var title = document.createElement('span');
      title.className = 'chat-session-chip-title';
      title.textContent = session.title || 'Новый чат';

      var meta = document.createElement('span');
      meta.className = 'chat-session-chip-meta';
      meta.textContent = isJira
        ? [
            session.source.issueStatus || 'Jira',
            (session.messageCount || 0) + ' сообщ.',
            formatRelativeTime(session.updatedAt)
          ].filter(Boolean).join(' • ')
        : (session.messageCount || 0) + ' сообщ. • ' + formatRelativeTime(session.updatedAt);

      button.appendChild(title);
      button.appendChild(meta);
      button.addEventListener('click', function () {
        if (busy || session.id === activeId) return;
        vscode.postMessage({ type: 'switchConversation', conversationId: session.id });
      });

      item.appendChild(button);

      if (!isJira) {
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
        item.appendChild(deleteBtn);
      }

      targetEl.appendChild(item);
    }

    function renderJiraSessionGroups(items) {
      groupJiraSessionsByStatus(items).forEach(function (group) {
        var groupEl = document.createElement('section');
        groupEl.className = 'chat-session-status-group';

        var header = document.createElement('div');
        header.className = 'chat-session-status-header';

        var title = document.createElement('span');
        title.className = 'chat-session-status-title';
        title.textContent = group.status;

        var count = document.createElement('span');
        count.className = 'chat-session-status-count';
        count.textContent = String(group.sessions.length);

        header.appendChild(title);
        header.appendChild(count);
        groupEl.appendChild(header);

        var body = document.createElement('div');
        body.className = 'chat-session-status-list';
        group.sessions.forEach(function (session) {
          renderSessionItem(session, body);
        });
        groupEl.appendChild(body);
        listEl.appendChild(groupEl);
      });
    }

    function render() {
      if (!titleEl || !metaEl || !listEl) return;
      ensureTaskSearch();
      listEl.innerHTML = '';
      var visibleSessions = getVisibleSessions();

      var active = sessions.find(function (item) { return item.id === activeId; }) || sessions[0] || null;
      titleEl.textContent = active ? active.title : 'Новый чат';
      if (active) {
        var activeMeta = [(active.messageCount || 0) + ' сообщ.'];
        if (active.source && active.source.type === 'jira') {
          activeMeta.unshift(active.source.issueKey || 'Jira');
          if (active.source.issueStatus) activeMeta.push(active.source.issueStatus);
        }
        var updatedLabel = formatRelativeTime(active.updatedAt);
        if (updatedLabel) activeMeta.push(updatedLabel);
        metaEl.textContent = activeMeta.join(' • ');
      } else {
        metaEl.textContent = mode === 'jira' ? 'Выберите задачу Jira' : 'Нет сохранённых чатов';
      }

      if (taskSearchWrapEl) {
        taskSearchWrapEl.classList.toggle('hidden', mode !== 'jira');
        if (taskSearchInputEl && document.activeElement !== taskSearchInputEl) {
          taskSearchInputEl.value = taskFilter;
        }
        if (taskSearchInputEl) {
          taskSearchInputEl.disabled = busy || jira.tasksLoading;
          taskSearchInputEl.placeholder = sessions.length
            ? 'Найти задачу по ключу, названию, статусу...'
            : 'Задачи появятся после выбора проекта';
          taskSearchInputEl.title = mode === 'jira' && taskFilter
            ? 'Показано ' + visibleSessions.length + ' из ' + sessions.length
            : 'Поиск по задачам Jira';
        }
      }

      if (visibleSessions.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'chat-session-empty';
        empty.textContent = mode === 'jira'
          ? (taskFilter
              ? 'Задачи по запросу не найдены.'
              : jira.tasksLoading
              ? 'Загружаю задачи выбранного проекта...'
              : (jira.tasksError || 'В выбранном проекте нет ваших задач.'))
          : 'Чаты появятся здесь после первого запуска агента.';
        listEl.appendChild(empty);
      }

      if (mode === 'jira') {
        renderJiraSessionGroups(visibleSessions);
      } else {
        visibleSessions.forEach(function (session) {
          renderSessionItem(session, listEl);
        });
      }

      if (newBtn) {
        newBtn.disabled = busy || mode === 'jira';
        newBtn.textContent = mode === 'jira' ? 'Выберите задачу' : 'Создать чат';
        newBtn.title = mode === 'jira' ? 'В Jira-режиме чат открывается выбором задачи.' : 'Создать обычный чат';
      }
      if (quickNewBtn) quickNewBtn.disabled = busy || mode === 'jira';
      if (clearBtn) clearBtn.disabled = busy;
      renderJiraScope();
    }

    function handleCreateConversation() {
      if (busy || mode === 'jira') return;
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

    if (jiraProjectSelectEl) {
      jiraProjectSelectEl.addEventListener('change', function () {
        if (busy) return;
        vscode.postMessage({ type: 'selectJiraProject', projectKey: jiraProjectSelectEl.value || '' });
      });
    }

    if (jiraRefreshBtn) {
      jiraRefreshBtn.addEventListener('click', function () {
        if (busy) return;
        vscode.postMessage({ type: 'refreshJiraProjects' });
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
        mode = message.mode === 'jira' ? 'jira' : 'free';
        jira = normalizeJiraState(message.jira);
        if (lastJiraProjectKey !== jira.selectedProjectKey) {
          taskFilter = '';
          if (taskSearchInputEl) taskSearchInputEl.value = '';
          lastJiraProjectKey = jira.selectedProjectKey;
        }
        render();
      },
    };
  }

  window.ChatSessions = {
    createSessionController: createSessionController,
  };
})();
