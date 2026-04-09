import * as path from 'path';
import { truncate } from '../../core/utils';

export type ShellCommandRisk = 'inspect' | 'check' | 'project-write' | 'destructive';
export type ShellCommandKind =
  | 'tests'
  | 'build'
  | 'lint'
  | 'git'
  | 'files'
  | 'search'
  | 'packages'
  | 'shell';

export interface ShellCommandDescriptor {
  kind: ShellCommandKind;
  kindLabel: string;
  risk: ShellCommandRisk;
  riskLabel: string;
  readOnly: boolean;
  destructive: boolean;
  summary: string;
}

export interface ShellExecutionParams {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: string | null;
}

export type ShellExecutionStatus = 'success' | 'degraded' | 'error';

export interface ShellResultPresentation {
  status: ShellExecutionStatus | 'blocked';
  command?: string;
  cwd?: string;
  exitCode?: number;
  signal?: string | null;
  summary: string;
  detail: string;
  nextStep?: string;
  descriptor?: ShellCommandDescriptor;
  insight?: string;
  artifact?: ShellArtifactInfo;
  stdout?: string;
  stderr?: string;
  outputPreview?: string;
  backgroundTaskId?: string;
  backgroundStdoutPath?: string;
  backgroundStderrPath?: string;
}

export type ShellArtifactInfo = {
  path: string;
  fileName: string;
  sizeText?: string;
};

function normalizeCommand(command: string): string {
  return String(command || '').trim().replace(/\s+/g, ' ');
}

function matches(command: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(command));
}

export function classifyShellCommand(command: string): ShellCommandDescriptor {
  const normalized = normalizeCommand(command).toLowerCase();

  const destructive = matches(normalized, [
    /\brm\b/,
    /\bgit\s+reset\b/,
    /\bgit\s+clean\b/,
    /\bfind\b.*\b-delete\b/,
    /\bchmod\b/,
    /\bchown\b/,
  ]);

  if (matches(normalized, [/\b(npm|pnpm|yarn|bun)\s+(test|run\s+(test|check))\b/i, /\bpytest\b/i, /\bvitest\b/i, /\bjest\b/i, /\bgo\s+test\b/i, /\bcargo\s+test\b/i])) {
    return {
      kind: 'tests',
      kindLabel: 'Проверки',
      risk: 'check',
      riskLabel: 'проверка проекта',
      readOnly: true,
      destructive: false,
      summary: 'Команда запускает тесты или проверку проекта.',
    };
  }

  if (matches(normalized, [/\b(npm|pnpm|yarn|bun)\s+run\s+build\b/i, /\btsc\b/i, /\bvite\s+build\b/i, /\bnext\s+build\b/i, /\bcargo\s+build\b/i, /\bgo\s+build\b/i])) {
    return {
      kind: 'build',
      kindLabel: 'Сборка',
      risk: 'check',
      riskLabel: 'сборка или typecheck',
      readOnly: true,
      destructive: false,
      summary: 'Команда запускает сборку или typecheck.',
    };
  }

  if (matches(normalized, [/\beslint\b/i, /\bstylelint\b/i, /\bruff\b/i, /\bmypy\b/i, /\b(npm|pnpm|yarn|bun)\s+run\s+lint\b/i])) {
    return {
      kind: 'lint',
      kindLabel: 'Линтинг',
      risk: 'check',
      riskLabel: 'проверка качества',
      readOnly: true,
      destructive: false,
      summary: 'Команда запускает линтер или статическую проверку.',
    };
  }

  if (matches(normalized, [/\bgit\s+(status|diff|log|show|branch)\b/i])) {
    return {
      kind: 'git',
      kindLabel: 'Git',
      risk: 'inspect',
      riskLabel: 'чтение репозитория',
      readOnly: true,
      destructive: false,
      summary: 'Команда читает состояние репозитория.',
    };
  }

  if (matches(normalized, [/\b(ls|pwd|tree|cat|head|tail|wc)\b/i])) {
    return {
      kind: 'files',
      kindLabel: 'Файлы',
      risk: 'inspect',
      riskLabel: 'просмотр файлов',
      readOnly: true,
      destructive: false,
      summary: 'Команда просматривает файлы или директории.',
    };
  }

  if (matches(normalized, [/\b(rg|grep|find)\b/i])) {
    return {
      kind: 'search',
      kindLabel: 'Поиск',
      risk: 'inspect',
      riskLabel: 'поиск по проекту',
      readOnly: true,
      destructive: false,
      summary: 'Команда ищет по файлам или тексту.',
    };
  }

  if (matches(normalized, [/\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update)\b/i, /\bpip\s+install\b/i, /\bgo\s+get\b/i, /\bcargo\s+add\b/i])) {
    return {
      kind: 'packages',
      kindLabel: 'Пакеты',
      risk: 'project-write',
      riskLabel: 'может менять зависимости',
      readOnly: false,
      destructive: false,
      summary: 'Команда может менять lockfile, зависимости или окружение проекта.',
    };
  }

  return {
    kind: 'shell',
    kindLabel: 'Shell',
    risk: destructive ? 'destructive' : 'project-write',
    riskLabel: destructive ? 'рискованное изменение' : 'может менять проект',
    readOnly: false,
    destructive,
    summary: destructive
      ? 'Команда может существенно менять проект или файловую систему.'
      : 'Команда выполняется в терминале и может менять проект.',
  };
}

