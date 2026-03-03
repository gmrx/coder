export const TOOLS_DESCRIPTION = `
## Доступные утилиты

### scan_structure
Сканирует корневые папки workspace: директории верхнего уровня (с кол-вом файлов) и важные конфигурационные файлы.
Аргументы: нет
Пример: { "tool": "scan_structure" }

### list_files
Собирает полный список файлов проекта и строит файловое дерево (tree).
Аргументы: нет
Пример: { "tool": "list_files" }

### find_files
Ищет файлы по glob-паттерну. Результаты отсортированы по дате модификации (новые первыми).
Аргументы:
  - pattern (обязательно): glob-паттерн
  - target_directory (опционально): ограничить поиск директорией
Примеры:
  { "tool": "find_files", "args": { "pattern": "**/*.py" } }
  { "tool": "find_files", "args": { "pattern": "*.ts", "target_directory": "src" } }

### glob
Совместимый аналог поиска файлов по шаблону.
Аргументы:
  - glob_pattern (обязательно): glob-шаблон
  - target_directory (опционально): ограничить поиск директорией
Пример:
  { "tool": "glob", "args": { "glob_pattern": "*.ts", "target_directory": "src" } }

### detect_stack
Определяет языки, фреймворки, инфраструктуру и точки входа проекта.
Аргументы: нет
Пример: { "tool": "detect_stack" }

### grep
Поиск строки или regex с контекстом. Поддерживает multiline, пагинацию, фильтр по типу файлов.
Аргументы:
  - pattern (обязательно): строка или regex
  - path (опционально): файл для поиска в нём
  - paths (опционально): массив путей
  - type (опционально): тип файлов — "py", "ts", "js", "go", "rust", "java", "cpp", "html", "css", "json", "yaml", "sql" и др.
  - fileType (опционально): фильтр по расширению (альтернатива type)
  - ignoreCase (опционально): true для регистронезависимого
  - multiline (опционально): true для поиска через несколько строк
  - outputMode (опционально): "content" | "files_with_matches" | "count"
  - limit (опционально): макс. кол-во результатов
  - head_limit (опционально): синоним limit
  - offset (опционально): пропустить первые N (пагинация)
  - A / B / C (опционально): строки контекста после / до / вокруг
  - -A / -B / -C (опционально): те же параметры в формате rg
  - i (опционально): синоним ignoreCase
Примеры:
  { "tool": "grep", "args": { "pattern": "class Router" } }
  { "tool": "grep", "args": { "pattern": "@app.post", "path": "app/main.py" } }
  { "tool": "grep", "args": { "pattern": "TODO|FIXME", "ignoreCase": true } }
  { "tool": "grep", "args": { "pattern": "import", "type": "py", "outputMode": "count", "head_limit": 50 } }
  { "tool": "grep", "args": { "pattern": "class", "B": 1, "A": 5 } }

### read_file
Читает файл. Маленькие — целиком с номерами строк. Большие — умная выжимка: импорты + сигнатуры + релевантные блоки.
Аргументы:
  - path (обязательно): относительный путь
  - offset (опционально): номер строки (1-based, отрицательные = с конца)
  - limit (опционально): количество строк
Примеры:
  { "tool": "read_file", "args": { "path": "src/main.py" } }
  { "tool": "read_file", "args": { "path": "src/main.py", "offset": 100, "limit": 50 } }
  { "tool": "read_file", "args": { "path": "src/main.py", "offset": -20 } }

### read_file_range
Читает диапазон СТРОК из файла.
Аргументы: { "path": "путь", "startLine": номер, "endLine": номер }
Пример: { "tool": "read_file_range", "args": { "path": "src/main.py", "startLine": 50, "endLine": 150 } }

### str_replace
Выполняет точную замену строк в файлах.
Правила использования:
  - Сохраняй точные отступы (табы/пробелы) как в оригинальном файле
  - Замена ПРОВАЛИТСЯ, если old_string не уникальна. Используй больше окружающего контекста для уникальности, либо replace_all для замены всех
  - Используй replace_all для массового переименования (например, переменной во всём файле)
  - old_string ДОЛЖНА отличаться от new_string
  - Пустая old_string не допускается
  - Для создания нового файла используй write_file вместо str_replace
Аргументы:
  - path (обязательно): путь к файлу
  - old_string (обязательно): текст для замены (должен быть уникален в файле, если не replace_all)
  - new_string (обязательно): текст замены (должен отличаться от old_string)
  - replace_all (опционально, по умолчанию false): true для замены ВСЕХ вхождений old_string
При ошибке:
  - Не найдена: покажет похожие строки и номера строк для диагностики
  - Не уникальна: покажет все строки с вхождениями для добавления контекста
Примеры:
  { "tool": "str_replace", "args": { "path": "src/config.py", "old_string": "DEBUG = True", "new_string": "DEBUG = False" } }
  { "tool": "str_replace", "args": { "path": "src/main.py", "old_string": "old_name", "new_string": "new_name", "replace_all": true } }

### write_file
Создаёт новый файл или перезаписывает существующий целиком.
Правила использования:
  - Перезапишет существующий файл, если он есть по указанному пути
  - ВСЕГДА предпочитай str_replace для редактирования существующих файлов — write_file только для НОВЫХ файлов или полной перезаписи
  - Автоматически создаёт родительские директории, если их нет
  - Отчитывается: создан или перезаписан, количество строк и байт (для перезаписи — также старый размер)
Аргументы:
  - path (обязательно): путь файла
  - contents (обязательно): полное содержимое файла
Примеры:
  { "tool": "write_file", "args": { "path": "src/utils.py", "contents": "def helper():\\n    return True" } }
  { "tool": "write_file", "args": { "path": "tests/deep/nested/test_new.py", "contents": "import pytest\\n\\ndef test_example():\\n    assert True" } }

### delete_file
Удаляет файл. Операция завершится корректно, если:
  - Файл не существует (считается уже удалённым)
  - Операция отклонена по соображениям безопасности
  - Файл не может быть удалён (нет прав)
Аргументы: { "path": "путь" }
Пример: { "tool": "delete_file", "args": { "path": "old_file.py" } }

### edit_notebook
Редактирует ячейку Jupyter-ноутбука (.ipynb) или создаёт новую ячейку. ТОЛЬКО этот инструмент для редактирования ноутбуков.
Поддерживает:
  - Редактирование существующих ячеек: is_new_cell=false, указать old_string и new_string
  - Создание новых ячеек: is_new_cell=true, указать new_string (old_string оставить пустым)
  - Очистка ячейки (без удаления): new_string=""
  - Удаление ячеек НЕ поддерживается (можно только очистить)
Аргументы:
  - target_notebook (обязательно): путь к .ipynb файлу
  - cell_idx (обязательно): индекс ячейки (0-based)
  - is_new_cell (обязательно): true для создания, false для редактирования
  - cell_language (обязательно): 'python' | 'markdown' | 'javascript' | 'typescript' | 'r' | 'sql' | 'shell' | 'raw' | 'other'
  - old_string (обязательно для редактирования): текст для замены; должен быть УНИКАЛЕН внутри ячейки.
    Включай минимум 3-5 строк контекста до и после точки замены для уникальной идентификации.
  - new_string (обязательно): новый текст замены или содержимое новой ячейки
Правила:
  - old_string и new_string — чистый текст ячейки, БЕЗ JSON-синтаксиса ноутбука
  - Одна замена за вызов. Для нескольких замен — отдельные вызовы
  - Для каждого вызова old_string должен уникально идентифицировать место замены
  - Markdown-ячейки могут сохраняться как "raw" — это нормально
  - Индексы ячеек 0-based
Примеры:
  { "tool": "edit_notebook", "args": { "target_notebook": "analysis.ipynb", "cell_idx": 3, "is_new_cell": false, "cell_language": "python", "old_string": "plt.show()", "new_string": "plt.savefig('output.png')\\nplt.show()" } }
  { "tool": "edit_notebook", "args": { "target_notebook": "analysis.ipynb", "cell_idx": 0, "is_new_cell": true, "cell_language": "markdown", "old_string": "", "new_string": "# Analysis\\nData exploration notebook" } }
  { "tool": "edit_notebook", "args": { "target_notebook": "train.ipynb", "cell_idx": 5, "is_new_cell": false, "cell_language": "python", "old_string": "epochs = 10\\nbatch_size = 32", "new_string": "epochs = 50\\nbatch_size = 64" } }

### extract_symbols
Извлекает символы (классы, функции, интерфейсы) из файла с номерами строк.
Аргументы: { "path": "относительный/путь" }
Пример: { "tool": "extract_symbols", "args": { "path": "src/api/router.py" } }

### workspace_symbols
Ищет символы по имени во всём проекте (языковые серверы VS Code).
Аргументы: { "query": "имя или часть имени" }
Пример: { "tool": "workspace_symbols", "args": { "query": "Router" } }

### dependencies
Анализ зависимостей. Для кода (*.py, *.ts) — строит граф импортов. Для конфигов (package.json, requirements.txt) — показывает список пакетов.
Аргументы: { "paths": ["файл1.py", "файл2.py"] }
Примеры:
  { "tool": "dependencies", "args": { "paths": ["src/main.py", "src/config.py"] } }
  { "tool": "dependencies", "args": { "paths": ["package.json", "requirements.txt"] } }

### get_diagnostics
Ошибки и предупреждения (от линтеров/компиляторов).
Аргументы: { "path": "файл" } или { } для всех файлов
Пример: { "tool": "get_diagnostics", "args": { "path": "src/main.py" } }

### read_lints
Проверяет диагностические ошибки/предупреждения в IDE. Можно ограничить область.
Аргументы:
  - paths (опционально): массив файлов/директорий
  - path (опционально): один файл/директория
Примеры:
  { "tool": "read_lints", "args": {} }
  { "tool": "read_lints", "args": { "paths": ["src"] } }

### semantic_search
Семантический поиск по СМЫСЛУ (embeddings + reranker). Требует настроенную модель эмбеддингов.
Аргументы:
  - query (обязательно): вопрос на естественном языке
  - target_directory (опционально): ограничить поиск
  - limit (опционально): кол-во результатов (по умолч. 10)
Примеры:
  { "tool": "semantic_search", "args": { "query": "обработка ошибок авторизации" } }
  { "tool": "semantic_search", "args": { "query": "database connection", "target_directory": "backend/app" } }

### web_search
Реальный поиск в интернете (DuckDuckGo). Возвращает заголовки, URL и сниппеты.
Аргументы: { "query": "поисковый запрос" }
Пример: { "tool": "web_search", "args": { "query": "FastAPI middleware CORS" } }

### web_fetch
Загружает содержимое URL и конвертирует в текст (HTML очищается от тегов).
Аргументы: { "url": "https://..." }
Пример: { "tool": "web_fetch", "args": { "url": "https://fastapi.tiangolo.com/tutorial/" } }

### shell
Выполняет bash-команду в рабочей директории проекта. Таймаут 30с. Деструктивные команды заблокированы.
Аргументы:
  - command (обязательно): bash-команда
  - cwd (опционально): рабочая директория
Ограничения:
  - запрещены многострочные команды
  - блокируются опасные шаблоны (rm -rf /, sudo, force push и т.п.)
Примеры:
  { "tool": "shell", "args": { "command": "git log --oneline -10" } }
  { "tool": "shell", "args": { "command": "npm list --depth=0" } }

### subagent
Запускает подагента для автономного мини-анализа с allowlist инструментов.
Аргументы:
  - prompt (обязательно): задача для подагента
  - subagent_type (опционально): "generalPurpose" | "explore" | "shell" (по умолчанию: explore)
  - readonly (опционально): true/false (по умолчанию: true)
  - tasks (опционально): массив задач для батча subagent (строки ИЛИ объекты)
    - строка: "read_file path/to/file" или произвольный prompt
    - объект: { "prompt": "...", ... } либо { "action": "read_file", "args": { ... } }
  - parallel (опционально): true для параллельного запуска tasks
Примеры:
  { "tool": "subagent", "args": { "prompt": "Найди точки входа и риски", "subagent_type": "explore", "readonly": true } }
  { "tool": "subagent", "args": { "prompt": "Проверь конфиги через shell", "subagent_type": "shell" } }
  { "tool": "subagent", "args": { "parallel": true, "tasks": ["Изучи frontend", "Изучи backend", "Изучи infra"], "subagent_type": "explore", "readonly": true } }
  { "tool": "subagent", "args": { "parallel": true, "tasks": [
      { "label": "frontend", "prompt": "Изучи фронтенд: архитектура, риски", "subagent_type": "explore", "readonly": true },
      { "label": "backend", "prompt": "Изучи backend: API, зависимости, риски", "subagent_type": "explore", "readonly": true }
    ] } }

### final_answer
Завершает анализ. После этого система запросит структурированный ответ отдельно.
Пример: { "tool": "final_answer" }
`.trim();
