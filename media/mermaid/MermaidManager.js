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

    try {
      if (typeof window.mermaid !== 'undefined') {
        MermaidManager.#initializeMermaid();
      }

      if (window.MermaidOverlay && typeof window.MermaidOverlay.bind === 'function') {
        window.MermaidOverlay.bind();
      }

      MermaidManager.#renderer = new (window.MermaidRenderer || MermaidRenderer)();
    } catch (error) {
      console.error('[AI-Assistant] Mermaid init failed:', error);
      MermaidManager.#renderer = null;
    }
  }

  /**
   * Process all Mermaid code blocks inside a container element.
   * Must be called *after* Markdown has been rendered into HTML.
   *
   * @param {HTMLElement} container
   * @returns {Promise<void>}
   */
  static async processContainer(container) {
    try {
      if (!MermaidManager.#renderer) MermaidManager.init();
      if (!MermaidManager.#renderer || !MermaidManager.#renderer.available) return;

      if (typeof window.mermaid !== 'undefined' && window.MermaidConfig) {
        MermaidManager.#initializeMermaid();
      }

      await MermaidManager.#renderer.renderAllIn(container);
    } catch (error) {
      console.error('[AI-Assistant] Mermaid render failed:', error);
    }
  }

  /**
   * Release all tracked diagram instances.
   */
  static destroyAll() {
    if (MermaidManager.#renderer) MermaidManager.#renderer.destroyAll();
  }

  static #initializeMermaid() {
    try {
      var cfg = window.MermaidConfig
        ? window.MermaidConfig.build()
        : MermaidManager.#fallbackConfig();
      window.mermaid.initialize(cfg);
    } catch (error) {
      console.error('[AI-Assistant] Mermaid custom config failed, using fallback config:', error);
      window.mermaid.initialize(MermaidManager.#fallbackConfig());
    }
  }

  static #fallbackConfig() {
    return {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      htmlLabels: false,
      logLevel: 'error',
      suppressErrorRendering: true,
    };
  }
}

window.MermaidManager = MermaidManager;
