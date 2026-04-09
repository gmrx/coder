import * as fs from 'fs/promises';
import * as path from 'path';

export type AgentTaskKind = 'generic' | 'shell';
export type AgentTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface AgentTaskRecord {
  id: string;
  kind: AgentTaskKind;
  subject: string;
  description: string;
  activeForm?: string;
  status: AgentTaskStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  stopRequestedAt?: number;
  command?: string;
  cwd?: string;
  pid?: number;
  childPid?: number;
  stdoutPath?: string;
  stderrPath?: string;
  exitCode?: number;
  signal?: string | null;
  metadata?: Record<string, unknown>;
  note?: string;
}

const TASK_STORE_DIR = '.cursorcoder/tasks';
const PENDING_TIMEOUT_MS = 15_000;

function getWorkspaceRootPath(explicitRootPath?: string): string {
  if (explicitRootPath) return path.resolve(explicitRootPath);
  try {
    const mod = require('../worktreeSession') as { getAgentWorkspaceRootPath?: () => string | undefined };
    const workspaceRoot = mod.getAgentWorkspaceRootPath?.();
    if (workspaceRoot) return path.resolve(workspaceRoot);
  } catch {
    // Background task runner executes outside VS Code and must not require the vscode module.
  }
  return path.resolve(process.cwd());
}

export function getTaskStoreRootPath(explicitRootPath?: string): string {
  return path.join(getWorkspaceRootPath(explicitRootPath), TASK_STORE_DIR);
}

export function getTaskDirPath(taskId: string, explicitRootPath?: string): string {
  return path.join(getTaskStoreRootPath(explicitRootPath), taskId);
}

export function getTaskFilePath(taskId: string, explicitRootPath?: string): string {
  return path.join(getTaskDirPath(taskId, explicitRootPath), 'task.json');
}

export function getTaskStdoutPath(taskId: string, explicitRootPath?: string): string {
  return path.join(getTaskDirPath(taskId, explicitRootPath), 'stdout.log');
}

export function getTaskStderrPath(taskId: string, explicitRootPath?: string): string {
  return path.join(getTaskDirPath(taskId, explicitRootPath), 'stderr.log');
}

