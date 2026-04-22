import * as vscode from 'vscode';
import { computeLineChangeStats } from '../../../core/lineDiff';
import { decoder, truncate } from '../../../core/utils';
import { buildToolApprovalRequest } from '../catalog';
import {
  createEditExecutionResult,
  type EditPresentationChangeType,
  type EditPresentationStats,
} from '../editStudy';
import type { ToolHandlerMap } from '../types';
import { resolveWorkspaceUri } from '../workspace';

export const editToolHandlers: ToolHandlerMap = {
  async str_replace(args, context) {
    const filePath = args?.path || '';
    const oldString: string = args?.old_string ?? args?.old ?? args?.search ?? '';
    const newString: string = args?.new_string ?? args?.new ?? args?.replace ?? '';
    const replaceAll = args?.replace_all === true || args?.replaceAll === true;

    if (!filePath) return '(укажи "path" — путь к файлу)';
    if (oldString === '') return '(укажи "old_string" — текст для замены; пустая строка не допускается)';
    if (oldString === newString) {
      return createStructuredEditResult({
        toolName: 'str_replace',
        status: 'error',
        filePath,
        changeType: 'edit',
        outcome: 'error',
        content: '(old_string и new_string идентичны — замена не имеет смысла)',
        summary: 'Правка не имеет смысла',
        detail: 'old_string и new_string совпадают, замена не требуется.',
      });
    }

    const uri = await resolveWorkspaceUri(filePath);
    if (!uri) {
      const message = `Файл "${filePath}" не найден в workspace. Проверь путь или используй glob/find_files для поиска.`;
      return createStructuredEditResult({
        toolName: 'str_replace',
        status: 'error',
        filePath,
        changeType: 'edit',
        outcome: 'error',
        content: message,
        summary: 'Файл для правки не найден',
        detail: message,
        preview: message,
      });
    }

    try {
      const originalText = decoder.decode(await vscode.workspace.fs.readFile(uri));
      const occurrences = findOccurrences(originalText, oldString);

      if (occurrences.length === 0) {
        const message = buildMissingStringMessage(filePath, originalText, oldString);
        return createStructuredEditResult({
          toolName: 'str_replace',
          status: 'error',
          filePath,
          changeType: 'edit',
          outcome: 'error',
          content: message,
          summary: 'Фрагмент для замены не найден',
          oldSnippet: truncate(oldString, 800),
          detail: message,
          preview: message,
        });
      }
      if (occurrences.length > 1 && !replaceAll) {
        const message = buildNonUniqueStringMessage(filePath, originalText, oldString, occurrences);
        return createStructuredEditResult({
          toolName: 'str_replace',
          status: 'error',
          filePath,
          changeType: 'edit',
          outcome: 'error',
          content: message,
          summary: 'Фрагмент для замены неоднозначен',
          oldSnippet: truncate(oldString, 800),
          detail: message,
          preview: message,
        });
      }

      const updatedText = replaceAll
        ? originalText.split(oldString).join(newString)
        : originalText.replace(oldString, newString);
      const approval = await requestFileApproval('str_replace', context.onEvent, {
        filePath: vscode.workspace.asRelativePath(uri, false),
        changeType: 'edit',
        oldSnippet: truncate(oldString, 1200),
        newSnippet: truncate(newString, 1200),
        title: 'Подтвердите точечную правку файла',
        summary: buildReplaceSummary(originalText, updatedText, replaceAll ? occurrences.length : 1),
        stats: buildApprovalStats(originalText, updatedText),
      });
      const autoApproved = approval.reason === 'auto_approved';
      if (approval.cancelled) {
        const message = `Правка файла не выполнена: ожидание подтверждения прервано для "${filePath}".`;
        return createStructuredEditResult({
          toolName: 'str_replace',
          status: 'blocked',
          filePath: vscode.workspace.asRelativePath(uri, false),
          changeType: 'edit',
          outcome: 'blocked',
          content: message,
          summary: 'Точечная правка файла прервана',
          oldSnippet: truncate(oldString, 800),
          newSnippet: truncate(newString, 800),
          stats: buildApprovalStats(originalText, updatedText),
          detail: message,
        });
      }
      if (!approval.approved) {
        const message = `Правка файла отклонена пользователем: "${filePath}"`;
        return createStructuredEditResult({
          toolName: 'str_replace',
          status: 'blocked',
          filePath: vscode.workspace.asRelativePath(uri, false),
          changeType: 'edit',
          outcome: 'blocked',
          content: message,
          summary: 'Точечная правка файла отклонена',
          oldSnippet: truncate(oldString, 800),
          newSnippet: truncate(newString, 800),
          stats: buildApprovalStats(originalText, updatedText),
          detail: message,
        });
      }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedText, 'utf-8'));

      emitFileChange(context.onEvent, {
        filePath: vscode.workspace.asRelativePath(uri, false),
        changeType: 'edit',
        tool: 'str_replace',
        summary: buildReplaceSummary(originalText, updatedText, replaceAll ? occurrences.length : 1),
        oldSnippet: truncate(oldString, 800),
        newSnippet: truncate(newString, 800),
        fullOldText: originalText,
        fullNewText: updatedText,
      });

      const replacedCount = replaceAll ? occurrences.length : 1;
      const oldPreview = oldString.length > 50 ? oldString.slice(0, 50) + '…' : oldString;
      const newPreview = newString.length > 50 ? newString.slice(0, 50) + '…' : newString;
      const message = ` ${filePath}: заменено ${replacedCount} вхождение(й).${newString ? ` "${oldPreview}" → "${newPreview}"` : ` Удалено "${oldPreview}"`}${replacedCount > 1 ? ' (replace_all)' : ''}`;
      return createStructuredEditResult({
        toolName: 'str_replace',
        status: 'success',
        filePath: vscode.workspace.asRelativePath(uri, false),
        changeType: 'edit',
        outcome: 'applied',
        content: message,
        summary: buildReplaceSummary(originalText, updatedText, replacedCount),
        oldSnippet: truncate(oldString, 800),
        newSnippet: truncate(newString, 800),
        stats: buildApprovalStats(originalText, updatedText),
        detail: replaceAll && replacedCount > 1 ? 'replace_all: да' : '',
        autoApproved,
      });
    } catch (error: any) {
      const message = `Ошибка при редактировании "${filePath}": ${error?.message || error}`;
      return createStructuredEditResult({
        toolName: 'str_replace',
        status: 'error',
        filePath,
        changeType: 'edit',
        outcome: 'error',
        content: message,
        summary: 'Не удалось применить правку',
        oldSnippet: truncate(oldString, 800),
        newSnippet: truncate(newString, 800),
        detail: message,
        preview: message,
      });
    }
  },

  async write_file(args, context) {
    const filePath = args?.path || '';
    const contents: string = args?.contents ?? args?.content ?? args?.text ?? '';
    if (!filePath) return '(укажи "path" — путь к файлу)';
    if (contents === undefined || contents === null) return '(укажи "contents" — содержимое файла)';

    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return '(workspace пуст — открой папку проекта)';

    const targetUri = vscode.Uri.joinPath(folders[0].uri, filePath);
    try {
      await ensureParentDirectory(targetUri);

      let existed = false;
      let oldSize = 0;
      let oldText = '';
      try {
        const stat = await vscode.workspace.fs.stat(targetUri);
        existed = true;
        oldSize = stat.size;
        oldText = decoder.decode(await vscode.workspace.fs.readFile(targetUri));
      } catch {
        // New file.
      }

      if (existed && oldText === contents) {
        const message = `Файл "${filePath}" уже содержит целевое содержимое — перезапись не нужна.`;
        return createStructuredEditResult({
          toolName: 'write_file',
          status: 'success',
          filePath,
          changeType: 'overwrite',
          outcome: 'noop',
          content: message,
          summary: 'Перезапись не требуется',
          newSnippet: truncate(contents, 800),
          stats: buildApprovalStats(oldText, contents),
          detail: message,
        });
      }

      const approval = await requestFileApproval('write_file', context.onEvent, {
        filePath,
        changeType: existed ? 'overwrite' : 'create',
        oldSnippet: existed ? truncate(oldText, 1200) : '',
        newSnippet: truncate(contents, 1200),
        title: existed ? 'Подтвердите перезапись файла' : 'Подтвердите создание файла',
        summary: existed
          ? buildWriteSummary(oldText, contents)
          : buildCreateSummary(contents),
        stats: buildApprovalStats(existed ? oldText : '', contents),
      });
      const autoApproved = approval.reason === 'auto_approved';
      if (approval.cancelled) {
        const message = `Запись файла не выполнена: ожидание подтверждения прервано для "${filePath}".`;
        return createStructuredEditResult({
          toolName: 'write_file',
          status: 'blocked',
          filePath,
          changeType: existed ? 'overwrite' : 'create',
          outcome: 'blocked',
          content: message,
          summary: existed ? 'Перезапись файла прервана' : 'Создание файла прервано',
          oldSnippet: existed ? truncate(oldText, 800) : '',
          newSnippet: truncate(contents, 800),
          stats: buildApprovalStats(existed ? oldText : '', contents),
          detail: message,
        });
      }
      if (!approval.approved) {
        const message = `Запись файла отклонена пользователем: "${filePath}"`;
        return createStructuredEditResult({
          toolName: 'write_file',
          status: 'blocked',
          filePath,
          changeType: existed ? 'overwrite' : 'create',
          outcome: 'blocked',
          content: message,
          summary: existed ? 'Перезапись файла отклонена' : 'Создание файла отклонено',
          oldSnippet: existed ? truncate(oldText, 800) : '',
          newSnippet: truncate(contents, 800),
          stats: buildApprovalStats(existed ? oldText : '', contents),
          detail: message,
        });
      }

      const buffer = Buffer.from(contents, 'utf-8');
      await vscode.workspace.fs.writeFile(targetUri, buffer);

      emitFileChange(context.onEvent, {
        filePath,
        changeType: existed ? 'overwrite' : 'create',
        tool: 'write_file',
        summary: existed
          ? buildWriteSummary(oldText, contents)
          : buildCreateSummary(contents),
        oldSnippet: existed ? truncate(oldText, 600) : '',
        newSnippet: truncate(contents, 600),
        fullOldText: oldText,
        fullNewText: contents,
      });

      const lineCount = contents.split('\n').length;
      const size = buffer.length;
      const message = existed
        ? ` ${filePath}: перезаписан (${lineCount} строк, ${size} байт; было ${oldSize} байт)`
        : ` ${filePath}: создан (${lineCount} строк, ${size} байт)`;
      return createStructuredEditResult({
        toolName: 'write_file',
        status: 'success',
        filePath,
        changeType: existed ? 'overwrite' : 'create',
        outcome: 'applied',
        content: message,
        summary: existed
          ? buildWriteSummary(oldText, contents)
          : buildCreateSummary(contents),
        oldSnippet: existed ? truncate(oldText, 800) : '',
        newSnippet: truncate(contents, 800),
        stats: buildApprovalStats(existed ? oldText : '', contents),
        autoApproved,
      });
    } catch (error: any) {
      const message = `Ошибка записи "${filePath}": ${error?.message || error}`;
      return createStructuredEditResult({
        toolName: 'write_file',
        status: 'error',
        filePath,
        changeType: 'overwrite',
        outcome: 'error',
        content: message,
        summary: 'Не удалось записать файл',
        newSnippet: truncate(contents, 800),
        detail: message,
        preview: message,
      });
    }
  },

  async delete_file(args, context) {
    const filePath = args?.path || '';
    if (!filePath) return '(укажи "path" — путь к файлу)';

    const uri = await resolveWorkspaceUri(filePath);
    if (!uri) {
      const message = `Файл "${filePath}" не найден — возможно, уже удалён или путь неверный.`;
      return createStructuredEditResult({
        toolName: 'delete_file',
        status: 'success',
        filePath,
        changeType: 'delete',
        outcome: 'noop',
        content: message,
        summary: 'Удаление не требуется',
        detail: message,
      });
    }

    try {
      let stat: vscode.FileStat;
      try {
        stat = await vscode.workspace.fs.stat(uri);
      } catch {
        const message = `Файл "${filePath}" не существует — удаление не требуется.`;
        return createStructuredEditResult({
          toolName: 'delete_file',
          status: 'success',
          filePath,
          changeType: 'delete',
          outcome: 'noop',
          content: message,
          summary: 'Удаление не требуется',
          detail: message,
        });
      }

      if (stat.type === vscode.FileType.Directory) {
        const message = `"${filePath}" — это директория, а не файл. Для удаления директорий используй shell.`;
        return createStructuredEditResult({
          toolName: 'delete_file',
          status: 'error',
          filePath,
          changeType: 'delete',
          outcome: 'error',
          content: message,
          summary: 'Удаление директории этим инструментом не поддерживается',
          detail: message,
          preview: message,
        });
      }

      let oldText = '';
      try {
        oldText = decoder.decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        // Ignore binary / unreadable files but keep deletion.
      }

      const approval = await requestFileApproval('delete_file', context.onEvent, {
        filePath: vscode.workspace.asRelativePath(uri, false),
        changeType: 'delete',
        oldSnippet: truncate(oldText, 1200),
        newSnippet: '',
        title: 'Подтвердите удаление файла',
        summary: buildDeleteSummary(oldText, stat.size),
        stats: buildApprovalStats(oldText, ''),
      });
      const autoApproved = approval.reason === 'auto_approved';
      if (approval.cancelled) {
        const message = `Удаление файла не выполнено: ожидание подтверждения прервано для "${filePath}".`;
        return createStructuredEditResult({
          toolName: 'delete_file',
          status: 'blocked',
          filePath: vscode.workspace.asRelativePath(uri, false),
          changeType: 'delete',
          outcome: 'blocked',
          content: message,
          summary: 'Удаление файла прервано',
          oldSnippet: truncate(oldText, 800),
          stats: buildApprovalStats(oldText, ''),
          detail: message,
        });
      }
      if (!approval.approved) {
        const message = `Удаление файла отклонено пользователем: "${filePath}"`;
        return createStructuredEditResult({
          toolName: 'delete_file',
          status: 'blocked',
          filePath: vscode.workspace.asRelativePath(uri, false),
          changeType: 'delete',
          outcome: 'blocked',
          content: message,
          summary: 'Удаление файла отклонено',
          oldSnippet: truncate(oldText, 800),
          stats: buildApprovalStats(oldText, ''),
          detail: message,
        });
      }

      await vscode.workspace.fs.delete(uri);
      emitFileChange(context.onEvent, {
        filePath: vscode.workspace.asRelativePath(uri, false),
        changeType: 'delete',
        tool: 'delete_file',
        summary: buildDeleteSummary(oldText, stat.size),
        oldSnippet: truncate(oldText, 600),
        newSnippet: '',
        fullOldText: oldText,
        fullNewText: '',
      });

      const message = ` ${filePath}: удалён (был ${stat.size} байт)`;
      return createStructuredEditResult({
        toolName: 'delete_file',
        status: 'success',
        filePath: vscode.workspace.asRelativePath(uri, false),
        changeType: 'delete',
        outcome: 'applied',
        content: message,
        summary: buildDeleteSummary(oldText, stat.size),
        oldSnippet: truncate(oldText, 800),
        stats: buildApprovalStats(oldText, ''),
        autoApproved,
      });
    } catch (error: any) {
      const message = error?.message || String(error);
      if (/permission|access|denied/i.test(message)) {
        const text = `Ошибка: нет прав на удаление "${filePath}". Проверь разрешения файловой системы.`;
        return createStructuredEditResult({
          toolName: 'delete_file',
          status: 'error',
          filePath,
          changeType: 'delete',
          outcome: 'error',
          content: text,
          summary: 'Нет прав на удаление файла',
          detail: text,
          preview: text,
        });
      }
      if (/security|reject/i.test(message)) {
        const text = `Операция удаления "${filePath}" отклонена по соображениям безопасности.`;
        return createStructuredEditResult({
          toolName: 'delete_file',
          status: 'error',
          filePath,
          changeType: 'delete',
          outcome: 'error',
          content: text,
          summary: 'Удаление отклонено политикой безопасности',
          detail: text,
          preview: text,
        });
      }
      const text = `Ошибка удаления "${filePath}": ${message}`;
      return createStructuredEditResult({
        toolName: 'delete_file',
        status: 'error',
        filePath,
        changeType: 'delete',
        outcome: 'error',
        content: text,
        summary: 'Не удалось удалить файл',
        detail: text,
        preview: text,
      });
    }
  },

  async edit_notebook(args, context) {
    const notebookPath = args?.target_notebook || args?.path || args?.notebook || '';
    const cellIdx = typeof args?.cell_idx === 'number'
      ? args.cell_idx
      : (typeof args?.cell_index === 'number' ? args.cell_index : -1);
    const isNewCell = args?.is_new_cell === true || args?.new_cell === true;
    const cellLanguage: string = args?.cell_language || args?.language || args?.lang || 'python';
    const oldString: string = args?.old_string ?? args?.old ?? '';
    const newString: string = args?.new_string ?? args?.new ?? args?.content ?? '';

    if (!notebookPath) return '(укажи "target_notebook" — путь к .ipynb файлу)';
    if (cellIdx < 0) return '(укажи "cell_idx" — индекс ячейки, 0-based)';
    if (!isNewCell && oldString === '') return '(для редактирования существующей ячейки укажи "old_string" — текст для замены)';
    if (newString === undefined || newString === null) return '(укажи "new_string" — новое содержимое или текст замены)';

    const validLanguages = ['python', 'markdown', 'javascript', 'typescript', 'r', 'sql', 'shell', 'raw', 'other'];
    const normalizedLanguage = cellLanguage.toLowerCase();
    if (!validLanguages.includes(normalizedLanguage)) {
      const message = `Некорректный cell_language: "${cellLanguage}". Допустимые: ${validLanguages.join(', ')}`;
      return createStructuredEditResult({
        toolName: 'edit_notebook',
        status: 'error',
        filePath: notebookPath,
        changeType: isNewCell ? 'notebook-new-cell' : 'notebook-edit-cell',
        outcome: 'error',
        content: message,
        summary: 'Некорректный язык notebook-ячейки',
        language: normalizedLanguage,
        detail: message,
        preview: message,
      });
    }
    if (!isNewCell && oldString === newString) {
      return createStructuredEditResult({
        toolName: 'edit_notebook',
        status: 'error',
        filePath: notebookPath,
        changeType: 'notebook-edit-cell',
        outcome: 'error',
        content: '(old_string и new_string идентичны — правка не имеет смысла)',
        cellIdx,
        language: normalizedLanguage,
        summary: 'Правка ячейки не имеет смысла',
        detail: 'old_string и new_string совпадают, правка не требуется.',
      });
    }

    const uri = await resolveWorkspaceUri(notebookPath);
    if (!uri) {
      const message = `Ноутбук "${notebookPath}" не найден в workspace.`;
      return createStructuredEditResult({
        toolName: 'edit_notebook',
        status: 'error',
        filePath: notebookPath,
        changeType: isNewCell ? 'notebook-new-cell' : 'notebook-edit-cell',
        outcome: 'error',
        content: message,
        cellIdx,
        language: normalizedLanguage,
        summary: 'Ноутбук не найден',
        detail: message,
        preview: message,
      });
    }

    try {
      const rawNotebook = decoder.decode(await vscode.workspace.fs.readFile(uri));
      let notebook: any;
      try {
        notebook = JSON.parse(rawNotebook);
      } catch {
        const message = `"${notebookPath}" не является валидным JSON (ipynb). Проверь формат файла.`;
        return createStructuredEditResult({
          toolName: 'edit_notebook',
          status: 'error',
          filePath: notebookPath,
          changeType: isNewCell ? 'notebook-new-cell' : 'notebook-edit-cell',
          outcome: 'error',
          content: message,
          cellIdx,
          language: normalizedLanguage,
          summary: 'Формат notebook повреждён',
          detail: message,
          preview: message,
        });
      }

      if (!Array.isArray(notebook.cells)) {
        const message = `"${notebookPath}" не содержит массив cells — невалидный формат ноутбука.`;
        return createStructuredEditResult({
          toolName: 'edit_notebook',
          status: 'error',
          filePath: notebookPath,
          changeType: isNewCell ? 'notebook-new-cell' : 'notebook-edit-cell',
          outcome: 'error',
          content: message,
          cellIdx,
          language: normalizedLanguage,
          summary: 'Формат notebook не поддерживается',
          detail: message,
          preview: message,
        });
      }

      const cellType = resolveNotebookCellType(normalizedLanguage);
      if (isNewCell) {
        return insertNotebookCell({
          notebookPath,
          notebook,
          rawNotebook,
          uri,
          cellIdx,
          cellType,
          normalizedLanguage,
          newString,
          onEvent: context.onEvent,
        });
      }

      if (cellIdx >= notebook.cells.length) {
        const message = `Ячейка ${cellIdx} не существует в "${notebookPath}" — в ноутбуке ${notebook.cells.length} ячеек (индексы: 0–${notebook.cells.length - 1}).`;
        return createStructuredEditResult({
          toolName: 'edit_notebook',
          status: 'error',
          filePath: notebookPath,
          changeType: 'notebook-edit-cell',
          outcome: 'error',
          content: message,
          cellIdx,
          language: normalizedLanguage,
          summary: 'Ячейка notebook не найдена',
          detail: message,
          preview: message,
        });
      }

      const cell = notebook.cells[cellIdx];
      const cellSource = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
      if (oldString === '' && newString === '') {
        cell.source = [''];
        return saveNotebookChange({
          notebookPath,
          uri,
          notebook,
          rawNotebook,
          cellIdx,
          oldSnippet: truncate(cellSource, 600),
          newSnippet: '',
          summary: `Очищена ячейка ${cellIdx}.`,
          language: cell.cell_type || normalizedLanguage,
          onEvent: context.onEvent,
        }, ` ${notebookPath}: ячейка ${cellIdx} очищена.`, 'notebook-edit-cell', 'applied');
      }

      const occurrences = findOccurrences(cellSource, oldString);
      if (occurrences.length === 0) {
        const message = buildNotebookMissingStringMessage(notebookPath, cellIdx, cell.cell_type || normalizedLanguage, cellSource, oldString);
        return createStructuredEditResult({
          toolName: 'edit_notebook',
          status: 'error',
          filePath: notebookPath,
          changeType: 'notebook-edit-cell',
          outcome: 'error',
          content: message,
          cellIdx,
          language: cell.cell_type || normalizedLanguage,
          summary: 'Фрагмент в ячейке не найден',
          oldSnippet: truncate(oldString, 800),
          detail: message,
          preview: message,
        });
      }
      if (occurrences.length > 1) {
        const message = buildNotebookNonUniqueStringMessage(notebookPath, cellIdx, cellSource, oldString, occurrences);
        return createStructuredEditResult({
          toolName: 'edit_notebook',
          status: 'error',
          filePath: notebookPath,
          changeType: 'notebook-edit-cell',
          outcome: 'error',
          content: message,
          cellIdx,
          language: cell.cell_type || normalizedLanguage,
          summary: 'Фрагмент в ячейке неоднозначен',
          oldSnippet: truncate(oldString, 800),
          detail: message,
          preview: message,
        });
      }

      const updatedCellText = cellSource.replace(oldString, newString);
      if (updatedCellText === cellSource) {
        const message = `Ячейка ${cellIdx} в "${notebookPath}" уже содержит целевой текст — правка не требуется.`;
        return createStructuredEditResult({
          toolName: 'edit_notebook',
          status: 'success',
          filePath: notebookPath,
          changeType: 'notebook-edit-cell',
          outcome: 'noop',
          content: message,
          cellIdx,
          language: cell.cell_type || normalizedLanguage,
          summary: 'Правка ячейки не требуется',
          stats: buildApprovalStats(cellSource, updatedCellText),
          detail: message,
        });
      }
      const approval = await requestFileApproval('edit_notebook', context.onEvent, {
        filePath: notebookPath,
        changeType: 'notebook-edit-cell',
        oldSnippet: truncate(oldString, 1200),
        newSnippet: truncate(newString, 1200),
        cellIdx,
        language: cell.cell_type || normalizedLanguage,
        summary: buildNotebookEditSummary(cellSource, updatedCellText, cellIdx, false),
        stats: buildApprovalStats(cellSource, updatedCellText),
      });
      const autoApproved = approval.reason === 'auto_approved';
      if (approval.cancelled) {
        const message = `Правка ноутбука не выполнена: ожидание подтверждения прервано для "${notebookPath}" [cell ${cellIdx}]`;
        return createStructuredEditResult({
          toolName: 'edit_notebook',
          status: 'blocked',
          filePath: notebookPath,
          changeType: 'notebook-edit-cell',
          outcome: 'blocked',
          content: message,
          cellIdx,
          language: cell.cell_type || normalizedLanguage,
          summary: 'Правка ячейки notebook прервана',
          oldSnippet: truncate(oldString, 800),
          newSnippet: truncate(newString, 800),
          stats: buildApprovalStats(cellSource, updatedCellText),
          detail: message,
        });
      }
      if (!approval.approved) {
        const message = `Правка ноутбука отклонена пользователем: "${notebookPath}" [cell ${cellIdx}]`;
        return createStructuredEditResult({
          toolName: 'edit_notebook',
          status: 'blocked',
          filePath: notebookPath,
          changeType: 'notebook-edit-cell',
          outcome: 'blocked',
          content: message,
          cellIdx,
          language: cell.cell_type || normalizedLanguage,
          summary: 'Правка ячейки notebook отклонена',
          oldSnippet: truncate(oldString, 800),
          newSnippet: truncate(newString, 800),
          stats: buildApprovalStats(cellSource, updatedCellText),
          detail: message,
        });
      }

      cell.source = toNotebookSourceLines(updatedCellText);
      const oldPreview = oldString.length > 60 ? oldString.slice(0, 60) + '…' : oldString;
      const newPreview = newString.length > 60 ? newString.slice(0, 60) + '…' : newString;
      return saveNotebookChange(
        {
          notebookPath,
          uri,
          notebook,
          rawNotebook,
          cellIdx,
          oldSnippet: truncate(oldString, 800),
          newSnippet: truncate(newString, 800),
          summary: buildNotebookEditSummary(cellSource, updatedCellText, cellIdx, false),
          language: cell.cell_type || normalizedLanguage,
          onEvent: context.onEvent,
          autoApproved,
        },
        ` ${notebookPath}: ячейка ${cellIdx} [${cell.cell_type}] отредактирована.${newString ? ` "${oldPreview}" → "${newPreview}"` : ` Удалено "${oldPreview}"`}`,
        'notebook-edit-cell',
        'applied',
      );
    } catch (error: any) {
      const message = `Ошибка редактирования ноутбука "${notebookPath}": ${error?.message || error}`;
      return createStructuredEditResult({
        toolName: 'edit_notebook',
        status: 'error',
        filePath: notebookPath,
        changeType: isNewCell ? 'notebook-new-cell' : 'notebook-edit-cell',
        outcome: 'error',
        content: message,
        cellIdx: cellIdx >= 0 ? cellIdx : undefined,
        language: normalizedLanguage,
        summary: 'Не удалось изменить notebook',
        detail: message,
        preview: message,
      });
    }
  },
};

