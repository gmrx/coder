(function () {
  'use strict';

  const hasMd   = typeof window.markdownit === 'function';
  const hasHljs = typeof window.hljs !== 'undefined';

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const md = hasMd ? window.markdownit({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
    highlight: function (str, lang) {
      if (lang === 'mermaid') {
        return '<code class="language-mermaid">' + escapeHtml(str) + '</code>';
      }
      if (hasHljs && lang && hljs.getLanguage(lang)) {
        try {
          return '<code class="hljs language-' + lang + '">' +
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            '</code>';
        } catch (_) {}
      }
      if (hasHljs) {
        try {
          return '<code class="hljs">' + hljs.highlightAuto(str).value + '</code>';
        } catch (_) {}
      }
      return '<code>' + escapeHtml(str) + '</code>';
    }
  }) : null;

  function renderMarkdown(text) {
    if (!md) return escapeHtml(text).replace(/\n/g, '<br>');
    return md.render(text);
  }

  /**
   * Called after markdown HTML is inserted into the DOM.
   * Delegates Mermaid rendering to MermaidManager (OOP module).
   */
  async function postRenderMessage(container) {
    if (window.MermaidManager) {
      await window.MermaidManager.processContainer(container);
    }
  }

  /**
   * One-time init: wire overlay controls via MermaidManager.
   */
  function bindOverlayControls() {
    if (window.MermaidManager) {
      window.MermaidManager.init();
    }
  }

  window.ChatMarkdown = {
    renderMarkdown,
    postRenderMessage,
    bindOverlayControls,
  };
})();
