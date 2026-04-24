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
    var lastTaskScopeKey = '';
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
    var tfs = {
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
      ? createJiraProjectPicker(jiraProjectSelectEl, function (scope) {
          if (busy) return;
          vscode.postMessage({
            type: 'selectTaskProject',
            source: scope && scope.source ? scope.source : 'free',
            projectKey: scope && scope.projectKey ? scope.projectKey : ''
          });
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

    function normalizeTfsState(value) {
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

    function isTaskMode() {
      return mode === 'jira' || mode === 'tfs';
    }

    function getActiveTaskState() {
      return mode === 'tfs' ? tfs : jira;
    }

    function encodeTaskScopeValue(source, projectKey) {
      if (!source || source === 'free' || !projectKey) return '';
      return source + ':' + encodeURIComponent(String(projectKey));
    }

    function parseTaskScopeValue(value) {
      var text = String(value || '');
      var match = text.match(/^(jira|tfs):(.*)$/);
      if (!match) return { source: 'free', projectKey: '' };
      try {
        return { source: match[1], projectKey: decodeURIComponent(match[2] || '') };
      } catch (error) {
        return { source: match[1], projectKey: match[2] || '' };
      }
    }

    function getSelectedTaskScopeValue() {
      if (mode === 'jira') return encodeTaskScopeValue('jira', jira.selectedProjectKey);
      if (mode === 'tfs') return encodeTaskScopeValue('tfs', tfs.selectedProjectKey);
      return '';
    }

    function getTaskScopeOptions() {
      var items = [];
      jira.projects.forEach(function (project) {
        items.push({
          source: 'jira',
          key: String(project.key || ''),
          name: String(project.name || ''),
          url: String(project.url || '')
        });
      });
      tfs.projects.forEach(function (project) {
        var key = String(project.key || project.name || '');
        items.push({
          source: 'tfs',
          key: key,
          name: String(project.name || key),
          url: String(project.url || ''),
          description: String(project.description || '')
        });
      });
      return items.filter(function (project) { return project.key; });
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
      trigger.title = 'Выбрать обычный чат, проект Jira или проект TFS';

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
      searchInput.placeholder = 'Найти проект Jira или TFS...';
      searchInput.spellcheck = false;
      dropdown.appendChild(searchInput);

      var list = document.createElement('div');
      list.className = 'jira-project-dropdown-list';
      dropdown.appendChild(list);

      function getProjectLabel(project) {
        if (!project) return '';
        var source = project.source === 'tfs' ? 'TFS' : 'Jira';
        var key = project.key || '';
        var name = project.name && project.name !== key ? ' • ' + project.name : '';
        return source + ' • ' + key + name;
      }

      function findProject(value) {
        var selected = String(value || '');
        return projects.find(function (project) {
          return encodeTaskScopeValue(project.source, project.key) === selected;
        }) || null;
      }

      function updateTrigger() {
        var project = selectedValue ? findProject(selectedValue) : null;
        if (selectedValue && project) {
          triggerText.textContent = getProjectLabel(project);
          trigger.classList.remove('placeholder');
        } else if (selectedValue) {
          var scope = parseTaskScopeValue(selectedValue);
          var source = scope.source === 'tfs' ? 'TFS' : scope.source === 'jira' ? 'Jira' : '';
          triggerText.textContent = [source, scope.projectKey || selectedValue].filter(Boolean).join(' • ');
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
        if (!silent && typeof onSelect === 'function') onSelect(parseTaskScopeValue(selectedValue));
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
        return [project.source, project.key, project.name, project.url, project.description].some(function (value) {
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
          var value = encodeTaskScopeValue(project.source, key);
          var option = document.createElement('div');
          option.className = 'jira-project-option' + (selectedValue === value ? ' selected' : '');
          option.dataset.projectKey = key;
          option.dataset.scopeValue = value;
          option.title = getProjectLabel(project);

          var keyEl = document.createElement('span');
          keyEl.className = 'jira-project-option-key';
          keyEl.textContent = project.source === 'tfs' ? 'TFS' : 'Jira';
          option.appendChild(keyEl);

          var label = key + (project.name && project.name !== key ? ' • ' + project.name : '');
          if (label) {
            var nameEl = document.createElement('span');
            nameEl.className = 'jira-project-option-name';
            nameEl.textContent = label;
            option.appendChild(nameEl);
          }

          option.addEventListener('mousedown', function (event) {
            event.preventDefault();
            select(this.dataset.scopeValue || '');
          });
          list.appendChild(option);
          shown++;
        });

        if (shown === 0 && projects.length === 0) {
          var empty = document.createElement('div');
          empty.className = 'jira-project-dropdown-empty';
          empty.textContent = jira.projectsLoading || tfs.projectsLoading ? 'Загружаю проекты...' : 'Проекты Jira/TFS не загружены';
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
          var first = list.querySelector('.jira-project-option[data-scope-value]');
          if (first) select(first.dataset.scopeValue || '');
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
      var selectedScopeValue = getSelectedTaskScopeValue();
      var scopeOptions = getTaskScopeOptions();
      if (jiraProjectSelectEl) {
        var previous = jiraProjectSelectEl.value;
        jiraProjectSelectEl.innerHTML = '';
        var freeOption = document.createElement('option');
        freeOption.value = '';
        freeOption.textContent = 'Обычный чат';
        jiraProjectSelectEl.appendChild(freeOption);

        var jiraGroup = document.createElement('optgroup');
        jiraGroup.label = 'Jira';
        var hasJira = false;
        scopeOptions.filter(function (project) { return project.source === 'jira'; }).forEach(function (project) {
          var option = document.createElement('option');
          option.value = encodeTaskScopeValue('jira', project.key);
          option.textContent = project.key + (project.name && project.name !== project.key ? ' • ' + project.name : '');
          jiraGroup.appendChild(option);
          hasJira = true;
        });
        if (hasJira) jiraProjectSelectEl.appendChild(jiraGroup);

        var tfsGroup = document.createElement('optgroup');
        tfsGroup.label = 'TFS';
        var hasTfs = false;
        scopeOptions.filter(function (project) { return project.source === 'tfs'; }).forEach(function (project) {
          var option = document.createElement('option');
          option.value = encodeTaskScopeValue('tfs', project.key);
          option.textContent = project.key + (project.name && project.name !== project.key ? ' • ' + project.name : '');
          tfsGroup.appendChild(option);
          hasTfs = true;
        });
        if (hasTfs) jiraProjectSelectEl.appendChild(tfsGroup);

        jiraProjectSelectEl.value = selectedScopeValue;
        if (jiraProjectSelectEl.value !== selectedScopeValue) {
          jiraProjectSelectEl.value = previous && !selectedScopeValue ? previous : '';
        }
        jiraProjectSelectEl.disabled = busy || jira.projectsLoading || tfs.projectsLoading;
      }
      if (jiraProjectPicker) {
        jiraProjectPicker.setProjects(scopeOptions);
        jiraProjectPicker.setValue(selectedScopeValue);
        jiraProjectPicker.setDisabled(busy || jira.projectsLoading || tfs.projectsLoading);
      }

      if (jiraRefreshBtn) {
        var refreshBusy = jira.projectsLoading || jira.tasksLoading || tfs.projectsLoading || tfs.tasksLoading;
        jiraRefreshBtn.disabled = busy || refreshBusy;
        jiraRefreshBtn.textContent = refreshBusy ? '…' : '↻';
      }

      if (jiraStatusEl) {
        var text = 'Обычный режим: чаты не связаны с задачами.';
        var tone = 'idle';
        if (jira.projectsLoading || tfs.projectsLoading) {
          text = 'Проверяю авторизацию Jira/TFS и загружаю проекты...';
          tone = 'loading';
        } else if (mode === 'jira' && jira.error) {
          text = jira.error;
          tone = 'error';
        } else if (mode === 'tfs' && tfs.error) {
          text = tfs.error;
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
        } else if (mode === 'tfs') {
          text = tfs.tasksLoading
            ? 'Загружаю work items проекта...'
            : 'TFS: ' + (tfs.selectedProjectKey || 'проект') + (tfs.authUser ? ' • ' + tfs.authUser : '');
          if (tfs.tasksError) {
            text = tfs.tasksError;
            tone = 'error';
          } else {
            tone = 'ok';
          }
        } else if ((jira.authOk && jira.authUser) || (tfs.authOk && tfs.authUser)) {
          var auth = [];
          if (jira.authOk && jira.authUser) auth.push('Jira: ' + jira.authUser);
          if (tfs.authOk && tfs.authUser) auth.push('TFS: ' + tfs.authUser);
          text = auth.join(' • ') + '. Выберите проект, чтобы открыть задачи как чаты.';
          tone = 'ok';
        } else if (jira.error || tfs.error) {
          text = [jira.error ? 'Jira: ' + jira.error : '', tfs.error ? 'TFS: ' + tfs.error : ''].filter(Boolean).join(' • ');
          tone = 'error';
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
      var source = session && session.source && (session.source.type === 'jira' || session.source.type === 'tfs') ? session.source : {};
      return [
        session && session.title,
        session && session.preview,
        source.issueKey,
        source.issueTitle,
        source.issueStatus,
        source.issueDescription,
        source.workItemId,
        source.workItemTitle,
        source.workItemStatus,
        source.workItemDescription,
        source.workItemType,
        source.projectKey,
        source.projectName
      ].some(function (value) {
        return String(value || '').toLowerCase().indexOf(query) !== -1;
      });
    }

    function getVisibleSessions() {
      if (!isTaskMode()) return sessions;
      var query = normalizeQuery(taskFilter);
      return sessions.filter(function (session) {
        return sessionMatchesQuery(session, query);
      });
    }

    function buildSessionHoverTitle(session) {
      var source = session && session.source && (session.source.type === 'jira' || session.source.type === 'tfs') ? session.source : null;
      if (!source) return (session && (session.preview || session.title)) || '';
      if (source.type === 'tfs') {
        return [
          source.workItemId ? 'Work item: #' + source.workItemId : '',
          source.workItemTitle ? 'Название: ' + source.workItemTitle : '',
          source.workItemStatus ? 'Статус: ' + source.workItemStatus : '',
          source.workItemType ? 'Тип: ' + source.workItemType : '',
          source.projectKey ? 'Проект: ' + source.projectKey + (source.projectName ? ' • ' + source.projectName : '') : '',
          source.workItemUrl ? 'URL: ' + source.workItemUrl : '',
          source.workItemDescription ? 'Описание: ' + source.workItemDescription : ''
        ].filter(Boolean).join('\n');
      }
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
      var status = '';
      if (session && session.source && session.source.type === 'jira') {
        status = String(session.source.issueStatus || '').trim();
      } else if (session && session.source && session.source.type === 'tfs') {
        status = String(session.source.workItemStatus || '').trim();
      }
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
      var isTfs = session.source && session.source.type === 'tfs';
      item.className = 'chat-session-chip' + (session.id === activeId ? ' is-active' : '') + (isJira ? ' is-jira' : '') + (isTfs ? ' is-tfs' : '');
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
        : isTfs
        ? [
            session.source.workItemStatus || session.source.workItemType || 'TFS',
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

      if (!isJira && !isTfs) {
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
        } else if (active.source && active.source.type === 'tfs') {
          activeMeta.unshift(active.source.workItemId ? '#' + active.source.workItemId : 'TFS');
          if (active.source.workItemStatus) activeMeta.push(active.source.workItemStatus);
        }
        var updatedLabel = formatRelativeTime(active.updatedAt);
        if (updatedLabel) activeMeta.push(updatedLabel);
        metaEl.textContent = activeMeta.join(' • ');
      } else {
        metaEl.textContent = mode === 'jira'
          ? 'Выберите задачу Jira'
          : mode === 'tfs'
          ? 'Выберите work item TFS'
          : 'Нет сохранённых чатов';
      }

      if (taskSearchWrapEl) {
        taskSearchWrapEl.classList.toggle('hidden', !isTaskMode());
        if (taskSearchInputEl && document.activeElement !== taskSearchInputEl) {
          taskSearchInputEl.value = taskFilter;
        }
        if (taskSearchInputEl) {
          taskSearchInputEl.disabled = busy || getActiveTaskState().tasksLoading;
          taskSearchInputEl.placeholder = sessions.length
            ? 'Найти задачу по ключу, названию, статусу...'
            : 'Задачи появятся после выбора проекта';
          taskSearchInputEl.title = isTaskMode() && taskFilter
            ? 'Показано ' + visibleSessions.length + ' из ' + sessions.length
            : 'Поиск по задачам Jira/TFS';
        }
      }

      if (visibleSessions.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'chat-session-empty';
        empty.textContent = isTaskMode()
          ? (taskFilter
              ? 'Задачи по запросу не найдены.'
              : getActiveTaskState().tasksLoading
              ? 'Загружаю задачи выбранного проекта...'
              : (getActiveTaskState().tasksError || 'В выбранном проекте нет ваших задач.'))
          : 'Чаты появятся здесь после первого запуска агента.';
        listEl.appendChild(empty);
      }

      if (isTaskMode()) {
        renderJiraSessionGroups(visibleSessions);
      } else {
        visibleSessions.forEach(function (session) {
          renderSessionItem(session, listEl);
        });
      }

      if (newBtn) {
        newBtn.disabled = busy || isTaskMode();
        newBtn.textContent = isTaskMode() ? 'Выберите задачу' : 'Создать чат';
        newBtn.title = isTaskMode() ? 'В режиме задач чат открывается выбором задачи.' : 'Создать обычный чат';
      }
      if (quickNewBtn) quickNewBtn.disabled = busy || isTaskMode();
      if (clearBtn) clearBtn.disabled = busy;
      renderJiraScope();
    }

    function handleCreateConversation() {
      if (busy || isTaskMode()) return;
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
        var scope = parseTaskScopeValue(jiraProjectSelectEl.value || '');
        vscode.postMessage({ type: 'selectTaskProject', source: scope.source, projectKey: scope.projectKey });
      });
    }

    if (jiraRefreshBtn) {
      jiraRefreshBtn.addEventListener('click', function () {
        if (busy) return;
        vscode.postMessage({ type: 'refreshTaskProjects' });
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
        mode = message.mode === 'jira' || message.mode === 'tfs' ? message.mode : 'free';
        jira = normalizeJiraState(message.jira);
        tfs = normalizeTfsState(message.tfs);
        var nextTaskScopeKey = mode + ':' + (mode === 'tfs' ? tfs.selectedProjectKey : mode === 'jira' ? jira.selectedProjectKey : '');
        if (lastTaskScopeKey !== nextTaskScopeKey) {
          taskFilter = '';
          if (taskSearchInputEl) taskSearchInputEl.value = '';
          lastTaskScopeKey = nextTaskScopeKey;
        }
        render();
      },
    };
  }

  window.ChatSessions = {
    createSessionController: createSessionController,
  };
})();