function emitFileChange(onEvent: ((phase: string, message: string, meta?: any) => void | Promise<any>) | undefined, meta: Record<string, any>) {
  onEvent?.('file-change', `${meta.changeType === 'delete' ? '' : ''} ${meta.filePath}`, {
    changeId: `chg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...meta,
  });
}

async function requestFileApproval(
  toolName: string,
  onEvent: ((phase: string, message: string, meta?: any) => void | Promise<any>) | undefined,
  meta: Record<string, any>,
): Promise<{ approved: boolean; cancelled?: boolean; reason?: string }> {
  if (!onEvent) return { approved: true };
  const confirmId = `fa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const request = buildToolApprovalRequest(toolName, { ...meta, confirmId });
  if (!request || request.kind !== 'file') return { approved: true };
  const result = await onEvent('approval-request', request.title, request) as {
    approved?: boolean;
    cancelled?: boolean;
    reason?: string;
  } | undefined;
  return {
    approved: !!result?.approved,
    cancelled: !!result?.cancelled,
    reason: typeof result?.reason === 'string' ? result.reason : undefined,
  };
}

function findOccurrences(source: string, probe: string): number[] {
  const matches: number[] = [];
  let searchPos = 0;
  while (true) {
    const index = source.indexOf(probe, searchPos);
    if (index === -1) break;
    matches.push(index);
    searchPos = index + 1;
  }
  return matches;
}

function buildMissingStringMessage(filePath: string, fileText: string, oldString: string): string {
  const candidates = findMissingStringCandidates(fileText, oldString);
  const fuzzyMatches = candidates.map((candidate) => `  L${candidate.lineNumber}: ${candidate.preview}`);
  const nextSteps = candidates.map((candidate) =>
    `  - открыть участок L${candidate.startLine}-${candidate.endLine}: ${buildReadWindowCall(filePath, candidate.startLine, candidate.endLine)}`,
  );

  return (
    `Текст не найден в "${filePath}" (old_string: ${oldString.length} символов).\n` +
    `${fuzzyMatches.length > 0 ? `Похожие строки (по началу old_string):\n${fuzzyMatches.join('\n')}\n` : ''}` +
    'Убедись, что old_string точно совпадает с содержимым файла (включая пробелы, отступы, переносы строк).\n' +
    'Лучший следующий шаг: сначала открой нужный участок и возьми более точный old_string.\n' +
    (nextSteps.length > 0
      ? `Подсказки:\n${nextSteps.join('\n')}`
      : `Подсказки:\n  - обзор файла: ${buildReadFileOutlineCall(filePath)}`)
  );
}

function buildNonUniqueStringMessage(filePath: string, fileText: string, oldString: string, occurrences: number[]): string {
  const lines = fileText.split('\n');
  const lineNumbers = occurrences.map((position) => fileText.slice(0, position).split('\n').length);
  const preview = lineNumbers
    .slice(0, 6)
    .map((lineNumber) => `  L${lineNumber}: ${(lines[lineNumber - 1] || '').trimEnd().slice(0, 120)}`)
    .join('\n');
  const routes = lineNumbers
    .slice(0, 4)
    .map((lineNumber) => `  - участок вокруг L${lineNumber}: ${buildReadRangeCall(filePath, lineNumber)}`)
    .join('\n');
  const contexts = buildUniqueContextHints(fileText, oldString, occurrences)
    .map((context) =>
      `  - L${context.startLine}-${context.endLine}: ${context.preview}\n    открыть участок: ${buildReadWindowCall(filePath, context.startLine, context.endLine)}`,
    )
    .join('\n');

  return (
    `"old_string" найдена ${occurrences.length} раз в "${filePath}" (строки: ${lineNumbers.join(', ')}).\n` +
    `Вхождения:\n${preview}\n` +
    'Добавь больше окружающего контекста в old_string для уникальности, либо используй "replace_all": true для замены ВСЕХ вхождений.\n' +
    'Лучший следующий шаг: открой конкретный участок и возьми минимально уникальный фрагмент 2-6 строк.\n' +
    (contexts ? `Кандидаты уникального контекста:\n${contexts}\n` : '') +
    `Подсказки:\n${routes}`
  );
}

async function ensureParentDirectory(targetUri: vscode.Uri): Promise<void> {
  const parentUri = vscode.Uri.joinPath(targetUri, '..');
  try {
    await vscode.workspace.fs.stat(parentUri);
  } catch {
    await vscode.workspace.fs.createDirectory(parentUri);
  }
}

function resolveNotebookCellType(language: string): string {
  switch (language) {
    case 'markdown':
      return 'markdown';
    case 'raw':
      return 'raw';
    default:
      return 'code';
  }
}

function toNotebookSourceLines(source: string): string[] {
  if (!source) return [''];
  const lines = source.split('\n');
  return lines.map((line, index) => (index < lines.length - 1 ? line + '\n' : line));
}

function buildReadFileOutlineCall(filePath: string): string {
  return JSON.stringify({
    tool: 'read_file',
    args: {
      path: filePath,
      outputMode: 'outline',
    },
  });
}

function buildReadRangeCall(filePath: string, lineNumber: number): string {
  return buildReadWindowCall(filePath, Math.max(1, lineNumber - 6), lineNumber + 18);
}

function buildReadWindowCall(filePath: string, startLine: number, endLine: number): string {
  return JSON.stringify({
    tool: 'read_file_range',
    args: {
      path: filePath,
      startLine: Math.max(1, startLine),
      endLine: Math.max(startLine, endLine),
    },
  });
}

function buildNotebookMissingStringMessage(
  notebookPath: string,
  cellIdx: number,
  cellType: string,
  cellSource: string,
  oldString: string,
): string {
  const totalLines = cellSource.split('\n').length;
  const candidates = findMissingStringCandidates(cellSource, oldString);
  const candidateLines = candidates.length > 0
    ? `Похожие участки:\n${candidates.map((candidate) => `  - L${candidate.startLine}-${candidate.endLine}: ${candidate.preview}`).join('\n')}\n`
    : '';
  return (
    `"old_string" не найдена в ячейке ${cellIdx} (${cellType}, ${totalLines} строк).\n` +
    candidateLines +
    'Убедись, что old_string точно совпадает с текстом ячейки (включая пробелы, отступы).\n' +
    'Лучший следующий шаг: возьми 2-6 строк уникального контекста из нужного участка ячейки и повтори edit_notebook.\n' +
    `Следующий шаг:\n  ${buildNotebookEditCall(notebookPath, cellIdx)}`
  );
}

function buildNotebookNonUniqueStringMessage(
  notebookPath: string,
  cellIdx: number,
  cellSource: string,
  oldString: string,
  occurrences: number[],
): string {
  const lines = cellSource.split('\n');
  const lineNumbers = occurrences.map((position) => cellSource.slice(0, position).split('\n').length);
  const preview = lineNumbers
    .slice(0, 5)
    .map((lineNumber) => `  L${lineNumber}: ${(lines[lineNumber - 1] || '').trimEnd().slice(0, 120)}`)
    .join('\n');
  const contexts = buildUniqueContextHints(cellSource, oldString, occurrences)
    .map((context) => `  - L${context.startLine}-${context.endLine}: ${context.preview}`)
    .join('\n');
  return (
    `"old_string" найдена ${occurrences.length} раз в ячейке ${cellIdx}.\n` +
    `Вхождения:\n${preview}\n` +
    (contexts ? `Кандидаты уникального контекста:\n${contexts}\n` : '') +
    'Одна замена за вызов. Возьми один из уникальных фрагментов как old_string и повтори edit_notebook.\n' +
    `Следующий шаг:\n  ${buildNotebookEditCall(notebookPath, cellIdx)}`
  );
}

type MissingStringCandidate = {
  lineNumber: number;
  startLine: number;
  endLine: number;
  preview: string;
};

type UniqueContextHint = {
  startLine: number;
  endLine: number;
  preview: string;
};

function findMissingStringCandidates(sourceText: string, oldString: string): MissingStringCandidate[] {
  const lines = sourceText.split('\n');
  const probes = Array.from(new Set(
    oldString
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length >= 3)
      .map((line) => line.slice(0, Math.min(40, line.length))),
  )).slice(0, 3);
  const candidates: MissingStringCandidate[] = [];
  const seen = new Set<number>();

  for (const probe of probes) {
    for (let index = 0; index < lines.length && candidates.length < 5; index++) {
      if (!lines[index].includes(probe)) continue;
      const lineNumber = index + 1;
      if (seen.has(lineNumber)) continue;
      seen.add(lineNumber);
      candidates.push({
        lineNumber,
        startLine: Math.max(1, lineNumber - 2),
        endLine: Math.min(lines.length, lineNumber + 2),
        preview: lines[index].trimEnd().slice(0, 120),
      });
    }
  }

  return candidates;
}

function buildUniqueContextHints(sourceText: string, matchedText: string, occurrences: number[]): UniqueContextHint[] {
  const lines = sourceText.split('\n');
  const lineOffsets = getLineOffsets(sourceText);
  const matchLength = matchedText.length > 0 ? matchedText.length : 1;
  const hints: UniqueContextHint[] = [];
  const seen = new Set<string>();

  for (const occurrence of occurrences.slice(0, 4)) {
    const matchStartLine = getLineNumberForOffset(lineOffsets, occurrence);
    const matchEndLine = getLineNumberForOffset(lineOffsets, Math.max(occurrence, occurrence + matchLength - 1));
    for (let radius = 0; radius <= 3; radius++) {
      const startLine = Math.max(1, matchStartLine - radius);
      const endLine = Math.min(lines.length, matchEndLine + radius);
      const snippet = lines.slice(startLine - 1, endLine).join('\n');
      if (!snippet.trim()) continue;
      const key = `${startLine}:${endLine}`;
      const isUnique = findOccurrences(sourceText, snippet).length === 1;
      if (!isUnique || seen.has(key)) continue;
      seen.add(key);
      hints.push({
        startLine,
        endLine,
        preview: compactSnippet(snippet),
      });
      break;
    }
  }

  return hints;
}

function getLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') offsets.push(index + 1);
  }
  return offsets;
}

