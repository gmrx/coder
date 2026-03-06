/**
 * MermaidConfig — centralized Mermaid.js configuration.
 *
 * Uses the built-in 'dark' theme (proven to work correctly with Mermaid v11)
 * instead of 'base' which has broken edge/fill rendering.
 */
class MermaidConfig {

  static FLOWCHART = {
    titleTopMargin: 25,
    subGraphTitleMargin: { top: 8, bottom: 4 },
    diagramPadding: 16,
    nodeSpacing: 60,
    rankSpacing: 50,
    curve: 'basis',
    wrappingWidth: 200,
    padding: 12,
    defaultRenderer: 'dagre-wrapper',
    useMaxWidth: true,
    htmlLabels: true,
  };

  static SEQUENCE = {
    diagramMarginX: 50,
    diagramMarginY: 10,
    actorMargin: 60,
    width: 150,
    height: 65,
    boxMargin: 10,
    boxTextMargin: 5,
    noteMargin: 10,
    messageMargin: 40,
    messageAlign: 'center',
    mirrorActors: true,
    showSequenceNumbers: false,
    wrap: true,
    wrapPadding: 10,
    useMaxWidth: true,
  };

  static CLASS = {
    titleTopMargin: 25,
    diagramPadding: 16,
    padding: 8,
    dividerMargin: 10,
    nodeSpacing: 60,
    rankSpacing: 70,
    defaultRenderer: 'dagre-wrapper',
    useMaxWidth: true,
    htmlLabels: false,
  };

  static STATE = {
    titleTopMargin: 25,
    padding: 8,
    dividerMargin: 10,
    defaultRenderer: 'dagre-wrapper',
    noteMargin: 10,
    useMaxWidth: true,
  };

  /**
   * Build the full config object for `mermaid.initialize()`.
   */
  static build(overrides = {}) {
    return {
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'dark',
      darkMode: true,
      htmlLabels: true,
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
      fontSize: 14,
      logLevel: 'error',
      arrowMarkerAbsolute: true,
      markdownAutoWrap: true,
      deterministicIds: true,
      deterministicIDSeed: 'mmd',
      maxTextSize: 100000,
      maxEdges: 1000,
      suppressErrorRendering: true,

      flowchart: { ...MermaidConfig.FLOWCHART },
      sequence:  { ...MermaidConfig.SEQUENCE },
      class:     { ...MermaidConfig.CLASS },
      state:     { ...MermaidConfig.STATE },

      ...overrides,
    };
  }
}

window.MermaidConfig = MermaidConfig;
