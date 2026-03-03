import * as vscode from 'vscode';

export function getChatViewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const baseStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview.css'));
  const extraStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'webview-extra.css'));
  const markdownJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-markdown.js'));
  const appJsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'chat-app.js'));

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src ${webview.cspSource} https://cdn.jsdelivr.net; script-src ${webview.cspSource} https://cdn.jsdelivr.net 'unsafe-eval'; font-src https://cdn.jsdelivr.net data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${baseStyleUri}" />
  <link rel="stylesheet" href="${extraStyleUri}" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark-dimmed.min.css" />
  <title>AI Assistant</title>
</head>
<body>
  <div class="root">
    <div class="tabs">
      <button class="tab active" data-tab="chat">Chat</button>
      <button class="tab" data-tab="settings">Settings</button>
    </div>

    <div id="chatView" class="view active">
      <div id="messages" class="messages"></div>
      <div class="chat-footer">
        <div id="bulkActions" class="bulk-actions">
          <span class="bulk-label" id="bulkLabel">0 изменений</span>
          <div class="bulk-btns">
            <button class="btn btn-xs btn-accept-all" id="acceptAllBtn">&#10003; Принять все</button>
            <button class="btn btn-xs btn-reject-all" id="rejectAllBtn">&#10007; Отклонить все</button>
          </div>
        </div>
        <div id="quickTags" class="quick-tags"></div>
        <div class="input-row">
          <textarea id="input" rows="2" placeholder="Задайте вопрос..."></textarea>
          <button class="btn btn-primary" id="sendBtn">Send</button>
        </div>
        <div class="hint">Shift+Enter — новая строка, Enter — отправить</div>
      </div>
    </div>

    <div id="settingsView" class="view">
      <div class="settings">
        <div class="settings-section">
          <div class="settings-section-header"><span>Connection</span><button class="btn btn-secondary btn-xs" id="testConnBtn">Test</button></div>
          <div class="settings-section-body">
            <div class="field"><div class="field-label">API Base URL <span class="badge badge-required">required</span></div><div class="field-desc">Endpoint для chat completions</div><input id="s_apiBaseUrl" class="field-input" spellcheck="false" placeholder="https://api.example.com/v1/chat/completions" /></div>
            <div class="field"><div class="field-label">API Key <span class="badge badge-required">required</span></div><div class="field-input-wrap"><input id="s_apiKey" class="field-input has-btn" type="password" spellcheck="false" placeholder="sk-..." /><button class="field-input-btn" id="toggleKeyBtn" title="Показать / скрыть">&#128065;</button></div></div>
            <div id="connStatus" class="conn-status"><span class="conn-dot idle"></span><span>Не проверено</span></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-header"><span>Models</span><button class="btn btn-secondary btn-xs" id="loadModelsBtn">Load list</button></div>
          <div class="settings-section-body">
            <div class="field"><div class="field-label">Chat Model <span class="badge badge-required">required</span></div><div class="field-desc">Основная модель для генерации ответов</div><div class="model-picker" id="picker_chat"></div></div>
            <div class="field"><div class="field-label">Rerank Model <span class="badge badge-optional">optional</span></div><div class="field-desc">Переранжирование файлов по релевантности запросу</div><div class="model-picker" id="picker_rerank"></div></div>
            <div class="field"><div class="field-label">Embeddings Model <span class="badge badge-optional">optional</span></div><div class="field-desc">Семантический поиск по коду проекта</div><div class="model-picker" id="picker_emb"></div></div>
          </div>
        </div>
      </div>
      <div class="save-bar"><div id="saveStatus" class="save-status"></div><div class="spacer"></div><button class="btn btn-secondary" id="cancelBtn">Cancel</button><button class="btn btn-primary" id="saveBtn">Save</button></div>
    </div>

    <div class="toast" id="toast"></div>
  </div>

  <div class="mermaid-overlay" id="mermaidOverlay">
    <div class="mermaid-overlay-toolbar">
      <span class="mermaid-overlay-title">Mermaid Diagram</span>
      <div class="mermaid-overlay-actions">
        <button class="btn btn-secondary" id="mermaidCloseBtn">Close</button>
      </div>
    </div>
    <div class="mermaid-overlay-content" id="mermaidOverlayContent">
      <div class="mermaid-overlay-inner" id="mermaidOverlayInner"></div>
    </div>
    <div class="zoom-controls">
      <button class="zoom-btn" id="zoomOut">-</button>
      <span class="zoom-level" id="zoomLevel">100%</span>
      <button class="zoom-btn" id="zoomIn">+</button>
      <button class="zoom-btn" id="zoomReset">↺</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/markdown-it@14/dist/markdown-it.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/highlight.js@11/build/highlight.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
  <script src="${markdownJsUri}"></script>
  <script src="${appJsUri}"></script>
</body>
</html>`;
}
