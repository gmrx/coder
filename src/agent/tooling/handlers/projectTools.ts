import * as vscode from 'vscode';
import { IGNORE_PATTERN } from '../../../core/constants';
import { detectStackAndEntrypoints, listAllProjectFiles, scanWorkspaceStructure } from '../../../analysis/scanner';
import { getAgentWorkspaceFolder, toAgentRelativePath } from '../../worktreeSession';
import {
  buildFileSearchOutput,
  buildFileSearchPresentation,
  normalizeFileSearchOutputMode,
  buildListFilesOutput,
  buildListFilesPresentation,
  normalizeFileListOutputMode,
  normalizeListPagination,
  normalizeSearchPagination,
} from '../fileStudy';
import {
  buildStackDetectionOutput,
  buildStackDetectionPresentation,
  buildStructureScanOutput,
  buildStructureScanPresentation,
  normalizeStackOutputMode,
  normalizeStructureOutputMode,
  type InfraEntry,
} from '../projectStudy';
import { createToolExecutionResult } from '../results';
import type { ToolHandlerMap } from '../types';

export const projectToolHandlers: ToolHandlerMap = {
  async scan_structure(args) {
    const overviews = await scanWorkspaceStructure();
    const { limit, offset } = normalizeListPagination(args);
    const outputMode = normalizeStructureOutputMode(args?.outputMode || args?.mode || args?.view);
    const content = buildStructureScanOutput(overviews, { outputMode, limit, offset });
    return createToolExecutionResult('scan_structure', 'success', content, {
      presentation: {
        kind: 'project_study',
        data: buildStructureScanPresentation(overviews, { outputMode, limit, offset, content }),
      },
    });
  },

  async list_files(args) {
    const allFiles = await listAllProjectFiles();
    const allPaths: string[] = [];
    for (const group of allFiles) allPaths.push(...group.files);

    const rawTarget = (args?.path || args?.dir || args?.target_directory || '').toString().trim();
    const { limit, offset } = normalizeListPagination(args);
    const outputMode = normalizeFileListOutputMode(args?.outputMode || args?.mode || args?.view);

    if (!rawTarget || rawTarget === '.' || rawTarget === './') {
      const content = buildListFilesOutput(allPaths, {
        limit,
        offset,
        outputMode,
      });
      return createToolExecutionResult('list_files', 'success', content, {
        presentation: {
          kind: 'file_collection',
          data: buildListFilesPresentation({
            paths: allPaths,
            limit,
            offset,
            outputMode,
            content,
          }),
        },
      });
    }

    const target = normalizeTargetDirectory(rawTarget);
    const filtered = allPaths.filter((value) => value === target || value.startsWith(target + '/'));
    const content = buildListFilesOutput(filtered, {
      rawTarget,
      limit,
      offset,
      outputMode,
    });
    return createToolExecutionResult('list_files', 'success', content, {
      presentation: {
        kind: 'file_collection',
        data: buildListFilesPresentation({
          paths: filtered,
          rawTarget,
          limit,
          offset,
          outputMode,
          content,
        }),
      },
    });
  },

  async glob(args) {
    return findFilesByPattern(args);
  },

  async find_files(args) {
    return findFilesByPattern(args);
  },

  async detect_stack(args) {
    const info = await detectStackAndEntrypoints();
    const infraChecks: Array<[string, string]> = [
      ['**/docker-compose*.{yml,yaml}', 'Docker Compose'],
      ['**/Dockerfile*', 'Docker'],
      ['**/.github/workflows/*.{yml,yaml}', 'GitHub Actions'],
      ['**/.gitlab-ci.yml', 'GitLab CI'],
      ['**/Jenkinsfile', 'Jenkins'],
      ['**/k8s/**/*.{yml,yaml}', 'Kubernetes'],
      ['**/terraform/**/*.tf', 'Terraform'],
      ['**/nginx*.conf', 'Nginx'],
      ['**/pom.xml', 'Java/Maven'],
      ['**/build.gradle*', 'Java/Gradle'],
      ['**/*.csproj', 'C#/.NET'],
      ['**/composer.json', 'PHP/Composer'],
      ['**/Gemfile', 'Ruby'],
      ['**/pubspec.yaml', 'Dart/Flutter'],
      ['**/Package.swift', 'Swift'],
      ['**/mix.exs', 'Elixir'],
    ];

    const infraEntries: InfraEntry[] = [];
    for (const [globPattern, label] of infraChecks) {
      const folder = getAgentWorkspaceFolder();
      const matches = folder
        ? await vscode.workspace.findFiles(new vscode.RelativePattern(folder, globPattern.replace(/^\*\*\//, '')), IGNORE_PATTERN, 1)
        : [];
      if (matches.length > 0) {
        infraEntries.push({
          label,
          path: toAgentRelativePath(matches[0]),
        });
      }
    }

    const { limit, offset } = normalizeSearchPagination(args);
    const outputMode = normalizeStackOutputMode(args?.outputMode || args?.mode || args?.view);
    const payload = {
      languageGuesses: info.languageGuesses,
      entryFiles: info.entryFiles,
      infraEntries,
    };
    const content = buildStackDetectionOutput(payload, {
      outputMode,
      limit,
      offset,
    });
    return createToolExecutionResult('detect_stack', 'success', content, {
      presentation: {
        kind: 'project_study',
        data: buildStackDetectionPresentation(payload, { outputMode, limit, offset, content }),
      },
    });
  },
};

async function findFilesByPattern(args: any) {
  const pattern = (args?.glob_pattern || args?.pattern || '').toString().trim();
  const toolName = args?.glob_pattern ? 'glob' : 'find_files';
  if (!pattern) {
    const content = '(паттерн не указан — укажи "pattern")';
    return createToolExecutionResult(toolName, 'error', content, {
      presentation: {
        kind: 'file_collection',
        data: {
          toolName,
          outputMode: 'flat',
          resultCount: 0,
          summary: 'Поиск файлов завершился с ошибкой',
          detail: 'Паттерн не указан',
          pattern: '',
        },
      },
    });
  }

  const rawTargetDirectory = (args?.target_directory || args?.directory || args?.dir || '').toString().trim();
  const targetDirectory = rawTargetDirectory ? normalizeTargetDirectory(rawTargetDirectory) : undefined;
  const { limit, offset } = normalizeSearchPagination(args);
  const outputMode = normalizeFileSearchOutputMode(args?.outputMode || args?.mode || args?.view);
  const folder = getAgentWorkspaceFolder();
  const fetchLimit = Math.min(2000, offset + limit + 1);

  let searchPattern: vscode.GlobPattern = pattern;
  if (targetDirectory && folder) {
    searchPattern = new vscode.RelativePattern(
      vscode.Uri.joinPath(folder.uri, targetDirectory),
      pattern.replace(/^\*\*\//, ''),
    );
  }

  let uris = await vscode.workspace.findFiles(searchPattern, IGNORE_PATTERN, fetchLimit);
  if (uris.length === 0) {
    const hasGlobMeta = /[*?[\]{}]/.test(pattern);
    if (!hasGlobMeta) {
      const fallbackPatterns = [`**/*${pattern}*`, `**/${pattern}/**/*`];
      for (const fallbackPattern of fallbackPatterns) {
        const fallbackSearchPattern = targetDirectory && folder
          ? new vscode.RelativePattern(
            vscode.Uri.joinPath(folder.uri, targetDirectory),
            fallbackPattern.replace(/^\*\*\//, ''),
          )
          : fallbackPattern;
        uris = await vscode.workspace.findFiles(fallbackSearchPattern, IGNORE_PATTERN, fetchLimit);
        if (uris.length > 0) break;
      }
    }
  }

  if (uris.length === 0) {
    const content = `Файлы по "${pattern}"${targetDirectory ? ` в ${rawTargetDirectory}` : ''} не найдены.`;
    return createToolExecutionResult(toolName, 'success', content, {
      presentation: {
        kind: 'file_collection',
        data: buildFileSearchPresentation({
          toolName,
          paths: [],
          pattern,
          rawTarget: rawTargetDirectory || undefined,
          outputMode,
          limit,
          offset,
          maybeMore: false,
          content,
        }),
      },
    });
  }

  const withStats = await Promise.all(
    uris.map(async (uri) => {
      try {
        return { uri, mtime: (await vscode.workspace.fs.stat(uri)).mtime };
      } catch {
        return { uri, mtime: 0 };
      }
    }),
  );

  const paths = rankFoundPaths(
    withStats.map((entry) => ({
      path: toAgentRelativePath(entry.uri),
      mtime: entry.mtime,
    })),
    pattern,
    args?.glob_pattern ? 'glob' : 'find_files',
  );

  const content = buildFileSearchOutput(toolName, paths, {
    pattern,
    rawTarget: rawTargetDirectory || undefined,
    outputMode,
    limit,
    offset,
    maybeMore: paths.length === fetchLimit,
  });
  return createToolExecutionResult(toolName, 'success', content, {
    presentation: {
      kind: 'file_collection',
      data: buildFileSearchPresentation({
        toolName,
        paths,
        pattern,
        rawTarget: rawTargetDirectory || undefined,
        outputMode,
        limit,
        offset,
        maybeMore: paths.length === fetchLimit,
        content,
      }),
    },
  });
}

function normalizeTargetDirectory(value: string): string {
  return value.replace(/^\.?\//, '').replace(/\/+$/, '');
}

function rankFoundPaths(
  entries: Array<{ path: string; mtime: number }>,
  pattern: string,
  toolName: 'glob' | 'find_files',
): string[] {
  if (toolName === 'glob' && /[*?[\]{}]/.test(pattern)) {
    return entries
      .sort((left, right) => right.mtime - left.mtime || left.path.localeCompare(right.path))
      .map((entry) => entry.path);
  }

  const normalizedPattern = pattern.toLowerCase().replace(/[*?[\]{}]/g, '').trim();
  const terms = normalizedPattern.split(/[^a-z0-9_.-]+/i).filter(Boolean);

  return entries
    .sort((left, right) => {
      const scoreDelta = scoreFoundPath(right.path, right.mtime, normalizedPattern, terms)
        - scoreFoundPath(left.path, left.mtime, normalizedPattern, terms);
      if (scoreDelta !== 0) return scoreDelta;
      return left.path.localeCompare(right.path);
    })
    .map((entry) => entry.path);
}

function scoreFoundPath(
  filePath: string,
  mtime: number,
  normalizedPattern: string,
  terms: string[],
): number {
  const lower = filePath.toLowerCase();
  const basename = lower.split('/').pop() || lower;
  let score = 0;

  if (normalizedPattern) {
    if (basename === normalizedPattern) score += 120;
    if (lower === normalizedPattern) score += 100;
    if (basename.startsWith(normalizedPattern)) score += 40;
    if (basename.includes(normalizedPattern)) score += 28;
    if (lower.includes(normalizedPattern)) score += 18;
  }

  for (const term of terms) {
    if (basename === term) score += 60;
    else if (basename.startsWith(term)) score += 20;
    else if (basename.includes(term)) score += 12;
    else if (lower.includes(term)) score += 7;
  }

  if (/^(readme|index|main|app|router|config|package|tsconfig|vite\.config|webpack\.config|pyproject|cargo|go\.mod)/.test(basename)) {
    score += 8;
  }

  score += Math.min(12, Math.floor(mtime / 86_400_000));
  return score;
}