function buildSuccessSummary(descriptor: ShellCommandDescriptor): string {
  switch (descriptor.kind) {
    case 'tests':
      return 'Проверки завершились успешно.';
    case 'build':
      return 'Сборка завершилась успешно.';
    case 'lint':
      return 'Линтинг завершился успешно.';
    case 'git':
      return 'Git-команда выполнилась успешно.';
    case 'files':
      return 'Команда просмотра файлов завершилась.';
    case 'search':
      return 'Команда поиска завершилась.';
    case 'packages':
      return 'Команда работы с пакетами завершилась.';
    default:
      return descriptor.destructive ? 'Рискованная команда выполнена.' : 'Shell-команда выполнена.';
  }
}

function buildFailureSummary(descriptor: ShellCommandDescriptor, exitCode: number, signal?: string | null): string {
  const suffix = signal ? ` (signal: ${signal})` : ` (exit ${exitCode})`;
  switch (descriptor.kind) {
    case 'tests':
      return `Проверки завершились с ошибкой${suffix}.`;
    case 'build':
      return `Сборка завершилась с ошибкой${suffix}.`;
    case 'lint':
      return `Линтинг завершился с ошибкой${suffix}.`;
    case 'git':
      return `Git-команда завершилась с ошибкой${suffix}.`;
    case 'files':
      return `Команда просмотра файлов завершилась с ошибкой${suffix}.`;
    case 'search':
      return `Команда поиска завершилась с ошибкой${suffix}.`;
    case 'packages':
      return `Команда работы с пакетами завершилась с ошибкой${suffix}.`;
    default:
      return descriptor.destructive
        ? `Рискованная команда завершилась с ошибкой${suffix}.`
        : `Shell-команда завершилась с ошибкой${suffix}.`;
  }
}

function countRegexMatches(text: string, pattern: RegExp): number {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function sumCapturedCounts(text: string, patterns: RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    const matches = String(text || '').matchAll(pattern);
    for (const match of matches) {
      total += Number(match[1] || 0);
    }
  }
  return total;
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function extractVsixArtifact(output: string, cwd: string): ShellArtifactInfo | null {
  const packagedMatch = String(output || '').match(/Packaged:\s+(.+?\.vsix)(?:\s*\(([^)]*)\))?/i);
  const genericMatch = String(output || '').match(/(?:^|\s)(\/[^\s]+?\.vsix|\.\.?\/[^\s]+?\.vsix|[A-Za-z0-9._-]+\.vsix)(?:\s|$)/m);
  const rawPath = (packagedMatch?.[1] || genericMatch?.[1] || '').trim();
  if (!rawPath) return null;

  const resolvedPath = rawPath.startsWith('/') ? rawPath : path.resolve(cwd || '.', rawPath);
  const sizeText = packagedMatch?.[2]
    ?.split(',')
    .map((part) => part.trim())
    .find((part) => /\b(?:kb|mb|gb)\b/i.test(part));

  return {
    path: resolvedPath,
    fileName: path.basename(resolvedPath),
    ...(sizeText ? { sizeText } : {}),
  };
}

