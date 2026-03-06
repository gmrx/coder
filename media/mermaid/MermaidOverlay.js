/**
 * MermaidOverlay — fullscreen diagram viewer with zoom / pan.
 *
 * Renders a cloned SVG in a fixed overlay and provides:
 *   - mouse-wheel zoom
 *   - button zoom in / out / reset
 *   - click-drag panning
 *   - ESC / button / backdrop close
 */
class MermaidOverlay {

  /** @type {HTMLElement | null} */ #overlay = null;
  /** @type {HTMLElement | null} */ #inner   = null;
  /** @type {HTMLElement | null} */ #zoomLabel = null;

  #zoom = 1;
  #panX = 0;
  #panY = 0;

  #dragging = false;
  #dragStartX = 0;
  #dragStartY = 0;
  #dragStartPanX = 0;
  #dragStartPanY = 0;

  #boundKeydown  = null;
  #boundWheel    = null;
  #boundMouseDown = null;
  #boundMouseMove = null;
  #boundMouseUp   = null;

  static MIN_ZOOM = 0.15;
  static MAX_ZOOM = 6;
  static ZOOM_STEP = 0.2;
  static WHEEL_STEP = 0.1;

  /**
   * Bind to the existing overlay DOM elements created by the HTML template.
   * Call once after DOMContentLoaded.
   */
  bind() {
    this.#overlay   = document.getElementById('mermaidOverlay');
    this.#inner     = document.getElementById('mermaidOverlayInner');
    this.#zoomLabel = document.getElementById('zoomLevel');

    if (!this.#overlay || !this.#inner) return;

    const closeBtn  = document.getElementById('mermaidCloseBtn');
    const zoomIn    = document.getElementById('zoomIn');
    const zoomOut   = document.getElementById('zoomOut');
    const zoomReset = document.getElementById('zoomReset');
    const content   = document.getElementById('mermaidOverlayContent');

    if (closeBtn)  closeBtn.addEventListener('click', () => this.close());
    if (zoomIn)    zoomIn.addEventListener('click',   () => this.#setZoom(this.#zoom + MermaidOverlay.ZOOM_STEP));
    if (zoomOut)   zoomOut.addEventListener('click',   () => this.#setZoom(this.#zoom - MermaidOverlay.ZOOM_STEP));
    if (zoomReset) zoomReset.addEventListener('click', () => this.#resetView());

    this.#overlay.addEventListener('click', (e) => {
      if (e.target === this.#overlay) this.close();
    });

    this.#boundKeydown = (e) => {
      if (e.key === 'Escape' && this.#isOpen()) this.close();
    };
    document.addEventListener('keydown', this.#boundKeydown);

    if (content) {
      this.#boundWheel = (e) => {
        if (!this.#isOpen()) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? MermaidOverlay.WHEEL_STEP : -MermaidOverlay.WHEEL_STEP;
        this.#setZoom(this.#zoom + delta);
      };
      content.addEventListener('wheel', this.#boundWheel, { passive: false });

      this.#boundMouseDown = (e) => {
        if (!this.#isOpen() || e.button !== 0) return;
        this.#dragging = true;
        this.#dragStartX = e.clientX;
        this.#dragStartY = e.clientY;
        this.#dragStartPanX = this.#panX;
        this.#dragStartPanY = this.#panY;
        content.style.cursor = 'grabbing';
        e.preventDefault();
      };

      this.#boundMouseMove = (e) => {
        if (!this.#dragging) return;
        this.#panX = this.#dragStartPanX + (e.clientX - this.#dragStartX);
        this.#panY = this.#dragStartPanY + (e.clientY - this.#dragStartY);
        this.#applyTransform();
      };

      this.#boundMouseUp = () => {
        if (!this.#dragging) return;
        this.#dragging = false;
        content.style.cursor = '';
      };

      content.addEventListener('mousedown', this.#boundMouseDown);
      document.addEventListener('mousemove', this.#boundMouseMove);
      document.addEventListener('mouseup', this.#boundMouseUp);
    }
  }

  /**
   * Open the overlay with the given SVG markup.
   * @param {string} svgHtml
   */
  open(svgHtml) {
    if (!this.#overlay || !this.#inner) return;
    this.#inner.innerHTML = svgHtml;

    // Apply full SVG fixes via MermaidRenderer (shared logic)
    if (window.MermaidRenderer) {
      window.MermaidRenderer.fixSvg(this.#inner);
    }
    const svg = this.#inner.querySelector('svg');
    if (svg) {
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.style.width = '100%';
      svg.style.height = '100%';
    }

    this.#resetView();
    this.#overlay.classList.add('open');
  }

  /**
   * Close the overlay.
   */
  close() {
    if (!this.#overlay) return;
    this.#overlay.classList.remove('open');
    this.#dragging = false;
  }

  // ─── private ──────────────────────────────────────────────

  #isOpen() {
    return this.#overlay && this.#overlay.classList.contains('open');
  }

  #setZoom(z) {
    this.#zoom = Math.max(MermaidOverlay.MIN_ZOOM, Math.min(MermaidOverlay.MAX_ZOOM, z));
    this.#applyTransform();
    if (this.#zoomLabel) {
      this.#zoomLabel.textContent = Math.round(this.#zoom * 100) + '%';
    }
  }

  #resetView() {
    this.#zoom = 1;
    this.#panX = 0;
    this.#panY = 0;
    this.#applyTransform();
    if (this.#zoomLabel) this.#zoomLabel.textContent = '100%';
  }

  #applyTransform() {
    if (!this.#inner) return;
    this.#inner.style.transform =
      'translate(' + this.#panX + 'px, ' + this.#panY + 'px) scale(' + this.#zoom + ')';
  }

}

window.MermaidOverlay = new MermaidOverlay();
