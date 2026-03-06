/**
 * MermaidRenderer — renders individual Mermaid diagrams.
 *
 * After mermaid.render() produces SVG, the #fixSvg() method walks the
 * entire SVG DOM tree and corrects every fill/stroke/color attribute
 * to ensure proper dark-theme rendering. This approach is bulletproof
 * compared to CSS-only fixes because Mermaid v11 hard-codes inline
 * styles on SVG elements.
 */
class MermaidRenderer {

  #counter = 0;
  #instances = new Map();
  #available = typeof window.mermaid !== 'undefined';

  get available() { return this.#available; }

  async renderAllIn(container) {
    if (!this.#available) return;
    const blocks = container.querySelectorAll('pre > code.language-mermaid');
    for (const codeEl of blocks) {
      const pre = codeEl.parentElement;
      if (!pre) continue;
      await this.#renderOne(pre, codeEl.textContent || '');
    }
  }

  destroyAll() { this.#instances.clear(); }

  async #renderOne(pre, rawSource) {
    const id = 'mmd-' + (++this.#counter);
    const source = MermaidRenderer.sanitize(rawSource);
    try {
      const result = await this.#tryRender(id, source, rawSource);
      const wrapper = this.#buildSuccess(id, source, result.svg);
      pre.replaceWith(wrapper);
      this.#instances.set(id, { wrapper, source, svg: result.svg });
    } catch (err) {
      const wrapper = this.#buildError(id, rawSource, err);
      pre.replaceWith(wrapper);
    }
  }

  async #tryRender(id, source, rawSource) {
    try {
      return await mermaid.render(id, source);
    } catch (_) {
      const cleaned = MermaidRenderer.sanitize(rawSource, true);
      return await mermaid.render(id + '-retry', cleaned);
    }
  }

  // ─── DOM builders ─────────────────────────────────────────

  #buildSuccess(id, source, svgHtml) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mmd-wrapper';
    wrapper.dataset.mmdId = id;

    wrapper.appendChild(this.#buildToolbar(id, source, svgHtml));

    const rendered = document.createElement('div');
    rendered.className = 'mmd-rendered';
    rendered.innerHTML = svgHtml;
    MermaidRenderer.fixSvg(rendered);
    rendered.title = 'Click to open fullscreen';
    rendered.addEventListener('click', () => {
      if (window.MermaidOverlay) window.MermaidOverlay.open(svgHtml);
    });
    wrapper.appendChild(rendered);

    const sourceEl = document.createElement('div');
    sourceEl.className = 'mmd-source';
    sourceEl.style.display = 'none';
    const srcPre = document.createElement('pre');
    const srcCode = document.createElement('code');
    srcCode.textContent = source;
    srcPre.appendChild(srcCode);
    sourceEl.appendChild(srcPre);
    wrapper.appendChild(sourceEl);

    return wrapper;
  }

  #buildToolbar(id, source, svgHtml) {
    const toolbar = document.createElement('div');
    toolbar.className = 'mmd-toolbar';

    const label = document.createElement('span');
    label.className = 'mmd-toolbar-label';
    label.textContent = 'Mermaid Diagram';
    toolbar.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'mmd-toolbar-actions';

    const toggleBtn = this.#iconButton('mmd-btn-toggle', 'Source / Diagram', '\u{1F4DD}');
    toggleBtn.addEventListener('click', () => {
      const w = toggleBtn.closest('.mmd-wrapper');
      if (!w) return;
      const r = w.querySelector('.mmd-rendered');
      const s = w.querySelector('.mmd-source');
      if (!r || !s) return;
      const showSrc = r.style.display !== 'none';
      r.style.display = showSrc ? 'none' : '';
      s.style.display = showSrc ? '' : 'none';
    });
    actions.appendChild(toggleBtn);

    const copyBtn = this.#iconButton('mmd-btn-copy', 'Copy source', '\u{1F4CB}');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(source).catch(() => {});
      copyBtn.textContent = '\u2713';
      setTimeout(() => { copyBtn.textContent = '\u{1F4CB}'; }, 1200);
    });
    actions.appendChild(copyBtn);

