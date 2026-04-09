(function () {
  'use strict';

  function pluralize(count) {
    var mod10 = count % 10;
    var mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return count + ' задача';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return count + ' задачи';
    return count + ' задач';
  }

  function createTodoController(options) {
    var panelEl = options.panelEl;
    var listEl = options.listEl;
    var metaEl = options.metaEl;
    var visible = false;
    var currentTodos = [];

    function render() {
      var items = Array.isArray(currentTodos) ? currentTodos.slice() : [];
      if (!panelEl || !listEl || !metaEl) return;

      listEl.innerHTML = '';
      panelEl.classList.toggle('hidden', !visible || items.length === 0);
      metaEl.textContent = items.length === 0
        ? 'Нет активных задач'
        : pluralize(items.length);

      items.forEach(function (todo) {
        var row = document.createElement('div');
        row.className = 'todo-item todo-' + todo.status;

        var dot = document.createElement('span');
        dot.className = 'todo-dot';
        dot.textContent = todo.status === 'completed' ? '·' : todo.status === 'in_progress' ? '•' : '○';

        var text = document.createElement('span');
        text.className = 'todo-text';
        text.textContent = todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content;
        text.title = todo.content;

        row.appendChild(dot);
        row.appendChild(text);
        listEl.appendChild(row);
      });
    }

    return {
      setTodos: function (todos) {
        currentTodos = Array.isArray(todos) ? todos.slice() : [];
        render();
      },
      setVisible: function (nextVisible) {
        visible = !!nextVisible;
        render();
      }
    };
  }

  window.ChatTodos = {
    createTodoController: createTodoController
  };
})();