function getLineNumberForOffset(lineOffsets: number[], offset: number): number {
  for (let index = 0; index < lineOffsets.length; index++) {
    const nextOffset = lineOffsets[index + 1];
    if (nextOffset === undefined || offset < nextOffset) {
      return index + 1;
    }
  }
  return lineOffsets.length;
}

function compactSnippet(snippet: string, maxLength = 140): string {
  return truncate(
    snippet
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' | '),
    maxLength,
  );
}

function buildNotebookEditCall(notebookPath: string, cellIdx: number): string {
  return JSON.stringify({
    tool: 'edit_notebook',
    args: {
      target_notebook: notebookPath,
      cell_idx: cellIdx,
      old_string: '<уникальный фрагмент из ячейки>',
      new_string: '<новый фрагмент>',
    },
  });
}

async function insertNotebookCell(options: {
  notebookPath: string;
  notebook: any;
  rawNotebook: string;
  uri: vscode.Uri;
  cellIdx: number;
  cellType: string;
  normalizedLanguage: string;
  newString: string;
  onEvent?: (phase: string, message: string, meta?: any) => void | Promise<any>;
}) {
  const { notebookPath, notebook, rawNotebook, uri, cellIdx, cellType, normalizedLanguage, newString, onEvent } = options;
  const insertIdx = Math.min(cellIdx, notebook.cells.length);
  const approval = await requestFileApproval('edit_notebook', onEvent, {
    filePath: notebookPath,
    changeType: 'notebook-new-cell',
    oldSnippet: '',
    newSnippet: truncate(newString, 1200),
    cellIdx: insertIdx,
    language: normalizedLanguage,
    title: 'Подтвердите добавление ячейки в ноутбук',
    summary: buildNotebookEditSummary('', newString, insertIdx, true),
    stats: buildApprovalStats('', newString),
  });
  const autoApproved = approval.reason === 'auto_approved';
  if (approval.cancelled) {
    const message = `Добавление ячейки не выполнено: ожидание подтверждения прервано для "${notebookPath}" [cell ${insertIdx}]`;
    return createStructuredEditResult({
      toolName: 'edit_notebook',
      status: 'blocked',
      filePath: notebookPath,
      changeType: 'notebook-new-cell',
      outcome: 'blocked',
      content: message,
      cellIdx: insertIdx,
      language: normalizedLanguage,
      summary: 'Добавление ячейки notebook прервано',
      newSnippet: truncate(newString, 800),
      stats: buildApprovalStats('', newString),
      detail: message,
    });
  }
  if (!approval.approved) {
    const message = `Добавление ячейки отклонено пользователем: "${notebookPath}" [cell ${insertIdx}]`;
    return createStructuredEditResult({
      toolName: 'edit_notebook',
      status: 'blocked',
      filePath: notebookPath,
      changeType: 'notebook-new-cell',
      outcome: 'blocked',
      content: message,
      cellIdx: insertIdx,
      language: normalizedLanguage,
      summary: 'Добавление ячейки notebook отклонено',
      newSnippet: truncate(newString, 800),
      stats: buildApprovalStats('', newString),
      detail: message,
    });
  }

  const newCell: any = {
    cell_type: cellType,
    metadata: {},
    source: toNotebookSourceLines(newString),
  };
  if (cellType === 'code') {
    newCell.execution_count = null;
    newCell.outputs = [];
  }

  notebook.cells.splice(insertIdx, 0, newCell);
  const newNotebookText = JSON.stringify(notebook, null, notebook.cells.length > 1 ? 1 : 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(newNotebookText, 'utf-8'));

  emitFileChange(onEvent, {
    filePath: vscode.workspace.asRelativePath(uri, false),
    changeType: 'notebook-new-cell',
    tool: 'edit_notebook',
    cellIdx: insertIdx,
    summary: buildNotebookEditSummary('', newString, insertIdx, true),
    oldSnippet: '',
    newSnippet: truncate(newString, 800),
    fullOldText: rawNotebook,
    fullNewText: newNotebookText,
  });

  const message = ` ${notebookPath}: создана новая ${cellType}-ячейка [${normalizedLanguage}] на позиции ${insertIdx} (${newString.split('\n').length} строк). Всего ячеек: ${notebook.cells.length}`;
  return createStructuredEditResult({
    toolName: 'edit_notebook',
    status: 'success',
    filePath: vscode.workspace.asRelativePath(uri, false),
    changeType: 'notebook-new-cell',
    outcome: 'applied',
    content: message,
    cellIdx: insertIdx,
    language: normalizedLanguage,
    summary: buildNotebookEditSummary('', newString, insertIdx, true),
    newSnippet: truncate(newString, 800),
    stats: buildApprovalStats('', newString),
    autoApproved,
  });
}

