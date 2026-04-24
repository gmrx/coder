(function () {
  'use strict';

  var vscode = acquireVsCodeApi();
  var toastEl = document.getElementById('toast');
  var navButtons = Array.prototype.slice.call(document.querySelectorAll('[data-settings-nav]'));
  var panes = Array.prototype.slice.call(document.querySelectorAll('[data-settings-pane]'));
  var initialState = (typeof vscode.getState === 'function' && vscode.getState()) || {};
  var toastTimer = null;
  var activeSection = typeof initialState.settingsSection === 'string' ? initialState.settingsSection : 'models';

  function showToast(message, ms) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, ms || 2800);
  }

  function createFallbackController() {
    return {
      requestSettings: function () {},
      handleSettingsData: function () {},
      handleConnectionResult: function () {},
      handleModelTestsResult: function () {},
      handleMcpInspectionResult: function () {},
      handleSettingsSaved: function () {}
    };
  }

  var settings = (window.ChatSettings && window.ChatSettings.createSettingsController)
    ? window.ChatSettings.createSettingsController({
        vscode: vscode,
        showToast: showToast,
        onCancel: function () {
          vscode.postMessage({ type: 'closeSettingsPanel' });
        }
      })
    : createFallbackController();

  function persistState() {
    if (typeof vscode.setState !== 'function') return;
    try {
      vscode.setState({
        settingsSection: activeSection
      });
    } catch (_) {}
  }

  function setActiveSection(sectionId) {
    var next = sectionId || 'models';
    activeSection = next;
    navButtons.forEach(function (button) {
      var isActive = button && button.dataset && button.dataset.settingsNav === next;
      button.classList.toggle('is-active', !!isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    panes.forEach(function (pane) {
      var isActive = pane && pane.dataset && pane.dataset.settingsPane === next;
      pane.classList.toggle('is-active', !!isActive);
    });
    persistState();
  }

  navButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      if (!button || !button.dataset) return;
      setActiveSection(button.dataset.settingsNav || 'models');
    });
  });

  function handleMessage(event) {
    var msg = event.data || {};
    switch (msg.type) {
      case 'settingsData':
        if (msg.data && msg.data.settingsSection) {
          setActiveSection(msg.data.settingsSection);
        }
        settings.handleSettingsData(msg);
        if (
          msg.data &&
          msg.data.highlightModelSelectionIssue &&
          msg.data.modelSelectionIssue &&
          msg.data.modelSelectionIssue.message
        ) {
          showToast(msg.data.modelSelectionIssue.message, 4200);
        }
        return;
      case 'connectionResult':
        settings.handleConnectionResult(msg);
        return;
      case 'modelTestsResult':
        settings.handleModelTestsResult(msg);
        return;
      case 'mcpInspectionResult':
        settings.handleMcpInspectionResult(msg);
        return;
      case 'jiraCheckResult':
        settings.handleJiraCheckResult(msg);
        return;
      case 'tfsCheckResult':
        settings.handleTfsCheckResult(msg);
        return;
      case 'settingsSaved':
        settings.handleSettingsSaved(msg);
        return;
      case 'error':
        if (msg.text) showToast(msg.text, 3600);
        return;
      case 'status':
        if (msg.text) showToast(msg.text, 2200);
        return;
      default:
        return;
    }
  }

  window.addEventListener('message', handleMessage);
  setActiveSection(activeSection);
  settings.requestSettings();
})();
