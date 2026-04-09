class MermaidOverlay {
  #overlay = null;
  #title = null;
  #hint = null;
  #previewBtn = null;
  #sourceBtn = null;
  #stage = null;
  #inner = null;
  #source = null;
  #sourceCode = null;
  #zoomLabel = null;

  #zoom = 1;
  #panX = 0;
  #panY = 0;
  #dragging = false;
  #dragStartX = 0;
  #dragStartY = 0;
  #dragStartPanX = 0;
  #dragStartPanY = 0;
  #payload = null;
  #activeView = 'diagram';

  static MIN_ZOOM = 0.2;
  static MAX_ZOOM = 5;
  static STEP = 0.15;

  bind() {
    this.#overlay = document.getElementById('mermaidOverlay');
    this.#title = document.getElementById('mermaidOverlayTitle');
    this.#hint = document.getElementById('mermaidOverlayHint');
    this.#previewBtn = document.getElementById('mermaidViewDiagramBtn');
    this.#sourceBtn = document.getElementById('mermaidViewSourceBtn');
    this.#stage = document.getElementById('mermaidOverlayContent');
    this.#inner = document.getElementById('mermaidOverlayInner');
    this.#source = document.getElementById('mermaidOverlaySource');
    this.#sourceCode = document.getElementById('mermaidOverlaySourceCode');
    this.#zoomLabel = document.getElementById('zoomLevel');

    if (!this.#overlay || !this.#stage || !this.#inner || !this.#source) return;

    var closeBtn = document.getElementById('mermaidCloseBtn');
    var fitBtn = document.getElementById('mermaidFitBtn');
    var copyBtn = document.getElementById('mermaidCopyBtn');
    var downloadBtn = document.getElementById('mermaidDownloadBtn');
    var zoomIn = document.getElementById('zoomIn');
    var zoomOut = document.getElementById('zoomOut');
    var zoomReset = document.getElementById('zoomReset');

    if (closeBtn) closeBtn.addEventListener('click', this.close.bind(this));
    if (fitBtn) fitBtn.addEventListener('click', this.#fitToScreen.bind(this));
    if (copyBtn) copyBtn.addEventListener('click', this.#copySource.bind(this));
    if (downloadBtn) downloadBtn.addEventListener('click', this.#downloadSvg.bind(this));
    if (zoomIn) zoomIn.addEventListener('click', this.#nudgeZoom.bind(this, MermaidOverlay.STEP));
    if (zoomOut) zoomOut.addEventListener('click', this.#nudgeZoom.bind(this, -MermaidOverlay.STEP));
    if (zoomReset) zoomReset.addEventListener('click', this.#resetTransform.bind(this));
    if (this.#previewBtn) this.#previewBtn.addEventListener('click', this.#setView.bind(this, 'diagram'));
    if (this.#sourceBtn) this.#sourceBtn.addEventListener('click', this.#setView.bind(this, 'source'));

    this.#overlay.addEventListener('click', (event) => {
      if (event.target === this.#overlay) this.close();
    });

    document.addEventListener('keydown', (event) => {
      if (!this.#isOpen()) return;
      if (event.key === 'Escape') this.close();
      if (event.key === '0') this.#fitToScreen();
      if (event.key === '1') this.#setView('diagram');
      if (event.key === '2') this.#setView('source');
    });

    this.#stage.addEventListener('wheel', (event) => {
      if (!this.#isOpen() || this.#activeView !== 'diagram') return;
      event.preventDefault();
      this.#nudgeZoom(event.deltaY < 0 ? MermaidOverlay.STEP : -MermaidOverlay.STEP);
    }, { passive: false });

    this.#stage.addEventListener('mousedown', (event) => {
      if (!this.#isOpen() || this.#activeView !== 'diagram' || event.button !== 0) return;
      this.#dragging = true;
      this.#dragStartX = event.clientX;
      this.#dragStartY = event.clientY;
      this.#dragStartPanX = this.#panX;
      this.#dragStartPanY = this.#panY;
      this.#stage.classList.add('is-dragging');
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.#dragging) return;
      this.#panX = this.#dragStartPanX + (event.clientX - this.#dragStartX);
      this.#panY = this.#dragStartPanY + (event.clientY - this.#dragStartY);
      this.#applyTransform();
    });

    document.addEventListener('mouseup', () => {
      this.#dragging = false;
      if (this.#stage) this.#stage.classList.remove('is-dragging');
    });
  }

  open(payload) {
    if (!this.#overlay || !this.#inner || !this.#sourceCode) return;

    this.#payload = typeof payload === 'string'
      ? { title: 'Диаграмма Mermaid', kind: 'Диаграмма', source: '', svgHtml: payload }
      : payload;

    this.#title.textContent = this.#payload.title || 'Диаграмма Mermaid';
    this.#hint.textContent = this.#payload.kind
      ? this.#payload.kind + ' • колёсико — масштаб • перетаскивание — панорама • 1/2 переключение вида'
      : 'колёсико — масштаб • перетаскивание — панорама • 1/2 переключение вида';

    this.#inner.innerHTML = this.#payload.svgHtml || '';
    if (window.MermaidRenderer) {
      window.MermaidRenderer.enhanceSvg(this.#inner, this.#payload.title || 'Mermaid diagram');
    }
    this.#sourceCode.textContent = this.#payload.source || '';

    this.#overlay.classList.add('open');
    this.#setView('diagram');
    requestAnimationFrame(() => this.#fitToScreen());
  }

  close() {
    if (!this.#overlay) return;
    this.#overlay.classList.remove('open');
    this.#dragging = false;
  }

  #isOpen() {
    return this.#overlay && this.#overlay.classList.contains('open');
  }

  #setView(view) {
    this.#activeView = view;
    if (this.#overlay) this.#overlay.dataset.view = view;
    if (this.#previewBtn) this.#previewBtn.classList.toggle('is-active', view === 'diagram');
    if (this.#sourceBtn) this.#sourceBtn.classList.toggle('is-active', view === 'source');
    if (this.#hint) {
      this.#hint.textContent = view === 'diagram'
        ? ((this.#payload && this.#payload.kind) ? this.#payload.kind + ' • колёсико — масштаб • перетаскивание — панорама • 1/2 переключение вида' : 'колёсико — масштаб • перетаскивание — панорама • 1/2 переключение вида')
        : 'Режим кода • можно скопировать и проверить точный Mermaid-код';
    }
  }

  #resetTransform() {
    this.#zoom = 1;
    this.#panX = 0;
    this.#panY = 0;
    this.#applyTransform();
  }

  #fitToScreen() {
    if (!this.#stage || !this.#inner) return;

    var svg = this.#inner.querySelector('svg');
    if (!svg) {
      this.#resetTransform();
      return;
    }

    var viewBox = svg.viewBox && svg.viewBox.baseVal;
    var width = viewBox && viewBox.width ? viewBox.width : parseFloat(svg.getAttribute('width') || '0');
    var height = viewBox && viewBox.height ? viewBox.height : parseFloat(svg.getAttribute('height') || '0');
    if (!width || !height) {
      this.#resetTransform();
      return;
    }

    var availableWidth = Math.max(this.#stage.clientWidth - 96, 120);
    var availableHeight = Math.max(this.#stage.clientHeight - 96, 120);
    var scale = Math.min(availableWidth / width, availableHeight / height, 1.4);

    this.#zoom = Math.max(MermaidOverlay.MIN_ZOOM, Math.min(MermaidOverlay.MAX_ZOOM, scale));
    this.#panX = 0;
    this.#panY = 0;
    this.#applyTransform();
  }

  #nudgeZoom(delta) {
    this.#zoom = Math.max(MermaidOverlay.MIN_ZOOM, Math.min(MermaidOverlay.MAX_ZOOM, this.#zoom + delta));
    this.#applyTransform();
  }

  #applyTransform() {
    if (!this.#inner || !this.#zoomLabel) return;
    this.#inner.style.transform = 'translate(' + this.#panX + 'px, ' + this.#panY + 'px) scale(' + this.#zoom + ')';
    this.#zoomLabel.textContent = Math.round(this.#zoom * 100) + '%';
  }

  #copySource() {
    if (!this.#payload || !this.#payload.source) return;
    navigator.clipboard.writeText(this.#payload.source).catch(function () {});
  }

  #downloadSvg() {
    if (!this.#inner) return;
    var svg = this.#inner.querySelector('svg');
    if (!svg) return;

    var blob = new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'diagram.svg';
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }
}

window.MermaidOverlay = new MermaidOverlay();
