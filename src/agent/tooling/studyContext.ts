const STUDY_TOOLS = new Set([
  'read_file',
  'read_file_range',
  'extract_symbols',
  'lsp_inspect',
  'get_diagnostics',
  'read_lints',
]);

function normalizePath(value: string): string {
  return value.trim().replace(/^\.?\//, '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function addPath(target: Set<string>, rawPath: unknown): void {
  if (typeof rawPath !== 'string') return;
  const normalized = normalizePath(rawPath);
  if (!normalized) return;
  target.add(normalized);
}

function collectCallPaths(toolName: string, args: any): Set<string> {
  const paths = new Set<string>();
  if (!STUDY_TOOLS.has(toolName) || !args || typeof args !== 'object') {
    return paths;
  }

  addPath(paths, args.path);
  addPath(paths, args.file);
  addPath(paths, args.target_notebook);
  addPath(paths, args.notebook);

  if (Array.isArray(args.paths)) {
    for (const value of args.paths) addPath(paths, value);
  }

  return paths;
}

export function collectStudiedFilesFromUsedCalls(usedCalls: Set<string>): Set<string> {
  const studiedFiles = new Set<string>();

  for (const key of usedCalls) {
    const separator = key.indexOf(':');
    if (separator <= 0) continue;

    const toolName = key.slice(0, separator);
    if (!STUDY_TOOLS.has(toolName)) continue;

    try {
      const args = JSON.parse(key.slice(separator + 1));
      for (const filePath of collectCallPaths(toolName, args)) {
        studiedFiles.add(filePath);
      }
    } catch {
      // Ignore malformed call keys.
    }
  }

  return studiedFiles;
}

export function hasStudiedFile(studiedFiles: Set<string> | undefined, filePath: string): boolean {
  if (!studiedFiles?.size) return false;
  return studiedFiles.has(normalizePath(filePath));
}

export function normalizeStudyPath(filePath: string): string {
  return normalizePath(filePath);
}
