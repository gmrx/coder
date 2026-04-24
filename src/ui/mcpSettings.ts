import { readConfig, saveConfig } from '../core/api';

export interface McpSettingsEditorState {
  mcpConfigPath: string;
  mcpServers: Record<string, unknown>;
  mcpConfigExists: boolean;
  mcpSource: 'settings' | 'none';
  mcpSourceLabel: string;
  mcpLoadError: string;
}

export async function loadMcpSettingsEditorState(): Promise<McpSettingsEditorState> {
  const config = readConfig();
  const settingsServers = config.mcpServers || {};
  const hasSettingsServers = !!settingsServers && Object.keys(settingsServers).length > 0;

  if (hasSettingsServers) {
    return {
      mcpConfigPath: '',
      mcpServers: settingsServers,
      mcpConfigExists: false,
      mcpSource: 'settings',
      mcpSourceLabel: 'settings: aiAssistant.mcpServers',
      mcpLoadError: '',
    };
  }

  return {
    mcpConfigPath: '',
    mcpServers: {},
    mcpConfigExists: false,
    mcpSource: 'none',
    mcpSourceLabel: 'settings: aiAssistant.mcpServers',
    mcpLoadError: '',
  };
}

export async function saveMcpSettingsEditorState(input: {
  mcpConfigPath: string;
  mcpServers: Record<string, unknown>;
}): Promise<{ savedPath: string; created: boolean; skipped: boolean }> {
  const hasServers = Object.keys(input.mcpServers || {}).length > 0;

  if (!hasServers) {
    await saveConfig({
      mcpConfigPath: '',
      mcpServers: {},
    });
    return { savedPath: '', created: false, skipped: true };
  }

  await saveConfig({
    mcpConfigPath: '',
    mcpServers: input.mcpServers || {},
  });

  return {
    savedPath: '',
    created: false,
    skipped: false,
  };
}
