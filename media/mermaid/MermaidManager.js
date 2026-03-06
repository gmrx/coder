/**
 * MermaidManager — top-level façade that wires Config → Renderer → Overlay.
 *
 * Usage (from chat-markdown.js or similar):
 *
 *   MermaidManager.init();                       // once on load
 *   await MermaidManager.processContainer(el);   // after injecting markdown
 */
class MermaidManager {

  /** @type {MermaidRenderer | null} */
  static #renderer = null;

  /** Whether init() has been called. */
  static #initialized = false;

  /**
   * Initialise Mermaid library + overlay.
   * Safe to call multiple times (idempotent).
   */
  static init() {
    if (MermaidManager.#initialized) return;
    MermaidManager.#initialized = true;

    if (typeof window.mermaid !== 'undefined') {
      const cfg = window.MermaidConfig
        ? window.MermaidConfig.build()
        : { startOnLoad: false, theme: 'dark', securityLevel: 'loose' };
      window.mermaid.initialize(cfg);
    }

    if (window.MermaidOverlay && typeof window.MermaidOverlay.bind === 'function') {
      window.MermaidOverlay.bind();
    }

    MermaidManager.#renderer = new (window.MermaidRenderer || MermaidRenderer)();
  }

  /**
   * Process all Mermaid code blocks inside a container element.
   * Must be called *after* Markdown has been rendered into HTML.
   *
   * @param {HTMLElement} container
   * @returns {Promise<void>}
   */
  static async processContainer(container) {
    if (!MermaidManager.#renderer) MermaidManager.init();
    if (!MermaidManager.#renderer || !MermaidManager.#renderer.available) return;

    // Re-initialize before each render batch to ensure themeCSS is applied
    if (typeof window.mermaid !== 'undefined' && window.MermaidConfig) {
      window.mermaid.initialize(window.MermaidConfig.build());
    }

    await MermaidManager.#renderer.renderAllIn(container);
  }

  /**
   * Release all tracked diagram instances.
   */
  static destroyAll() {
    if (MermaidManager.#renderer) MermaidManager.#renderer.destroyAll();
  }
}

window.MermaidManager = MermaidManager;
