import * as vscode from 'vscode';
import { ProjectStructureOverview, EntrypointsInfo } from '../core/types';
import { IGNORE_PATTERN } from '../core/constants';

export async function scanWorkspaceStructure(): Promise<ProjectStructureOverview[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return [];

  const results: ProjectStructureOverview[] = [];
  for (const folder of folders) {
    const allFiles = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*'), IGNORE_PATTERN, 5000
    );
    const relPaths = allFiles.map(f => vscode.workspace.asRelativePath(f, false));

    const dirCount = new Map<string, number>();
    const importantFiles: string[] = [];
    const importantNames = new Set([
      'package.json', 'tsconfig.json', 'pyproject.toml', 'setup.py', 'setup.cfg',
      'Cargo.toml', 'go.mod', 'Makefile', 'Dockerfile', 'docker-compose.yml',
      'docker-compose.yaml', '.env.example', 'README.md', 'readme.md',
      'requirements.txt', 'Pipfile', 'pom.xml', 'build.gradle',
    ]);

    for (const rel of relPaths) {
      const parts = rel.split(/[\\/]/);
      if (parts.length > 1) dirCount.set(parts[0], (dirCount.get(parts[0]) || 0) + 1);
      if (importantNames.has(parts[parts.length - 1])) importantFiles.push(rel);
    }

    const topDirectories = [...dirCount.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    results.push({ rootName: folder.name, topDirectories, importantFiles: importantFiles.slice(0, 15) });
  }
  return results;
}

export async function listAllProjectFiles(): Promise<{ root: string; files: string[] }[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return [];
  const result: { root: string; files: string[] }[] = [];
  for (const folder of folders) {
    const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'), IGNORE_PATTERN, 5000);
    result.push({ root: folder.name, files: found.map(f => vscode.workspace.asRelativePath(f, false)).sort() });
  }
  return result;
}

export async function detectStackAndEntrypoints(): Promise<EntrypointsInfo> {
  const languageGuesses: string[] = [];
  const entryFiles: string[] = [];

  const checks: [string, string][] = [
    ['**/package.json', 'Node.js / TypeScript'], ['**/tsconfig.json', 'TypeScript'],
    ['**/pyproject.toml', 'Python'], ['**/requirements.txt', 'Python'], ['**/setup.py', 'Python'],
    ['**/Cargo.toml', 'Rust'], ['**/go.mod', 'Go'], ['**/pom.xml', 'Java'], ['**/build.gradle', 'Java'],
  ];
  for (const [glob, lang] of checks) {
    if ((await vscode.workspace.findFiles(glob, IGNORE_PATTERN, 1)).length > 0 && !languageGuesses.includes(lang)) {
      languageGuesses.push(lang);
    }
  }

  const entryPatterns = [
    '**/main.py', '**/app.py', '**/manage.py', '**/index.ts', '**/index.tsx', '**/index.js',
    '**/main.ts', '**/main.tsx', '**/main.go', '**/main.rs',
    '**/App.tsx', '**/App.ts', '**/App.vue', '**/App.svelte', '**/server.ts', '**/server.js',
  ];
  for (const pat of entryPatterns) {
    for (const f of await vscode.workspace.findFiles(pat, IGNORE_PATTERN, 3)) {
      const rel = vscode.workspace.asRelativePath(f, false);
      if (!entryFiles.includes(rel)) entryFiles.push(rel);
    }
  }
  return { languageGuesses, entryFiles: entryFiles.slice(0, 10) };
}