async function saveNotebookChange(
  options: {
    notebookPath: string;
    uri: vscode.Uri;
    notebook: any;
    rawNotebook: string;
    cellIdx: number;
    oldSnippet: string;
    newSnippet: string;
    summary?: string;
    language?: string;
    onEvent?: (phase: string, message: string, meta?: any) => void | Promise<any>;
    autoApproved?: boolean;
  },
  message: string,
  changeType: EditPresentationChangeType,
  outcome: 'applied' | 'noop',
): Promise<ReturnType<typeof createStructuredEditResult>> {
  const { notebookPath, uri, notebook, rawNotebook, cellIdx, oldSnippet, newSnippet, summary, language, onEvent, autoApproved } = options;
  const newNotebookText = JSON.stringify(notebook, null, notebook.cells.length > 1 ? 1 : 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(newNotebookText, 'utf-8'));

  emitFileChange(onEvent, {
    filePath: vscode.workspace.asRelativePath(uri, false),
    changeType,
    tool: 'edit_notebook',
    cellIdx,
    summary,
    oldSnippet,
    newSnippet,
    fullOldText: rawNotebook,
    fullNewText: newNotebookText,
  });

  return createStructuredEditResult({
    toolName: 'edit_notebook',
    status: 'success',
    filePath: vscode.workspace.asRelativePath(uri, false),
    changeType,
    outcome,
    content: message,
    cellIdx,
    language,
    summary: summary || 'Ноутбук обновлён.',
    oldSnippet,
    newSnippet,
    stats: buildApprovalStats(rawNotebook, newNotebookText),
    autoApproved,
  });
}