    const fsBtn = this.#iconButton('mmd-btn-fullscreen', 'Fullscreen', '\u{1F50D}');
    fsBtn.addEventListener('click', () => {
      if (window.MermaidOverlay) window.MermaidOverlay.open(svgHtml);
    });
    actions.appendChild(fsBtn);

    toolbar.appendChild(actions);
    return toolbar;
  }

  #buildError(id, rawSource, error) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mmd-error-wrap';
    wrapper.dataset.mmdId = id;

    const title = document.createElement('div');
    title.className = 'mmd-error-title';
    title.textContent = 'Mermaid — render failed';
    wrapper.appendChild(title);

    const msg = document.createElement('div');
    msg.className = 'mmd-error-message';
    msg.textContent = error && error.message ? error.message : String(error);
    wrapper.appendChild(msg);

    const details = document.createElement('details');
    details.className = 'mmd-error-source';
    const summary = document.createElement('summary');
    summary.textContent = 'Show diagram source';
    details.appendChild(summary);
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = rawSource;
    pre.appendChild(code);
    details.appendChild(pre);
    wrapper.appendChild(details);

    return wrapper;
  }

  #iconButton(cls, title, icon) {
    const btn = document.createElement('button');
    btn.className = 'mmd-icon-btn ' + cls;
    btn.type = 'button';
    btn.title = title;
    btn.textContent = icon;
    return btn;
  }

  // ─── SVG post-processing (static, reused by Overlay) ─────

  static COLORS = {
    edge:   '#7eb8da',
    text:   '#d4d4d4',
    bg:     '#1e1e1e',
    node:   '#1f2937',
    border: '#4b7399',
  };

  static #isBlackish(color) {
    if (!color) return false;
    const c = color.toLowerCase().trim();
    return c === '#000' || c === '#000000' || c === 'black' ||
           c === 'rgb(0, 0, 0)' || c === 'rgb(0,0,0)' ||
           c === '#333' || c === '#333333';
  }

  static #isDarkFill(color) {
    if (!color) return true;
    return MermaidRenderer.#isBlackish(color);
  }

  /**
   * Walk the SVG DOM and fix all colors for dark-theme rendering.
   * This is the nuclear option — overrides everything Mermaid gets wrong.
   */
  static fixSvg(container) {
    const svg = container.querySelector('svg');
    if (!svg) return;

    const C = MermaidRenderer.COLORS;

    // SVG root setup
    svg.style.maxWidth = 'none';
    svg.removeAttribute('height');
    svg.setAttribute('width', '100%');
    svg.style.shapeRendering = 'geometricPrecision';

    // ── 1. Fix ALL edge paths ──
    // Mermaid uses various selectors for edges across diagram types.
    // We target all of them and also do a generic pass.
    const edgeSelectors = [
      '.edgePath path',
      '.edgePath .path',
      'path.flowchart-link',
      '.edgePaths path',
      '.messageLine0',
      '.messageLine1',
      '.relation',
      '.transition',
      '.er.relationshipLine',
      'line.messageLine0',
      'line.messageLine1',
    ];
    const edgeEls = svg.querySelectorAll(edgeSelectors.join(','));
    for (const el of edgeEls) {
      el.setAttribute('fill', 'none');
      el.style.fill = 'none';
      el.style.strokeOpacity = '1';
      const s = el.getAttribute('stroke');
      if (!s || MermaidRenderer.#isBlackish(s)) {
        el.setAttribute('stroke', C.edge);
      }
      const sw = parseFloat(el.getAttribute('stroke-width') || el.style.strokeWidth || '0');
      if (sw < 1) {
        el.setAttribute('stroke-width', '1.5');
        el.style.strokeWidth = '1.5px';
      }
    }

    // ── 2. Generic catch-all: any path with black fill that isn't a node ──
    for (const p of svg.querySelectorAll('path')) {
      if (p.closest('.node') || p.closest('.label') || p.closest('.cluster')) continue;
      const fill = p.getAttribute('fill');
      if (MermaidRenderer.#isBlackish(fill)) {
        const hasStroke = p.getAttribute('stroke') && p.getAttribute('stroke') !== 'none';
        if (hasStroke) {
          p.setAttribute('fill', 'none');
          p.style.fill = 'none';
        }
      }
      const stroke = p.getAttribute('stroke');
      if (MermaidRenderer.#isBlackish(stroke)) {
        p.setAttribute('stroke', C.edge);
      }
    }

    // ── 3. Fix arrowhead markers in <defs> ──
    for (const m of svg.querySelectorAll('defs marker path, defs marker polygon, defs marker circle, defs marker line')) {
      const fill = m.getAttribute('fill');
      if (!fill || MermaidRenderer.#isDarkFill(fill)) {
        m.setAttribute('fill', C.edge);
      }
      const stroke = m.getAttribute('stroke');
      if (!stroke || MermaidRenderer.#isBlackish(stroke) || stroke === 'none') {
        m.setAttribute('stroke', C.edge);
      }
    }

    // Also target markers by id pattern
    for (const m of svg.querySelectorAll('[id*="arrowhead"] path, [id*="crosshead"] path, [id*="point"] path, [id*="circle"] path')) {
      if (m.closest('defs')) {
        m.setAttribute('fill', C.edge);
        m.setAttribute('stroke', C.edge);
      }
    }

    // ── 4. Fix text colors ──
    for (const t of svg.querySelectorAll('text')) {
      t.style.textRendering = 'optimizeLegibility';
      const fill = t.getAttribute('fill');
      if (MermaidRenderer.#isBlackish(fill)) {
        t.setAttribute('fill', C.text);
      }
    }

    // Fix text inside foreignObject (html labels)
    for (const el of svg.querySelectorAll('foreignObject span, foreignObject p, foreignObject div')) {
      const color = el.style.color;
      if (!color || MermaidRenderer.#isBlackish(color)) {
        el.style.color = C.text;
      }
    }

    // ── 5. Fix edge label backgrounds ──
    for (const el of svg.querySelectorAll('.edgeLabel rect')) {
      el.setAttribute('fill', C.bg);
      el.setAttribute('stroke', 'none');
      el.setAttribute('opacity', '0.85');
    }

    // ── 6. Fix sequence diagram lines (they use <line> not <path>) ──
    for (const el of svg.querySelectorAll('line')) {
      const stroke = el.getAttribute('stroke');
      if (MermaidRenderer.#isBlackish(stroke)) {
        el.setAttribute('stroke', C.edge);
      }
    }

    // ── 7. Fix any remaining rects with black stroke ──
    for (const el of svg.querySelectorAll('rect')) {
      const stroke = el.getAttribute('stroke');
      if (MermaidRenderer.#isBlackish(stroke)) {
        el.setAttribute('stroke', C.border);
      }
    }
  }

  // ─── static helpers ───────────────────────────────────────

  static sanitize(raw, aggressive = false) {
    let code = String(raw || '').trim();
    code = code.replace(/^```mermaid\s*/i, '').replace(/```$/i, '').trim();
    if (/^mermaid\s*$/im.test(code.split('\n')[0] || '')) {
      code = code.split('\n').slice(1).join('\n').trim();
    }
    if (aggressive && /^(flowchart|graph)\b/i.test(code)) {
      code = code.replace(/([A-Za-z0-9_]+)\[([^\]\n]+)\]/g, (_, id, label) => {
        const safe = String(label).replace(/"/g, '\\"');
        return id + '["' + safe + '"]';
      });
    }
    return code;
  }

  static escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.MermaidRenderer = MermaidRenderer;
