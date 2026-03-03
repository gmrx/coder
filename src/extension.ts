import * as vscode from 'vscode';
import { ChatMessage } from './core/types';
import { EXTENSION_NAME } from './core/constants';
import { initConfigStorage, readConfig, fetchModelsList, sendChatRequest, saveConfig } from './core/api';
import { isConfigValid, truncate } from './core/utils';
import { AiChatViewProvider, AiOriginalContentProvider } from './ui/provider';

export function activate(context: vscode.ExtensionContext) {
  initConfigStorage(context.globalState);

  const askCommand = vscode.commands.registerCommand('ai-assistant.ask', async () => {
    const editor = vscode.window.activeTextEditor;
    const selectionText = editor?.document.getText(editor.selection).trim();

    const question = await vscode.window.showInputBox({
      prompt: 'Введите запрос для AI ассистента',
      value: selectionText || '',
      ignoreFocusOut: true
    });
    if (!question) return;

    const cfg = readConfig();
    if (!isConfigValid(cfg)) {
      vscode.window.showErrorMessage(`${EXTENSION_NAME}: настройте apiBaseUrl, apiKey и model в Settings.`);
      return;
    }

    const loading = vscode.window.setStatusBarMessage(`${EXTENSION_NAME}: отправка запроса...`);
    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Ты помогаешь разработчику писать и объяснять код. Отвечай кратко и по-русски.' }
      ];

      if (editor) {
        const doc = editor.document;
        messages.push({
          role: 'user',
          content: `Файл: ${doc.fileName}\nЯзык: ${doc.languageId}\n\n\`\`\`\n${truncate(doc.getText(), 40000)}\n\`\`\``
        });
      }

      messages.push({ role: 'user', content: question });
      const answer = await sendChatRequest(cfg.apiBaseUrl, cfg.apiKey, cfg.model, messages);

      const doc = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: `# Ответ AI\n\n**Вопрос:**\n\n${question}\n\n**Ответ:**\n\n${answer}`
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error: any) {
      vscode.window.showErrorMessage(`${EXTENSION_NAME}: ${error?.message || String(error)}`);
    } finally {
      loading.dispose();
    }
  });

  const configureCommand = vscode.commands.registerCommand('ai-assistant.configure', async () => {
    const cfg = readConfig();
    const apiBaseUrl = await vscode.window.showInputBox({ prompt: 'Базовый URL API', value: cfg.apiBaseUrl, ignoreFocusOut: true });
    if (!apiBaseUrl) return;
    const apiKey = await vscode.window.showInputBox({ prompt: 'API ключ', value: cfg.apiKey, password: true, ignoreFocusOut: true });
    if (!apiKey) return;

    const loading = vscode.window.setStatusBarMessage(`${EXTENSION_NAME}: загрузка моделей...`);
    let models: string[] = [];
    try { models = await fetchModelsList(apiBaseUrl, apiKey); } catch {} finally { loading.dispose(); }

    let model: string | undefined;
    if (models.length > 0) {
      const items: vscode.QuickPickItem[] = [{ label: '$(pencil) Ввести вручную', description: 'Если нужной модели нет' }, ...models.map(m => ({ label: m }))];
      const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Выберите модель', ignoreFocusOut: true });
      if (!picked) return;
      model = picked.label === '$(pencil) Ввести вручную'
        ? await vscode.window.showInputBox({ prompt: 'Имя модели', value: cfg.model, ignoreFocusOut: true })
        : picked.label;
    } else {
      model = await vscode.window.showInputBox({ prompt: 'Имя модели', value: cfg.model, ignoreFocusOut: true });
    }
    if (!model) return;

    await saveConfig({ apiBaseUrl, apiKey, model });
    vscode.window.showInformationMessage(`${EXTENSION_NAME}: настройки обновлены (${model}).`);
  });

  const originalProvider = new AiOriginalContentProvider();
  const chatProvider = new AiChatViewProvider(context, originalProvider);

  const showScmDiff = vscode.commands.registerCommand('ai-assistant.showScmDiff', async (filePath: string) => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length || !filePath) return;
    const originalUri = vscode.Uri.parse(`ai-original:/${filePath}`);
    const fileUri = vscode.Uri.joinPath(folders[0].uri, filePath);
    try {
      await vscode.workspace.fs.stat(fileUri);
      await vscode.commands.executeCommand('vscode.diff', originalUri, fileUri, `${filePath} (AI Changes)`);
    } catch {
      const doc = await vscode.workspace.openTextDocument(originalUri);
      await vscode.window.showTextDocument(doc, { preview: true });
      vscode.window.showInformationMessage(`Файл "${filePath}" был удалён агентом`);
    }
  });

  const acceptScmFile = vscode.commands.registerCommand('ai-assistant.acceptScmFile', (resource: vscode.SourceControlResourceState) => {
    if (!resource?.resourceUri) return;
    chatProvider.acceptAllChangesForFile(vscode.workspace.asRelativePath(resource.resourceUri, false));
  });

  const rejectScmFile = vscode.commands.registerCommand('ai-assistant.rejectScmFile', async (resource: vscode.SourceControlResourceState) => {
    if (!resource?.resourceUri) return;
    await chatProvider.rejectAllChangesForFile(vscode.workspace.asRelativePath(resource.resourceUri, false));
  });

  const acceptAll = vscode.commands.registerCommand('ai-assistant.acceptAllChanges', () => {
    chatProvider.acceptAllChanges();
  });

  const rejectAll = vscode.commands.registerCommand('ai-assistant.rejectAllChanges', async () => {
    await chatProvider.rejectAllChanges();
  });

  context.subscriptions.push(
    askCommand, configureCommand,
    vscode.workspace.registerTextDocumentContentProvider('ai-original', originalProvider),
    vscode.window.registerWebviewViewProvider(AiChatViewProvider.viewType, chatProvider),
    showScmDiff, acceptScmFile, rejectScmFile, acceptAll, rejectAll
  );
}

export function deactivate() {}