function createStructuredEditResult(input: {
  toolName: 'str_replace' | 'write_file' | 'delete_file' | 'edit_notebook';
  status: 'success' | 'error' | 'blocked' | 'degraded';
  filePath: string;
  changeType: EditPresentationChangeType;
  outcome: 'applied' | 'blocked' | 'noop' | 'error';
  content: string;
  summary: string;
  oldSnippet?: string;
  newSnippet?: string;
  cellIdx?: number;
  language?: string;
  stats?: EditPresentationStats;
  detail?: string;
  preview?: string;
  autoApproved?: boolean;
}) {
  return createEditExecutionResult(input.status, input.content, {
    toolName: input.toolName,
    filePath: input.filePath,
    changeType: input.changeType,
    outcome: input.outcome,
    summary: input.summary,
    oldSnippet: input.oldSnippet,
    newSnippet: input.newSnippet,
    cellIdx: input.cellIdx,
    language: input.language,
    stats: input.stats,
    detail: input.detail,
    preview: input.preview,
  }, input.autoApproved ? { autoApproved: true } : undefined);
}

function buildReplaceSummary(oldText: string, newText: string, replacedCount: number): string {
  const stats = computeLineChangeStats(oldText, newText);
  return `Точечная правка: ${replacedCount} ${pluralize(replacedCount, 'замена', 'замены', 'замен')}, ${formatLineDelta(stats)}.`;
}

