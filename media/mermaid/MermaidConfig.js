class MermaidConfig {
  static #cssVar(name, fallback) {
    var style = getComputedStyle(document.documentElement);
    var value = style.getPropertyValue(name).trim();
    return value || fallback;
  }

  static #parseColor(color) {
    if (!color) return null;

    var value = color.trim();
    if (value.charAt(0) === '#') {
      if (value.length === 4) {
        return {
          r: parseInt(value.charAt(1) + value.charAt(1), 16),
          g: parseInt(value.charAt(2) + value.charAt(2), 16),
          b: parseInt(value.charAt(3) + value.charAt(3), 16),
        };
      }
      if (value.length === 7) {
        return {
          r: parseInt(value.slice(1, 3), 16),
          g: parseInt(value.slice(3, 5), 16),
          b: parseInt(value.slice(5, 7), 16),
        };
      }
    }

    var rgb = value.match(/rgba?\(([^)]+)\)/i);
    if (!rgb) return null;
    var parts = rgb[1].split(',').map(function (part) { return Number(part.trim()); });
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2] };
  }

  static #toHex(color) {
    function clamp(value) {
      return Math.max(0, Math.min(255, Math.round(value)));
    }

    function toPart(value) {
      return clamp(value).toString(16).padStart(2, '0');
    }

    return '#' + toPart(color.r) + toPart(color.g) + toPart(color.b);
  }

  static #normalizeColor(value, fallback) {
    var mount = document.body || document.documentElement;
    var probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.color = fallback;
    mount.appendChild(probe);
    probe.style.color = value;
    var computed = getComputedStyle(probe).color || fallback;
    probe.remove();

    var parsed = MermaidConfig.#parseColor(computed) || MermaidConfig.#parseColor(fallback) || { r: 16, g: 21, b: 29 };
    return MermaidConfig.#toHex(parsed);
  }

  static #mix(left, right, rightRatio) {
    var leftColor = MermaidConfig.#parseColor(left) || { r: 0, g: 0, b: 0 };
    var rightColor = MermaidConfig.#parseColor(right) || { r: 255, g: 255, b: 255 };
    var ratio = Math.max(0, Math.min(1, rightRatio));
    return MermaidConfig.#toHex({
      r: leftColor.r * (1 - ratio) + rightColor.r * ratio,
      g: leftColor.g * (1 - ratio) + rightColor.g * ratio,
      b: leftColor.b * (1 - ratio) + rightColor.b * ratio,
    });
  }

  static #fontFamily() {
    return MermaidConfig.#cssVar('--vscode-font-family', '"Segoe UI", sans-serif');
  }

  static #isDark(color) {
    if (!color) return true;

    var hex = color.trim();
    if (hex.charAt(0) === '#') {
      if (hex.length === 4) {
        hex = '#' + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2) + hex.charAt(3) + hex.charAt(3);
      }
      if (hex.length === 7) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return ((r * 299) + (g * 587) + (b * 114)) / 1000 < 150;
      }
    }

    var rgb = color.match(/rgba?\(([^)]+)\)/i);
    if (!rgb) return true;
    var parts = rgb[1].split(',').map(function (part) { return Number(part.trim()); });
    return ((parts[0] * 299) + (parts[1] * 587) + (parts[2] * 114)) / 1000 < 150;
  }

  static #theme() {
    var canvas = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-editor-background', '#10151d'), '#10151d');
    var surfaceBase = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-sideBar-background', '#151c26'), '#151c26');
    var elevatedBase = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-editorWidget-background', '#19212d'), '#19212d');
    var border = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-panel-border', '#294055'), '#294055');
    var accent = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-focusBorder', '#5ea1ff'), '#5ea1ff');
    var accentSoft = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-textLink-foreground', accent), accent);
    var text = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-foreground', '#e7edf7'), '#e7edf7');
    var muted = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-descriptionForeground', '#94a3b8'), '#94a3b8');
    var success = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-terminal-ansiGreen', '#4ade80'), '#4ade80');
    var danger = MermaidConfig.#normalizeColor(MermaidConfig.#cssVar('--vscode-errorForeground', '#f87171'), '#f87171');

    return {
      canvas: canvas,
      surface: MermaidConfig.#mix(surfaceBase, canvas, 0.22),
      elevated: MermaidConfig.#mix(elevatedBase, canvas, 0.26),
      cluster: MermaidConfig.#mix(canvas, accent, 0.18),
      note: MermaidConfig.#mix(elevatedBase, '#ffffff', 0.18),
      border: border,
      borderSoft: MermaidConfig.#mix(border, accent, 0.34),
      accent: accent,
      accentSoft: accentSoft,
      text: text,
      muted: muted,
      success: success,
      danger: danger,
      darkMode: MermaidConfig.#isDark(canvas),
    };
  }

  static readPalette() {
    return MermaidConfig.#theme();
  }

  static #themeVariables(theme) {
    return {
      background: 'transparent',
      primaryColor: theme.surface,
      primaryTextColor: theme.text,
      primaryBorderColor: theme.borderSoft,
      secondaryColor: theme.elevated,
      secondaryTextColor: theme.text,
      secondaryBorderColor: theme.border,
      tertiaryColor: theme.cluster,
      tertiaryTextColor: theme.text,
      tertiaryBorderColor: theme.border,
      mainBkg: theme.surface,
      secondBkg: theme.elevated,
      tertiaryBkg: theme.cluster,
      nodeBkg: theme.surface,
      clusterBkg: theme.cluster,
      clusterBorder: theme.border,
      defaultLinkColor: theme.accentSoft,
      lineColor: theme.accentSoft,
      edgeLabelBackground: theme.elevated,
      textColor: theme.text,
      mainContrastColor: theme.text,
      fontFamily: MermaidConfig.#fontFamily(),
      fontSize: '14px',
      labelBackground: theme.elevated,
      actorBkg: theme.surface,
      actorBorder: theme.borderSoft,
      actorTextColor: theme.text,
      actorLineColor: theme.accentSoft,
      signalColor: theme.text,
      signalTextColor: theme.text,
      noteBkgColor: theme.note,
      noteTextColor: theme.text,
      noteBorderColor: theme.borderSoft,
      activationBkgColor: theme.elevated,
      activationBorderColor: theme.border,
      sectionBkgColor: theme.surface,
      sectionBkgColor2: theme.elevated,
      sectionBorderColor: theme.border,
      titleColor: theme.text,
      taskBkgColor: theme.surface,
      taskBorderColor: theme.border,
      taskTextColor: theme.text,
      gridColor: theme.border,
      todayLineColor: theme.accent,
      errorBkgColor: theme.note,
      errorTextColor: theme.danger,
      cScale0: theme.surface,
      cScale1: theme.elevated,
      cScale2: theme.cluster,
      cScaleLabel0: theme.text,
      cScaleLabel1: theme.text,
      cScaleLabel2: theme.text,
      classText: theme.text,
      labelBoxBkgColor: theme.elevated,
      labelBoxBorderColor: theme.border,
      labelTextColor: theme.text,
      loopTextColor: theme.text,
      relationColor: theme.accentSoft,
      relationLabelColor: theme.muted,
      stateLabelColor: theme.text,
      stateBkg: theme.surface,
      stateBorder: theme.border,
    };
  }

  static #themeCss(theme) {
    return [
      'svg { background: transparent; }',
      '.node rect, .node circle, .node ellipse, .node polygon, .node path { rx: 12px; ry: 12px; stroke-width: 1.4px; }',
      '.cluster rect { rx: 14px; ry: 14px; stroke-dasharray: 6 4; }',
      '.edgeLabel rect { rx: 8px; ry: 8px; opacity: 1; }',
      '.label text, text { letter-spacing: 0; }',
      '.node .label, .edgeLabel .label, .cluster .label { font-weight: 500; }',
      '.messageText, .labelBox, .loopText, .noteText { font-size: 13px; }',
      '.messageLine0, .messageLine1, .relation, .edgePath path, .flowchart-link { stroke-width: 1.6px; stroke-linecap: round; stroke-linejoin: round; }',
      '.actor, .actor-man, .classTitle, .section0, .section1, .section2, .section3 { filter: none; }',
    ].join('\n');
  }

  static build(overrides) {
    var theme = MermaidConfig.#theme();

    return Object.assign({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      darkMode: theme.darkMode,
      fontFamily: MermaidConfig.#fontFamily(),
      fontSize: 14,
      logLevel: 'error',
      deterministicIds: true,
      deterministicIDSeed: 'mmd',
      maxTextSize: 100000,
      maxEdges: 1000,
      suppressErrorRendering: true,
      markdownAutoWrap: true,
      themeVariables: MermaidConfig.#themeVariables(theme),
      themeCSS: MermaidConfig.#themeCss(theme),
      flowchart: {
        curve: 'linear',
        nodeSpacing: 38,
        rankSpacing: 62,
        padding: 12,
        wrappingWidth: 220,
        useMaxWidth: true,
        htmlLabels: false,
      },
      sequence: {
        diagramMarginX: 36,
        diagramMarginY: 18,
        actorMargin: 48,
        width: 150,
        height: 56,
        boxMargin: 12,
        noteMargin: 12,
        messageMargin: 28,
        useMaxWidth: true,
        wrap: true,
      },
      class: {
        useMaxWidth: true,
        htmlLabels: false,
      },
      state: {
        useMaxWidth: true,
      },
      gantt: {
        useMaxWidth: true,
      },
    }, overrides || {});
  }
}

window.MermaidConfig = MermaidConfig;
