import * as path from 'path';
import * as vscode from 'vscode';

const DEFAULT_MCP_CONFIG_PATH = '.mcp.json';
const DEFAULT_CANDIDATES = ['.mcp.json', '.cursor/mcp.json'];

export interface McpSettingsEditorState {
  mcpConfigPath: string;
  mcpServers: Record<string, unknown>;
  mcpConfigExists: boolean;
  mcpSource: 'workspace-file' | 'settings' | 'none';
  mcpSourceLabel: string;
  mcpLoadError: string;
}

function getWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

function normalizeToWorkspaceRelative(workspacePath: string, filePath: string): string {
  const relativePath = path.relative(workspacePath, filePath);
  if (!relativePath || relativePath.startsWith('..')) return filePath;
  return relativePath;
}

function resolveConfigPath(workspacePath: string, rawPath: string): string {
  if (!rawPath.trim()) {
    return path.resolve(workspacePath, DEFAULT_MCP_CONFIG_PATH);
  }
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.resolve(workspacePath, rawPath);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

function extractMcpServers(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MCP config должен быть JSON-объектом.');
  }
  const value = raw as { mcpServers?: Record<string, unknown> };
  if (!value.mcpServers || typeof value.mcpServers !== 'object' || Array.isArray(value.mcpServers)) {
    throw new Error('MCP config должен содержать объект "mcpServers".');
  }
  return value.mcpServers;
}

export async function loadMcpSettingsEditorState(): Promise<McpSettingsEditorState> {
  const root = getWorkspaceRoot();
  const workspacePath = root?.uri.fsPath || process.cwd();
  const configuration = vscode.workspace.getConfiguration('aiAssistant');
  const configuredPath = String(configuration.get<string>('mcpConfigPath') || '').trim();
  const settingsServers = configuration.get<Record<string, unknown>>('mcpServers') || {};
  const hasSettingsServers = !!settingsServers && Object.keys(settingsServers).length > 0;

  const candidatePaths = configuredPath
    ? [resolveConfigPath(workspacePath, configuredPath)]
    : DEFAULT_CANDIDATES.map((candidate) => path.resolve(workspacePath, candidate));

  for (const candidatePath of candidatePaths) {
    if (!(await pathExists(candidatePath))) continue;
    try {
      const servers = extractMcpServers(await readJson(candidatePath));
      return {
        mcpConfigPath: normalizeToWorkspaceRelative(workspacePath, candidatePath),
        mcpServers: servers,
        mcpConfigExists: true,
        mcpSource: 'workspace-file',
        mcpSourceLabel: normalizeToWorkspaceRelative(workspacePath, candidatePath),
        mcpLoadError: '',
      };
    } catch (error: any) {
      return {
        mcpConfigPath: normalizeToWorkspaceRelative(workspacePath, candidatePath),
        mcpServers: hasSettingsServers ? settingsServers : {},
        mcpConfigExists: true,
        mcpSource: hasSettingsServers ? 'settings' : 'workspace-file',
        mcpSourceLabel: normalizeToWorkspaceRelative(workspacePath, candidatePath),
        mcpLoadError: error?.message || String(error),
      };
    }
  }

  if (hasSettingsServers) {
    return {
      mcpConfigPath: configuredPath || DEFAULT_MCP_CONFIG_PATH,
      mcpServers: settingsServers,
      mcpConfigExists: false,
      mcpSource: 'settings',
      mcpSourceLabel: 'settings: aiAssistant.mcpServers',
      mcpLoadError: '',
    };
  }

  return {
    mcpConfigPath: configuredPath,
    mcpServers: {},
    mcpConfigExists: false,
    mcpSource: 'none',
    mcpSourceLabel: configuredPath || 'Автопоиск .mcp.json / .cursor/mcp.json',
    mcpLoadError: '',
  };
}

export async function saveMcpSettingsEditorState(input: {
  mcpConfigPath: string;
  mcpServers: Record<string, unknown>;
}): Promise<{ savedPath: string; created: boolean; skipped: boolean }> {
  const root = getWorkspaceRoot();
  const workspacePath = root?.uri.fsPath || process.cwd();
  const configuration = vscode.workspace.getConfiguration('aiAssistant');
  const hasServers = Object.keys(input.mcpServers || {}).length > 0;
  const requestedPath = String(input.mcpConfigPath || '').trim();

  if (!hasServers && !requestedPath) {
    await configuration.update('mcpConfigPath', '', vscode.ConfigurationTarget.Workspace);
    await configuration.update('mcpServers', {}, vscode.ConfigurationTarget.Workspace);
    return { savedPath: '', created: false, skipped: true };
  }

  const resolvedPath = resolveConfigPath(workspacePath, requestedPath || DEFAULT_MCP_CONFIG_PATH);
  const relativePath = normalizeToWorkspaceRelative(workspacePath, resolvedPath);
  const existed = await pathExists(resolvedPath);

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(resolvedPath)));
  const payload = `${JSON.stringify({ mcpServers: input.mcpServers || {} }, null, 2)}\n`;
  await vscode.workspace.fs.writeFile(vscode.Uri.file(resolvedPath), Buffer.from(payload, 'utf8'));

  await configuration.update('mcpConfigPath', relativePath, vscode.ConfigurationTarget.Workspace);
  await configuration.update('mcpServers', {}, vscode.ConfigurationTarget.Workspace);

  return {
    savedPath: relativePath,
    created: !existed,
    skipped: false,
  };
}