function buildShellInsight(
  params: ShellExecutionParams,
  descriptor: ShellCommandDescriptor,
  status: ShellExecutionStatus,
): string | undefined {
  const stdout = String(params.stdout || '');
  const stderr = String(params.stderr || '');
  const output = `${stdout}\n${stderr}`;
  const normalized = normalizeCommand(params.command).toLowerCase();
  const baseCommand = extractBaseCommand(params.command).toLowerCase();
  const vsixArtifact = extractVsixArtifact(output, params.cwd);

  if (vsixArtifact && status === 'success') {
    return vsixArtifact.sizeText
      ? `VSIX-пакет ${vsixArtifact.fileName} создан (${vsixArtifact.sizeText}).`
      : `VSIX-пакет ${vsixArtifact.fileName} создан.`;
  }

  if (descriptor.kind === 'git') {
    const branch = output.match(/^On branch\s+(.+)$/mi)?.[1]?.trim()
      || output.match(/^##\s+([^\s.]+)/m)?.[1]?.trim();
    if (/nothing to commit, working tree clean/i.test(output) || /working tree clean/i.test(output)) {
      return branch ? `Ветка ${branch}, рабочее дерево чистое.` : 'Рабочее дерево чистое.';
    }
    const shortStatusLines = stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => /^(M|A|D|R|C|U|\?\?)\s+/.test(line) || /^[ MARCUD?!]{1,2}\s+/.test(line));
    if (shortStatusLines.length > 0) {
      return branch
        ? `Ветка ${branch}, есть изменения в ${shortStatusLines.length} ${pluralize(shortStatusLines.length, 'файле', 'файлах', 'файлах')}.`
        : `Есть изменения в ${shortStatusLines.length} ${pluralize(shortStatusLines.length, 'файле', 'файлах', 'файлах')}.`;
    }
    const diffStat = output.match(/(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/i);
    if (diffStat) {
      const files = Number(diffStat[1] || 0);
      const insertions = Number(diffStat[2] || 0);
      const deletions = Number(diffStat[3] || 0);
      const delta = [];
      if (insertions) delta.push(`+${insertions}`);
      if (deletions) delta.push(`-${deletions}`);
      return `Diff по ${files} ${pluralize(files, 'файлу', 'файлам', 'файлам')}${delta.length ? ` (${delta.join(' / ')})` : ''}.`;
    }
    if (/^commit\s+[a-f0-9]{7,40}/mi.test(output)) {
      return 'Показан commit и его изменения.';
    }
    if (/^\*\s+/m.test(stdout) || /^\s+[^\s]/m.test(stdout)) {
      return 'Показан список веток.';
    }
  }

  if (descriptor.kind === 'tests') {
    const failed = sumCapturedCounts(output, [
      /(\d+)\s+failed\b/ig,
      /(\d+)\s+failing\b/ig,
    ]);
    const passed = sumCapturedCounts(output, [
      /(\d+)\s+passed\b/ig,
      /(\d+)\s+passing\b/ig,
    ]);
    const skipped = sumCapturedCounts(output, [
      /(\d+)\s+skipped\b/ig,
      /(\d+)\s+pending\b/ig,
    ]);
    if (passed || failed || skipped) {
      const parts = [];
      if (passed) parts.push(`${passed} passed`);
      if (failed) parts.push(`${failed} failed`);
      if (skipped) parts.push(`${skipped} skipped`);
      return `Тесты: ${parts.join(', ')}.`;
    }
    if (/no tests?|0 tests?/i.test(output)) {
      return 'Тесты не обнаружены.';
    }
    return status === 'success' ? 'Тесты прошли.' : undefined;
  }

  if (descriptor.kind === 'build') {
    const tsErrors = countRegexMatches(output, /error TS\d+:/g);
    const warnings = sumCapturedCounts(output, [/(\d+)\s+warnings?\b/ig]);
    const genericErrors = sumCapturedCounts(output, [/(\d+)\s+errors?\b/ig]);
    const errorCount = Math.max(tsErrors, genericErrors);
    if (errorCount > 0) {
      return warnings > 0
        ? `Сборка: ${errorCount} ${pluralize(errorCount, 'ошибка', 'ошибки', 'ошибок')} и ${warnings} ${pluralize(warnings, 'предупреждение', 'предупреждения', 'предупреждений')}.`
        : `Сборка: ${errorCount} ${pluralize(errorCount, 'ошибка', 'ошибки', 'ошибок')}.`;
    }
    if (/compiled successfully|build completed|build finished|built in|found 0 errors|0 errors/i.test(output)) {
      return warnings > 0
        ? `Сборка прошла, предупреждений: ${warnings}.`
        : 'Сборка прошла без ошибок.';
    }
  }

  if (descriptor.kind === 'lint') {
    const eslintProblems = output.match(/(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/i);
    if (eslintProblems) {
      const problems = Number(eslintProblems[1] || 0);
      const errors = Number(eslintProblems[2] || 0);
      const warnings = Number(eslintProblems[3] || 0);
      return `Линт: ${problems} ${pluralize(problems, 'проблема', 'проблемы', 'проблем')} (${errors} errors, ${warnings} warnings).`;
    }
    const mypyOk = /success:\s+no issues found/i.test(output);
    if (mypyOk) return 'Статическая проверка без замечаний.';
    const errors = sumCapturedCounts(output, [/found\s+(\d+)\s+errors?/ig, /(\d+)\s+errors?\b/ig]);
    const warnings = sumCapturedCounts(output, [/(\d+)\s+warnings?\b/ig]);
    if (errors || warnings) {
      const parts = [];
      if (errors) parts.push(`${errors} errors`);
      if (warnings) parts.push(`${warnings} warnings`);
      return `Линт: ${parts.join(', ')}.`;
    }
    if (status === 'success') return 'Линтинг без замечаний.';
  }

  if (descriptor.kind === 'search') {
    if ((baseCommand === 'rg' || baseCommand === 'grep') && status === 'success') {
      if (params.exitCode === 1) return 'Совпадений не найдено.';
      const count = stdout.split('\n').map((line) => line.trim()).filter(Boolean).length;
      if (count > 0) {
        return `Найдено ${count} ${pluralize(count, 'совпадение', 'совпадения', 'совпадений')}.`;
      }
    }
  }

  if (descriptor.kind === 'packages') {
    const added = sumCapturedCounts(output, [/added\s+(\d+)\s+packages?/ig]);
    const removed = sumCapturedCounts(output, [/removed\s+(\d+)\s+packages?/ig]);
    if (added || removed) {
      const parts = [];
      if (added) parts.push(`добавлено ${added}`);
      if (removed) parts.push(`удалено ${removed}`);
      return `Зависимости обновлены: ${parts.join(', ')}.`;
    }
  }

  if (descriptor.kind === 'files') {
    if (/^total\s+\d+/m.test(stdout)) {
      return 'Получен список файлов.';
    }
    if (baseCommand === 'pwd' && stdout.trim()) {
      return `Текущая директория: ${stdout.trim()}.`;
    }
  }

  if (descriptor.kind === 'shell' && status === 'success' && normalized.startsWith('git status')) {
    return 'Состояние репозитория прочитано.';
  }

  return undefined;
}

function extractBaseCommand(command: string): string {
  const segments = normalizeCommand(command)
    .split(/\|\||&&|;|\|/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const primary = (segments[segments.length - 1] || command).trim();
  return primary.split(/\s+/)[0] || '';
}

function interpretShellExit(params: ShellExecutionParams, descriptor: ShellCommandDescriptor): {
  status: ShellExecutionStatus;
  summary: string;
} {
  if (params.exitCode === 0) {
    return { status: 'success', summary: buildSuccessSummary(descriptor) };
  }

  const baseCommand = extractBaseCommand(params.command).toLowerCase();
  const normalized = normalizeCommand(params.command).toLowerCase();

  if (baseCommand === 'grep' || baseCommand === 'rg') {
    if (params.exitCode === 1) {
      return {
        status: 'success',
        summary: 'Совпадений не найдено.',
      };
    }
  }

  if (baseCommand === 'diff' || /^git\s+diff\b/.test(normalized)) {
    if (params.exitCode === 1) {
      return {
        status: 'success',
        summary: 'Различия найдены.',
      };
    }
  }

  if (baseCommand === 'test' || baseCommand === '[') {
    if (params.exitCode === 1) {
      return {
        status: 'success',
        summary: 'Условие ложно.',
      };
    }
  }

  if (baseCommand === 'find' && params.exitCode === 1) {
    return {
      status: 'degraded',
      summary: 'Команда выполнилась частично: часть директорий недоступна.',
    };
  }

  return {
    status: 'error',
    summary: buildFailureSummary(descriptor, params.exitCode, params.signal),
  };
}

function buildOutputSection(label: string, content: string): string {
  const trimmed = String(content || '').trim();
  if (!trimmed) return '';
  return `${label}:\n${truncate(trimmed, 6000)}`;
}

function buildShellNextStepHint(
  params: ShellExecutionParams,
  descriptor: ShellCommandDescriptor,
  status: ShellExecutionStatus,
): string {
  const baseCommand = extractBaseCommand(params.command).toLowerCase();
  const output = `${params.stdout || ''}\n${params.stderr || ''}`;
  const vsixArtifact = extractVsixArtifact(output, params.cwd);

  if (vsixArtifact && status === 'success') {
    return `Если пакет готов, установи его через Extensions: Install from VSIX... или code --install-extension ${vsixArtifact.fileName}.`;
  }

  if (descriptor.kind === 'search') {
    if (baseCommand === 'rg' || baseCommand === 'grep') {
      return status === 'success' && params.exitCode === 1
        ? 'Уточни шаблон поиска или перейди к find_files/glob, если ищешь не текст, а файл.'
        : 'Если совпадения важны, открой найденный файл через read_file или read_file_range.';
    }
    if (baseCommand === 'find') {
      return 'Если нужно сузить область, попробуй find_files или list_files по конкретной директории.';
    }
  }

  if (descriptor.kind === 'tests' || descriptor.kind === 'build' || descriptor.kind === 'lint') {
    return status === 'error' || status === 'degraded'
      ? 'Если ошибка относится к коду, смотри get_diagnostics/read_lints, затем read_file_range по проблемному файлу.'
      : 'Если нужен разбор результата, открой проблемные участки через get_diagnostics или read_file_range.';
  }

  if (descriptor.kind === 'git') {
    return 'Если дальше нужны правки, сначала прочитай нужный файл через read_file или read_file_range.';
  }

  if (descriptor.kind === 'files') {
    return 'Если нашёл нужный файл, переходи к read_file, read_file_range или extract_symbols.';
  }

  if (descriptor.kind === 'packages') {
    return 'Если команда изменила зависимости, проверь manifest и lockfile через read_file manifest.';
  }

  return descriptor.readOnly
    ? 'Если этого контекста достаточно, переходи к следующему анализу или правке.'
    : 'Перед следующей мутацией проверь, что состояние проекта всё ещё соответствует ожиданиям.';
}

export function buildShellApprovalMeta(command: string, cwd: string): {
  commandKind: string;
  summary: string;
  riskLabel: string;
  readOnly: boolean;
  destructive: boolean;
  cwdLabel: string;
} {
  const descriptor = classifyShellCommand(command);
  return {
    commandKind: descriptor.kindLabel,
    summary: descriptor.summary,
    riskLabel: descriptor.riskLabel,
    readOnly: descriptor.readOnly,
    destructive: descriptor.destructive,
    cwdLabel: path.basename(cwd || '') || cwd || '.',
  };
}

function buildShellStatusText(params: ShellExecutionParams): string {
  return `exit ${params.exitCode}${params.signal ? `, signal ${params.signal}` : ''}`;
}

export function buildShellExecutionPresentation(
  params: ShellExecutionParams,
): ShellResultPresentation {
  const descriptor = classifyShellCommand(params.command);
  const semantic = interpretShellExit(params, descriptor);
  const artifact = extractVsixArtifact(`${params.stdout || ''}\n${params.stderr || ''}`, params.cwd);
  const insight = buildShellInsight(params, descriptor, semantic.status);
  const nextStep = buildShellNextStepHint(params, descriptor, semantic.status);
  const outputPreview = buildShellOutputPreview(params.stdout, params.stderr);
  const metaLine = `${descriptor.kindLabel} • ${descriptor.riskLabel} • ${buildShellStatusText(params)}`;
  const detailLines = [metaLine];

  if (artifact?.path) {
    detailLines.push(
      artifact.sizeText
        ? `Артефакт: ${artifact.path} (${artifact.sizeText})`
        : `Артефакт: ${artifact.path}`,
    );
  }

  if (insight && insight !== semantic.summary) {
    detailLines.unshift(`Итог: ${insight}`);
  }

  return {
    status: semantic.status,
    command: params.command,
    cwd: params.cwd,
    exitCode: params.exitCode,
    signal: params.signal ?? null,
    summary: insight || semantic.summary,
    detail: detailLines.join('\n'),
    ...(nextStep ? { nextStep } : {}),
    descriptor,
    ...(insight ? { insight } : {}),
    ...(artifact ? { artifact } : {}),
    ...(params.stdout ? { stdout: params.stdout } : {}),
    ...(params.stderr ? { stderr: params.stderr } : {}),
    ...(outputPreview ? { outputPreview } : {}),
  };
}

export function buildBlockedShellPresentation(
  command: string,
  cwd: string,
  detail: string,
): ShellResultPresentation {
  return buildShellPreflightPresentation(command, cwd, detail, 'blocked');
}

export function buildShellPreflightPresentation(
  command: string,
  cwd: string,
  detail: string,
  status: 'blocked' | 'error' = 'error',
): ShellResultPresentation {
  const descriptor = classifyShellCommand(command);
  return {
    status,
    command,
    cwd,
    summary: status === 'blocked' ? 'Команда не выполнена' : 'Некорректный вызов shell',
    detail: [
      `${descriptor.kindLabel} • ${descriptor.riskLabel} • ${status === 'blocked' ? 'не выполнена' : 'вызов отклонён до выполнения'}`,
      compactLine(detail, 220),
    ].filter(Boolean).join('\n'),
    descriptor,
  };
}

export function buildShellBackgroundPresentation(input: {
  command: string;
  cwd: string;
  taskId: string;
  stdoutPath?: string;
  stderrPath?: string;
}): ShellResultPresentation {
  const descriptor = classifyShellCommand(input.command);
  return {
    status: 'success',
    command: input.command,
    cwd: input.cwd,
    summary: `Команда запущена в фоне как task #${input.taskId}.`,
    detail: [
      `${descriptor.kindLabel} • ${descriptor.riskLabel} • background job`,
      `Task: #${input.taskId}`,
      input.stdoutPath ? `stdout: ${input.stdoutPath}` : '',
      input.stderrPath ? `stderr: ${input.stderrPath}` : '',
    ].filter(Boolean).join('\n'),
    nextStep: `Проверь статус задачи: ${JSON.stringify({ tool: 'task_get', args: { id: input.taskId } })}`,
    descriptor,
    backgroundTaskId: input.taskId,
    ...(input.stdoutPath ? { backgroundStdoutPath: input.stdoutPath } : {}),
    ...(input.stderrPath ? { backgroundStderrPath: input.stderrPath } : {}),
  };
}

export function formatShellExecutionResult(params: ShellExecutionParams): string {
  const presentation = buildShellExecutionPresentation(params);
  const descriptor = presentation.descriptor || classifyShellCommand(params.command);
  const headline = presentation.status === 'error'
    ? `Ошибка: ${presentation.summary}`
    : presentation.status === 'degraded'
      ? `Команда выполнена с замечанием: ${presentation.summary}`
      : `Команда выполнена: ${presentation.summary}`;
  const lines = [
    headline,
    `Тип: ${descriptor.kindLabel}`,
    `Риск: ${descriptor.riskLabel}`,
    `cwd: ${params.cwd}`,
    `Команда: ${params.command}`,
    `Статус: ${buildShellStatusText(params)}`,
  ];

  if (presentation.artifact) {
    lines.push(`Артефакт: ${presentation.artifact.path}`);
    if (presentation.artifact.sizeText) {
      lines.push(`Размер: ${presentation.artifact.sizeText}`);
    }
  }

  if (presentation.insight && presentation.insight !== presentation.summary) {
    lines.push(`Итог: ${presentation.insight}`);
  }

  const stdoutSection = buildOutputSection('stdout', params.stdout);
  const stderrSection = buildOutputSection('stderr', params.stderr);

  if (stdoutSection) lines.push('', stdoutSection);
  if (stderrSection) lines.push('', stderrSection);
  if (!stdoutSection && !stderrSection) lines.push('', '(пусто)');

  if (presentation.nextStep) {
    lines.push('', `Следующий шаг: ${presentation.nextStep}`);
  }

  return lines.join('\n').trim();
}

export function formatShellBackgroundResult(input: {
  command: string;
  cwd: string;
  taskId: string;
  stdoutPath?: string;
  stderrPath?: string;
}): string {
  const presentation = buildShellBackgroundPresentation(input);
  const lines = [
    `Команда переведена в background: ${presentation.summary}`,
    `cwd: ${input.cwd}`,
    `Команда: ${input.command}`,
    `Task: ${input.taskId}`,
    input.stdoutPath ? `stdout: ${input.stdoutPath}` : '',
    input.stderrPath ? `stderr: ${input.stderrPath}` : '',
    '',
    `Следующий шаг: ${presentation.nextStep}`,
  ].filter(Boolean);
  return lines.join('\n').trim();
}

export function parseShellExecutionPresentation(content: string): ShellResultPresentation {
  const value = String(content || '').trim();

  if (!value) {
    return { status: 'success', summary: 'Команда завершена', detail: '' };
  }

  if (
    /^Команда отклонена пользователем:/i.test(value) ||
    /^Команда заблокирована:/i.test(value) ||
    /^Команда не выполнена:\s+(ожидание подтверждения прервано|подтверждение не получено)/i.test(value) ||
    /многострочные команды запрещены/i.test(value)
  ) {
    return {
      status: 'blocked',
      summary: 'Команда не выполнена',
      detail: compactLine(value),
    };
  }

  const kindMatch = value.match(/^Тип:\s+(.+)$/m);
  const riskMatch = value.match(/^Риск:\s+(.+)$/m);
  const statusMatch = value.match(/^Статус:\s+(.+)$/m);
  const artifactMatch = value.match(/^Артефакт:\s+(.+)$/m);
  const sizeMatch = value.match(/^Размер:\s+(.+)$/m);
  const insightMatch = value.match(/^Итог:\s+(.+)$/m);
  const nextStepMatch = value.match(/^Следующий шаг:\s+(.+)$/m);
  const stdout = extractLabeledSection(value, 'stdout', ['stderr', 'Следующий шаг']);
  const stderr = extractLabeledSection(value, 'stderr', ['Следующий шаг']);
  const headline = value.split('\n')[0] || '';
  const status: ShellExecutionStatus = /^Ошибка:/i.test(headline)
    ? 'error'
    : /^Команда выполнена с замечанием:/i.test(headline)
      ? 'degraded'
      : 'success';
  const summary = status === 'error'
    ? compactLine(headline.replace(/^Ошибка:\s*/i, ''), 96) || 'Команда завершилась с ошибкой'
    : status === 'degraded'
      ? compactLine(headline.replace(/^Команда выполнена с замечанием:\s*/i, ''), 96) || 'Команда завершилась с замечанием'
      : compactLine(headline.replace(/^Команда выполнена:\s*/i, ''), 96) || 'Команда завершена';
  const detailParts = [
    artifactMatch?.[1] ? `Артефакт: ${compactLine(artifactMatch[1], 120)}` : '',
    sizeMatch?.[1] ? `Размер: ${compactLine(sizeMatch[1], 40)}` : '',
    kindMatch?.[1],
    riskMatch?.[1],
    statusMatch?.[1],
  ].filter(Boolean);

  return {
    status,
    summary,
    detail: [insightMatch?.[1], ...detailParts].filter(Boolean).join(' • '),
    nextStep: compactLine(nextStepMatch?.[1] || '', 180) || undefined,
    insight: compactLine(insightMatch?.[1] || '', 140) || undefined,
    stdout,
    stderr,
    outputPreview: buildShellOutputPreview(stdout, stderr) || undefined,
  };
}

function compactLine(text: string, maxLength = 120): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 1)).trimEnd() + '…';
}

function escapeRegex(text: string): string {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractLabeledSection(content: string, label: string, nextLabels: string[]): string {
  const nextPattern = nextLabels.length > 0
    ? `(?=\\n(?:${nextLabels.map((item) => escapeRegex(item)).join('|')}):|$)`
    : '$';
  const match = String(content || '').match(
    new RegExp(`(?:^|\\n)${escapeRegex(label)}:\\n([\\s\\S]*?)${nextPattern}`, 'm'),
  );
  return String(match?.[1] || '').trim();
}

function buildShellOutputPreview(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout) {
    parts.push(`stdout\n${stdout}`);
  }
  if (stderr) {
    parts.push(`stderr\n${stderr}`);
  }
  return parts.join('\n\n').trim();
}
