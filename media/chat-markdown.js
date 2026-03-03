(function () {
  'use strict';

  const hasMd = typeof window.markdownit === 'function';
  const hasHljs = typeof window.hljs !== 'undefined';
  const hasMermaid = typeof window.mermaid !== 'undefined';

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
          return '<code class="hljs language-' + lang + '">' + hljs.highlight(str, { language: lang, ignoreIllegals: true }).value + '</code>';
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

  if (hasMermaid) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      look: 'classic',
      securityLevel: 'loose',
      fontFamily: 'var(--vscode-font-family, system-ui)'
    });
  }

  let mermaidCounter = 0;
  let currentZoom = 1;

  function renderMarkdown(text) {
    if (!md) return escapeHtml(text).replace(/\n/g, '<br>');
    return md.render(text);
  }

  function sanitizeMermaidSource(raw) {
    let code = String(raw || '').trim();
    code = code.replace(/^```mermaid\s*/i, '').replace(/```$/i, '').trim();
    if (/^mermaid\s*$/im.test(code.split('\n')[0] || '')) {
      code = code.split('\n').slice(1).join('\n').trim();
    }

    if (/^(flowchart|graph)\b/i.test(code)) {
      code = code.replace(/([A-Za-z0-9_]+)\[([^\]\n]+)\]/g, function (_, id, label) {
        const safe = String(label).replace(/"/g, '\\"');
        return id + '["' + safe + '"]';
      });
    }
    return code;
  }

  function bindOverlayControls() {
    const overlay = document.getElementById('mermaidOverlay');
    const overlayInner = document.getElementById('mermaidOverlayInner');
    const zoomLevel = document.getElementById('zoomLevel');
    const closeBtn = document.getElementById('mermaidCloseBtn');
    const zoomIn = document.getElementById('zoomIn');
    const zoomOut = document.getElementById('zoomOut');
    const zoomReset = document.getElementById('zoomReset');
    const overlayContent = document.getElementById('mermaidOverlayContent');
    if (!overlay || !overlayInner || !zoomLevel || !closeBtn || !zoomIn || !zoomOut || !zoomReset || !overlayContent) return;

    function setZoom(z) {
      currentZoom = Math.max(0.1, Math.min(5, z));
      overlayInner.style.transform = 'scale(' + currentZoom + ')';
      zoomLevel.textContent = Math.round(currentZoom * 100) + '%';
    }

    window.ChatMarkdown.openFullscreen = function (svgHtml) {
      overlayInner.innerHTML = svgHtml;
      currentZoom = 1;
      setZoom(1);
      overlay.classList.add('open');
    };

    function closeFullscreen() {
      overlay.classList.remove('open');
    }

    closeBtn.addEventListener('click', closeFullscreen);
    zoomIn.addEventListener('click', function () { setZoom(currentZoom + 0.2); });
    zoomOut.addEventListener('click', function () { setZoom(currentZoom - 0.2); });
    zoomReset.addEventListener('click', function () { setZoom(1); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeFullscreen(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeFullscreen();
    });
    overlayContent.addEventListener('wheel', function (e) {
      if (!overlay.classList.contains('open')) return;
      e.preventDefault();
      setZoom(currentZoom + (e.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });
  }

  async function postRenderMessage(container) {
    if (hasMermaid) {
      const blocks = container.querySelectorAll('pre > code.language-mermaid');
      for (const block of blocks) {
        const pre = block.parentElement;
        if (!pre) continue;
        const originalCode = block.textContent || '';
        let code = originalCode;
        const id = 'mmd-' + (++mermaidCounter);
        try {
          let result;
          try {
            result = await mermaid.render(id, code);
          } catch (_) {
            code = sanitizeMermaidSource(originalCode);
            result = await mermaid.render(id + '-san', code);
          }
          const svg = result.svg;

          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-wrapper';

          const toolbar = document.createElement('div');
          toolbar.className = 'mermaid-toolbar';
          const label = document.createElement('span');
          label.className = 'mermaid-label';
          label.textContent = 'Mermaid Diagram';
          toolbar.appendChild(label);

          const toggleBtn = document.createElement('button');
          toggleBtn.className = 'btn-icon';
          toggleBtn.title = 'Source / Diagram';
          toggleBtn.innerHTML = '&#128221;';
          toolbar.appendChild(toggleBtn);

          const fsBtn = document.createElement('button');
          fsBtn.className = 'btn-icon';
          fsBtn.title = 'Fullscreen';
          fsBtn.innerHTML = '&#128269;';
          toolbar.appendChild(fsBtn);

          const rendered = document.createElement('div');
          rendered.className = 'mermaid-rendered';
          rendered.innerHTML = svg;
          rendered.title = 'Click to open fullscreen';
          rendered.style.cursor = 'zoom-in';

          const source = document.createElement('div');
          source.className = 'mermaid-source';
          source.style.display = 'none';
          const srcPre = document.createElement('pre');
          const srcCode = document.createElement('code');
          srcCode.textContent = code;
          srcPre.appendChild(srcCode);
          source.appendChild(srcPre);

          wrapper.appendChild(toolbar);
          wrapper.appendChild(rendered);
          wrapper.appendChild(source);

          toggleBtn.addEventListener('click', function () {
            const showSource = rendered.style.display !== 'none';
            rendered.style.display = showSource ? 'none' : '';
            source.style.display = showSource ? '' : 'none';
          });
          fsBtn.addEventListener('click', function () {
            if (window.ChatMarkdown.openFullscreen) window.ChatMarkdown.openFullscreen(svg);
          });
          rendered.addEventListener('click', function () {
            if (window.ChatMarkdown.openFullscreen) window.ChatMarkdown.openFullscreen(svg);
          });

          pre.replaceWith(wrapper);
        } catch (err) {
          const wrapper = document.createElement('div');
          wrapper.className = 'mermaid-error-wrap';

          const title = document.createElement('div');
          title.className = 'mermaid-error-title';
          title.textContent = 'Mermaid render failed';

          const details = document.createElement('div');
          details.className = 'mermaid-error';
          details.textContent = (err && err.message ? err.message : String(err));

          const src = document.createElement('details');
          src.className = 'mermaid-error-source';
          src.innerHTML =
            '<summary>Show diagram source</summary><pre><code>' +
            escapeHtml(originalCode) +
            '</code></pre>';

          wrapper.appendChild(title);
          wrapper.appendChild(details);
          wrapper.appendChild(src);
          pre.replaceWith(wrapper);
        }
      }
    }
  }

  window.ChatMarkdown = {
    renderMarkdown,
    postRenderMessage,
    bindOverlayControls
  };
})();
