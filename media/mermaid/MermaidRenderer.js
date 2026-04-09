class MermaidRenderer {
  #counter = 0;
  #instances = new Map();
  #available = typeof window.mermaid !== 'undefined';

  get available() { return this.#available; }

  async renderAllIn(container) {
    if (!this.#available) return;

    var blocks = container.querySelectorAll('pre > code.language-mermaid');
    for (var index = 0; index < blocks.length; index++) {
      var codeEl = blocks[index];
      var pre = codeEl.parentElement;
      if (!pre) continue;
      await this.#renderBlock(pre, codeEl.textContent || '');
    }
  }

  destroyAll() {
    this.#instances.clear();
  }

  async #renderBlock(pre, rawSource) {
    var source = MermaidRenderer.sanitize(rawSource);
    var diagramId = 'mmd-' + (++this.#counter);

    try {
      var renderResult = await this.#renderSvg(diagramId, source, rawSource);
      var card = this.#buildCard({
        id: diagramId,
        source: source,
        title: MermaidRenderer.guessTitle(source),
        svgHtml: renderResult.svg,
      });
      pre.replaceWith(card);
      this.#instances.set(diagramId, { source: source, svgHtml: renderResult.svg, element: card });
    } catch (error) {
      pre.replaceWith(this.#buildError(rawSource, error));
    }
  }

  async #renderSvg(id, source, rawSource) {
    try {
      return await window.mermaid.render(id, source);
    } catch (_) {
      return window.mermaid.render(id + '-retry', MermaidRenderer.sanitize(rawSource, true));
    }
  }

  #buildCard(payload) {
    var card = document.createElement('figure');
    card.className = 'mmd-card';
    card.dataset.mmdId = payload.id;
    card.dataset.view = 'diagram';
    card.appendChild(this.#buildHeader(payload, card));
    card.appendChild(this.#buildStage(payload));
    card.appendChild(this.#buildSource(payload.source));
    return card;
  }

  #buildHeader(payload, card) {
    var header = document.createElement('figcaption');
    header.className = 'mmd-card-header';

    var meta = document.createElement('div');
    meta.className = 'mmd-card-meta';

    var badge = document.createElement('span');
    badge.className = 'mmd-badge';
    badge.textContent = payload.title.kind;
    meta.appendChild(badge);

    var title = document.createElement('div');
    title.className = 'mmd-title-wrap';
    var titleMain = document.createElement('div');
    titleMain.className = 'mmd-title';
    titleMain.textContent = payload.title.label;
    title.appendChild(titleMain);
    var subtitle = document.createElement('div');
    subtitle.className = 'mmd-subtitle';
    subtitle.textContent = 'Нажмите для просмотра • код диаграммы рядом';
    title.appendChild(subtitle);
    meta.appendChild(title);

    header.appendChild(meta);
    header.appendChild(this.#buildActions(payload, card));
    return header;
  }

  #buildActions(payload, card) {
    var actions = document.createElement('div');
    actions.className = 'mmd-actions';

    var toggle = document.createElement('div');
    toggle.className = 'mmd-segmented';
    var diagramBtn = this.#makeButton('mmd-segment is-active', 'Диаграмма');
    var sourceBtn = this.#makeButton('mmd-segment', 'Код');
    toggle.appendChild(diagramBtn);
    toggle.appendChild(sourceBtn);
    actions.appendChild(toggle);

    var copyBtn = this.#makeButton('mmd-tool-btn', 'Копировать', 'button');
    copyBtn.title = 'Копировать код';
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(payload.source).catch(function () {});
      copyBtn.textContent = 'Скопировано';
      setTimeout(function () { copyBtn.textContent = 'Копировать'; }, 1200);
    });
    actions.appendChild(copyBtn);

    var openBtn = this.#makeButton('mmd-tool-btn mmd-tool-btn-accent', 'Открыть', 'button');
    openBtn.title = 'Открыть в просмотре';
    openBtn.addEventListener('click', function () {
      if (window.MermaidOverlay) {
        window.MermaidOverlay.open({
          title: payload.title.label,
          kind: payload.title.kind,
          source: payload.source,
          svgHtml: payload.svgHtml,
        });
      }
    });
    actions.appendChild(openBtn);

    function switchView(view) {
      if (!card) return;
      card.dataset.view = view;
      diagramBtn.classList.toggle('is-active', view === 'diagram');
      sourceBtn.classList.toggle('is-active', view === 'source');
    }

    diagramBtn.addEventListener('click', function () { switchView('diagram'); });
    sourceBtn.addEventListener('click', function () { switchView('source'); });

    return actions;
  }

  #buildStage(payload) {
    var stage = document.createElement('div');
    stage.className = 'mmd-stage';

    var artboard = document.createElement('div');
    artboard.className = 'mmd-artboard';

    var canvas = document.createElement('div');
    canvas.className = 'mmd-canvas';
    canvas.innerHTML = payload.svgHtml;
    MermaidRenderer.enhanceSvg(canvas, payload.title.label);
    canvas.addEventListener('click', function () {
      if (window.MermaidOverlay) {
        window.MermaidOverlay.open({
          title: payload.title.label,
          kind: payload.title.kind,
          source: payload.source,
          svgHtml: payload.svgHtml,
        });
      }
    });

    artboard.appendChild(canvas);
    stage.appendChild(artboard);
    return stage;
  }

  #buildSource(source) {
    var sourceWrap = document.createElement('div');
    sourceWrap.className = 'mmd-source-panel';

    var pre = document.createElement('pre');
    pre.className = 'mmd-source-pre';
    var code = document.createElement('code');
    code.textContent = source;
    pre.appendChild(code);
    sourceWrap.appendChild(pre);
    return sourceWrap;
  }

  #buildError(rawSource, error) {
    var wrap = document.createElement('figure');
    wrap.className = 'mmd-error-card';

    var title = document.createElement('div');
    title.className = 'mmd-error-title';
    title.textContent = 'Не удалось отрисовать Mermaid';
    wrap.appendChild(title);

    var message = document.createElement('div');
    message.className = 'mmd-error-message';
    message.textContent = error && error.message ? error.message : String(error);
    wrap.appendChild(message);

    var details = document.createElement('details');
    details.className = 'mmd-error-details';
    var summary = document.createElement('summary');
    summary.textContent = 'Показать код диаграммы';
    details.appendChild(summary);
    var pre = document.createElement('pre');
    var code = document.createElement('code');
    code.textContent = rawSource;
    pre.appendChild(code);
    details.appendChild(pre);
    wrap.appendChild(details);
    return wrap;
  }

  #makeButton(className, label, type) {
    var button = document.createElement('button');
    button.className = className;
    button.type = type || 'button';
    button.textContent = label;
    return button;
  }

  static sanitize(raw, aggressive) {
    var code = String(raw || '').trim();
    code = code.replace(/^```mermaid\s*/i, '').replace(/```$/i, '').trim();
    if (/^mermaid\s*$/im.test(code.split('\n')[0] || '')) {
      code = code.split('\n').slice(1).join('\n').trim();
    }
    if (aggressive && /^(flowchart|graph)\b/i.test(code)) {
      code = code.replace(/([A-Za-z0-9_]+)\[([^\]\n]+)\]/g, function (_, id, label) {
        return id + '["' + String(label).replace(/"/g, '\\"') + '"]';
      });
    }
    return code;
  }

  static guessTitle(source) {
    var firstLine = (source.split('\n')[0] || '').trim();
    var kind = 'Диаграмма';

    if (/^sequenceDiagram/i.test(firstLine)) kind = 'Последовательность';
    else if (/^(flowchart|graph)/i.test(firstLine)) kind = 'Поток';
    else if (/^classDiagram/i.test(firstLine)) kind = 'Классы';
    else if (/^stateDiagram/i.test(firstLine)) kind = 'Состояния';
    else if (/^erDiagram/i.test(firstLine)) kind = 'ER';
    else if (/^journey/i.test(firstLine)) kind = 'Сценарий';
    else if (/^gantt/i.test(firstLine)) kind = 'Гант';
    else if (/^pie/i.test(firstLine)) kind = 'Круговая';
    else if (/^mindmap/i.test(firstLine)) kind = 'Майнд-карта';
    else if (/^timeline/i.test(firstLine)) kind = 'Таймлайн';

    return {
      kind: kind,
      label: kind + ' Mermaid',
    };
  }

  static enhanceSvg(container, label) {
    var svg = container.querySelector('svg');
    if (!svg) return;

    var width = parseFloat(svg.getAttribute('width') || '0');
    var height = parseFloat(svg.getAttribute('height') || '0');
    if (!svg.getAttribute('viewBox') && width > 0 && height > 0) {
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    }

    svg.classList.add('mmd-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label || 'Mermaid diagram');
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.style.background = 'transparent';

    var titles = svg.querySelectorAll('title');
    for (var i = 0; i < titles.length; i++) {
      if (!titles[i].textContent) titles[i].textContent = label || 'Mermaid diagram';
    }

    MermaidRenderer.#applyPalette(svg);
  }

  static #applyPalette(svg) {
    var palette = window.MermaidConfig && window.MermaidConfig.readPalette
      ? window.MermaidConfig.readPalette()
      : {
          canvas: 'transparent',
          surface: '#1b2430',
          elevated: '#202b38',
          cluster: '#17202a',
          note: '#253243',
          border: '#425b76',
          borderSoft: '#5ea1ff',
          accent: '#5ea1ff',
          accentSoft: '#8cc5ff',
          text: '#e7edf7',
          muted: '#9fb2c8'
        };

    function paint(elements, styles) {
      for (var i = 0; i < elements.length; i++) {
        var el = elements[i];
        for (var key in styles) {
          if (styles[key] == null) continue;
          el.style[key] = styles[key];
          if (key === 'stroke' || key === 'fill' || key === 'opacity' || key === 'strokeWidth') {
            var attr = key === 'strokeWidth' ? 'stroke-width' : key;
            el.setAttribute(attr, styles[key]);
          }
        }
      }
    }

    paint(svg.querySelectorAll('.edgePath path, .flowchart-link, .messageLine0, .messageLine1, .relation, .transition, .edgePaths path, line, polyline'), {
      fill: 'none',
      stroke: palette.accentSoft,
      strokeWidth: '1.6',
      strokeLinecap: 'round',
      strokeLinejoin: 'round'
    });

    paint(svg.querySelectorAll('defs marker path, defs marker polygon, defs marker circle'), {
      fill: palette.accentSoft,
      stroke: palette.accentSoft,
      strokeWidth: '1.1'
    });

    paint(svg.querySelectorAll('.node rect, .node circle, .node ellipse, .node polygon, .node path.label-container, .actor rect, .actor path, .actor-man circle, .classGroup rect, .stateGroup rect'), {
      fill: palette.surface,
      stroke: palette.borderSoft,
      strokeWidth: '1.4'
    });

    paint(svg.querySelectorAll('.actor-man line, .actor-man path:not(.label-container)'), {
      fill: 'none',
      stroke: palette.borderSoft,
      strokeWidth: '1.4'
    });

    paint(svg.querySelectorAll('.cluster rect, .group rect'), {
      fill: palette.cluster,
      stroke: palette.border,
      strokeWidth: '1.2'
    });

    paint(svg.querySelectorAll('.note rect, .note polygon, .labelBox, .loopLine, .loopText + rect, .edgeLabel rect'), {
      fill: palette.elevated,
      stroke: palette.border,
      strokeWidth: '1.1',
      opacity: '1'
    });

    paint(svg.querySelectorAll('.section0, .section1, .section2, .section3, .task, .taskTextOutsideRight, .taskTextOutsideLeft'), {
      fill: palette.surface,
      stroke: palette.borderSoft,
      strokeWidth: '1.2'
    });

    paint(svg.querySelectorAll('text, tspan, .label, .nodeLabel, .edgeLabel, .messageText, .labelText, .loopText, .noteText, .cluster text, .actor'), {
      fill: palette.text,
      color: palette.text
    });

    var foreignNodes = svg.querySelectorAll('foreignObject div, foreignObject span, foreignObject p');
    for (var j = 0; j < foreignNodes.length; j++) {
      foreignNodes[j].style.color = palette.text;
    }
  }
}

window.MermaidRenderer = MermaidRenderer;