export function toTaskWorkspaceRelativePath(filePath: string | undefined, explicitRootPath?: string): string {
  if (!filePath) return '';
  const workspaceRoot = getWorkspaceRootPath(explicitRootPath);
  const relative = path.relative(workspaceRoot, path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, '/')
    : path.resolve(filePath);
}

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function createTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureTaskDir(taskId: string, explicitRootPath?: string): Promise<void> {
  await fs.mkdir(getTaskDirPath(taskId, explicitRootPath), { recursive: true });
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeTaskRecord(input: AgentTaskRecord): AgentTaskRecord {
  return {
    ...input,
    id: String(input.id || '').trim(),
    kind: input.kind === 'shell' ? 'shell' : 'generic',
    subject: String(input.subject || '').trim(),
    description: String(input.description || '').trim(),
    status: input.status || 'pending',
    createdAt: Number(input.createdAt || Date.now()),
    updatedAt: Number(input.updatedAt || Date.now()),
    ...(hasText(input.activeForm) ? { activeForm: String(input.activeForm).trim() } : {}),
    ...(input.startedAt ? { startedAt: Number(input.startedAt) } : {}),
    ...(input.finishedAt ? { finishedAt: Number(input.finishedAt) } : {}),
    ...(input.stopRequestedAt ? { stopRequestedAt: Number(input.stopRequestedAt) } : {}),
    ...(hasText(input.command) ? { command: String(input.command).trim() } : {}),
    ...(hasText(input.cwd) ? { cwd: String(input.cwd).trim() } : {}),
    ...(Number.isFinite(input.pid) ? { pid: Number(input.pid) } : {}),
    ...(Number.isFinite(input.childPid) ? { childPid: Number(input.childPid) } : {}),
    ...(hasText(input.stdoutPath) ? { stdoutPath: String(input.stdoutPath) } : {}),
    ...(hasText(input.stderrPath) ? { stderrPath: String(input.stderrPath) } : {}),
    ...(Number.isFinite(input.exitCode) ? { exitCode: Number(input.exitCode) } : {}),
    ...(input.signal !== undefined ? { signal: input.signal || null } : {}),
    ...(input.metadata && typeof input.metadata === 'object' ? { metadata: { ...input.metadata } } : {}),
    ...(hasText(input.note) ? { note: String(input.note).trim() } : {}),
  };
}

export async function createTaskRecord(
  input: {
    id?: string;
    kind?: AgentTaskKind;
    subject: string;
    description?: string;
    activeForm?: string;
    status?: AgentTaskStatus;
    command?: string;
    cwd?: string;
    stdoutPath?: string;
    stderrPath?: string;
    metadata?: Record<string, unknown>;
    note?: string;
  },
  explicitRootPath?: string,
): Promise<AgentTaskRecord> {
  const id = hasText(input.id) ? String(input.id).trim() : createTaskId();
  const now = Date.now();
  const record = normalizeTaskRecord({
    id,
    kind: input.kind === 'shell' ? 'shell' : 'generic',
    subject: String(input.subject || '').trim(),
    description: String(input.description || input.subject || '').trim(),
    ...(hasText(input.activeForm) ? { activeForm: String(input.activeForm).trim() } : {}),
    status: input.status || 'pending',
    createdAt: now,
    updatedAt: now,
    ...(hasText(input.command) ? { command: String(input.command).trim() } : {}),
    ...(hasText(input.cwd) ? { cwd: String(input.cwd).trim() } : {}),
    ...(hasText(input.stdoutPath) ? { stdoutPath: String(input.stdoutPath).trim() } : {}),
    ...(hasText(input.stderrPath) ? { stderrPath: String(input.stderrPath).trim() } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(hasText(input.note) ? { note: String(input.note).trim() } : {}),
  });

  await ensureTaskDir(id, explicitRootPath);
  await writeTaskRecord(record, explicitRootPath);
  return record;
}

export async function writeTaskRecord(record: AgentTaskRecord, explicitRootPath?: string): Promise<void> {
  await ensureTaskDir(record.id, explicitRootPath);
  await writeJsonAtomic(getTaskFilePath(record.id, explicitRootPath), normalizeTaskRecord(record));
}

export async function readTaskRecord(taskId: string, explicitRootPath?: string): Promise<AgentTaskRecord | null> {
  const filePath = getTaskFilePath(taskId, explicitRootPath);
  if (!(await pathExists(filePath))) return null;
  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as AgentTaskRecord;
    return normalizeTaskRecord(raw);
  } catch {
    return null;
  }
}

export async function patchTaskRecord(
  taskId: string,
  patch:
    | Partial<AgentTaskRecord>
    | ((current: AgentTaskRecord) => AgentTaskRecord),
  explicitRootPath?: string,
): Promise<AgentTaskRecord | null> {
  const current = await readTaskRecord(taskId, explicitRootPath);
  if (!current) return null;
  const next = typeof patch === 'function'
    ? patch(current)
    : {
      ...current,
      ...patch,
    };
  const normalized = normalizeTaskRecord({
    ...current,
    ...next,
    updatedAt: Date.now(),
  });
  await writeTaskRecord(normalized, explicitRootPath);
  return normalized;
}

function isProcessRunning(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

export async function syncTaskRecordState(
  record: AgentTaskRecord,
  explicitRootPath?: string,
): Promise<AgentTaskRecord> {
  if (record.kind !== 'shell') return record;
  if (!['pending', 'in_progress'].includes(record.status)) return record;

  const wrapperRunning = isProcessRunning(record.pid);
  const childRunning = isProcessRunning(record.childPid);
  if (wrapperRunning || childRunning) {
    if (record.status === 'pending' && (wrapperRunning || childRunning)) {
      const next = await patchTaskRecord(
        record.id,
        {
          status: 'in_progress',
          ...(record.startedAt ? {} : { startedAt: Date.now() }),
        },
        explicitRootPath,
      );
      return next || record;
    }
    return record;
  }

  if (record.status === 'pending' && Date.now() - record.createdAt < PENDING_TIMEOUT_MS) {
    return record;
  }

  const inferredStatus: AgentTaskStatus = record.stopRequestedAt ? 'cancelled' : 'failed';
  const inferredNote = record.stopRequestedAt
    ? 'Background job был остановлен до завершения.'
    : 'Background job завершился без финального статуса runner-а.';
  const next = await patchTaskRecord(
    record.id,
    {
      status: inferredStatus,
      ...(record.startedAt ? {} : { startedAt: record.createdAt }),
      finishedAt: Date.now(),
      note: record.note || inferredNote,
    },
    explicitRootPath,
  );
  return next || record;
}

export async function listTaskRecords(explicitRootPath?: string): Promise<AgentTaskRecord[]> {
  const rootPath = getTaskStoreRootPath(explicitRootPath);
  if (!(await pathExists(rootPath))) return [];
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const tasks: AgentTaskRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const task = await readTaskRecord(entry.name, explicitRootPath);
    if (!task) continue;
    tasks.push(await syncTaskRecordState(task, explicitRootPath));
  }
  return tasks.sort((left, right) => {
    const rightTime = right.updatedAt || right.createdAt;
    const leftTime = left.updatedAt || left.createdAt;
    return rightTime - leftTime;
  });
}

export async function stopTaskProcess(
  taskId: string,
  options?: { force?: boolean; rootPath?: string },
): Promise<AgentTaskRecord | null> {
  const rootPath = options?.rootPath;
  const current = await readTaskRecord(taskId, rootPath);
  if (!current) return null;

  const signal: NodeJS.Signals = options?.force ? 'SIGKILL' : 'SIGTERM';
  let signalled = false;
  for (const pid of [current.childPid, current.pid]) {
    if (!Number.isInteger(pid) || Number(pid) <= 0) continue;
    try {
      process.kill(Number(pid), signal);
      signalled = true;
    } catch {
      // Ignore stale pid values.
    }
  }

  const next = await patchTaskRecord(
    taskId,
    {
      ...(signalled ? { status: current.status === 'pending' ? 'cancelled' : current.status } : {}),
      stopRequestedAt: Date.now(),
      note: signalled
        ? options?.force
          ? 'Остановлена принудительно.'
          : 'Запрошена остановка background job.'
        : current.note || 'Процесс уже не активен.',
    },
    rootPath,
  );
  return next || current;
}

export function buildBackgroundShellTaskSubject(command: string): string {
  const value = String(command || '').replace(/\s+/g, ' ').trim();
  return value.length <= 72 ? value : `${value.slice(0, 71).trimEnd()}…`;
}
