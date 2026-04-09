import { extractFileHintsFromText } from '../../tooling/workspace';

export class CoverageMemory {
  readonly topDirs = new Set<string>();
  readonly readFiles = new Set<string>();

  registerPath(hint: string): void {
    const normalized = hint.trim().replace(/^\.?\//, '').replace(/\\/g, '/');
    if (!normalized) return;

    const parts = normalized.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length >= 2) {
      this.topDirs.add(parts[0]);
    }

    const lastSegment = parts[parts.length - 1] || '';
    if (/\.[a-z0-9]{1,8}$/i.test(lastSegment)) {
      this.readFiles.add(normalized);
    }
  }

  registerPathsFromArgs(args: any): void {
    for (const filePath of collectPathsFromArgs(args)) {
      this.registerPath(filePath);
    }
  }

  registerHintsFromText(text: string): void {
    for (const hint of extractFileHintsFromText(text)) {
      this.registerPath(hint);
    }
  }
}

export function getReadTopDirs(usedCalls: Set<string>): string[] {
  const dirs = new Set<string>();
  for (const key of usedCalls) {
    if (!key.startsWith('read_file:') && !key.startsWith('read_file_range:')) continue;
    try {
      const raw = key.slice(key.indexOf(':') + 1);
      const args = JSON.parse(raw);
      const filePath: string | undefined = args.path;
      if (!filePath || typeof filePath !== 'string') continue;
      const parts = filePath.split(/[\\/]/).filter(Boolean);
      if (parts.length >= 2) dirs.add(parts[0]);
    } catch {
      // Ignore malformed call keys.
    }
  }
  return [...dirs];
}

function collectPathsFromArgs(args: any): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  const add = (value: any) => {
    if (typeof value !== 'string') return;
    const normalized = value.trim().replace(/\\/g, '/');
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    paths.push(normalized);
  };
  const addTextHints = (value: any) => {
    if (typeof value !== 'string') return;
    for (const hint of extractFileHintsFromText(value)) add(hint);
  };

  add(args?.path);
  add(args?.file);
  if (Array.isArray(args?.paths)) for (const item of args.paths) add(item);
  if (Array.isArray(args?.files)) for (const item of args.files) add(item);
  addTextHints(args?.prompt);
  addTextHints(args?.task);
  addTextHints(args?.query);
  addTextHints(args?.goal);
  addTextHints(args?.instruction);
  addTextHints(args?.focus);
  addTextHints(args?.description);
  addTextHints(args?.details);
  addTextHints(args?.objective);
  addTextHints(args?.request);

  if (Array.isArray(args?.tasks)) {
    for (const task of args.tasks) {
      if (!task || typeof task !== 'object') continue;
      add(task.path);
      add(task.file);
      if (Array.isArray(task.paths)) for (const item of task.paths) add(item);
      if (Array.isArray(task.files)) for (const item of task.files) add(item);
      addTextHints(task.prompt);
      addTextHints(task.task);
      addTextHints(task.query);
      addTextHints(task.goal);
      addTextHints(task.instruction);
      addTextHints(task.focus);
      addTextHints(task.description);
      addTextHints(task.details);
      addTextHints(task.objective);
      addTextHints(task.request);
    }
  }

  return paths;
}
