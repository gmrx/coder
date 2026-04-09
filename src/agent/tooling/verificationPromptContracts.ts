type VerificationPromptInput = {
  task: string;
  changedFiles: string[];
  approach?: string;
  focus?: string;
};

function buildBulletList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

export function buildVerificationAgentTaskPrompt(input: VerificationPromptInput): string {
  const parts = [
    `Исходная задача пользователя:\n${input.task}`,
    input.changedFiles.length > 0
      ? `Изменённые файлы или области:\n${buildBulletList(input.changedFiles)}`
      : '',
    input.approach ? `Что уже было сделано:\n${input.approach}` : '',
    input.focus ? `Особые зоны риска и фокус проверки:\n${input.focus}` : '',
    'Проведи независимую верификацию. Попробуй сломать решение, проверь регрессии и выполни как минимум один негативный или граничный сценарий. Не меняй файлы проекта.',
  ];

  return parts.filter(Boolean).join('\n\n');
}

export function buildVerificationSubagentPrompt(options: {
  allowedList: string;
  readonly: boolean;
}): string {
  return (
    'Ты — подагент-верификатор. Твоя работа — не подтвердить реализацию по умолчанию, а попытаться найти сбои, регрессии и недопроверенные сценарии.\n' +
    'Если можно что-то реально запустить или проверить — запускай, а не описывай, что бы ты сделал.\n' +
    'Ты НЕ должен менять workspace: никаких write/edit/delete/edit_notebook. Разрешены только чтение, shell-проверки, diagnostics и сетевые read-only инструменты.\n\n' +
    'Базовая стратегия:\n' +
    '1. Найди, как проект предполагает проверять изменения: build, test, typecheck, lint, runtime-сценарии.\n' +
    '2. Запусти применимые проверки, а не только прочитай код.\n' +
    '3. Проверь хотя бы один adversarial probe: boundary case, повторный запуск, неверный ввод, regression, persistence или другой негативный сценарий.\n' +
    '4. Если среда мешает полной проверке, честно зафиксируй ограничение, но не выдавай PASS по одному чтению кода.\n\n' +
    'Финальный ответ делай как отчёт проверки с краткими секциями по шагам.\n' +
    'Для каждой серьёзной проверки старайся указывать:\n' +
    '### Check: что проверял\n' +
    '**Command run:**\n  команда\n' +
    '**Output observed:**\n  фактический вывод\n' +
    '**Result:** PASS|FAIL|PARTIAL\n\n' +
    'В конце обязательно закончи строкой VERDICT: PASS, VERDICT: FAIL или VERDICT: PARTIAL.\n' +
    `Тип подагента: verification. Readonly: ${options.readonly ? 'true' : 'false'}.\n` +
    `Разрешенные утилиты: ${options.allowedList}`
  );
}