function buildWriteSummary(oldText: string, newText: string): string {
  const stats = computeLineChangeStats(oldText, newText);
  return `Полная перезапись файла: ${stats.beforeLines} -> ${stats.afterLines} ${pluralize(stats.afterLines, 'строка', 'строки', 'строк')}, ${formatLineDelta(stats)}.`;
}

function buildCreateSummary(newText: string): string {
  const lines = countLines(newText);
  return `Новый файл на ${lines} ${pluralize(lines, 'строку', 'строки', 'строк')}.`;
}

function buildDeleteSummary(oldText: string, sizeBytes: number): string {
  const lines = oldText ? countLines(oldText) : 0;
  return lines > 0
    ? `Удалён файл на ${lines} ${pluralize(lines, 'строку', 'строки', 'строк')} (${sizeBytes} байт).`
    : `Удалён файл (${sizeBytes} байт).`;
}

function buildNotebookEditSummary(oldText: string, newText: string, cellIdx: number, isNewCell: boolean): string {
  if (isNewCell) {
    const lines = countLines(newText);
    return `Добавлена новая ячейка ${cellIdx} на ${lines} ${pluralize(lines, 'строку', 'строки', 'строк')}.`;
  }
  const stats = computeLineChangeStats(oldText, newText);
  return `Изменена ячейка ${cellIdx}: ${stats.beforeLines} -> ${stats.afterLines} ${pluralize(stats.afterLines, 'строка', 'строки', 'строк')}, ${formatLineDelta(stats)}.`;
}

function buildApprovalStats(oldText: string, newText: string): {
  added: number;
  removed: number;
  beforeLines: number;
  afterLines: number;
  oldBytes: number;
  newBytes: number;
  changedLines: number;
} {
  const lineStats = computeLineChangeStats(oldText, newText);
  return {
    added: lineStats.added,
    removed: lineStats.removed,
    beforeLines: lineStats.beforeLines,
    afterLines: lineStats.afterLines,
    oldBytes: Buffer.byteLength(oldText || '', 'utf-8'),
    newBytes: Buffer.byteLength(newText || '', 'utf-8'),
    changedLines: Math.max(lineStats.added, lineStats.removed),
  };
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

function formatLineDelta(stats: { added: number; removed: number }): string {
  return `+${stats.added} / -${stats.removed}`;
}

function pluralize(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
