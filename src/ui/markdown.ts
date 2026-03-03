import MarkdownIt from 'markdown-it';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
});

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = (token.info || '').trim().toLowerCase();
  const raw = token.content;

  if (lang === 'mermaid') {
    return '<div class="mermaid-wrap">' +
      `<div class="mermaid">${escapeHtml(raw)}</div>` +
      '<div class="mermaid-toolbar">' +
      '<button class="mermaid-expand-btn" title="Развернуть диаграмму">⛶ Развернуть</button>' +
      '</div></div>';
  }

  const escaped = escapeHtml(raw);
  const label = lang || 'text';
  return '<div class="code-block">' +
    `<div class="code-header"><span class="code-lang">${label}</span>` +
    '<button class="copy-btn" title="Копировать код">📋</button></div>' +
    `<pre><code class="lang-${lang}">${escaped}</code></pre></div>`;
};

md.renderer.rules.table_open = () => '<table class="md-table">';

export function renderMarkdown(text: string): string {
  return md.render(text);
}
