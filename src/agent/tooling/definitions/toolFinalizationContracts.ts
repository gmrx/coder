import { truncate } from '../../../core/utils';

export function buildJsonFailureFinalPromptContract(
  lastQuestion: string,
  needMermaid: boolean,
): string {
  return (
    `JSON-вызов не получился, но фактов уже достаточно. Сформируй полный итоговый ответ СТРОГО на последний запрос пользователя:\n«${truncate(lastQuestion, 500)}»\n\n` +
    'Отвечай ТОЛЬКО на этот запрос. Не смешивай с предыдущими сообщениями.\n' +
    (needMermaid
      ? 'Обязательно добавь хотя бы одну Mermaid-диаграмму в блоке ```mermaid``` (без ASCII-псевдографики).\n'
      : 'Если есть архитектурные связи/потоки, добавь Mermaid-диаграммы в блоках ```mermaid```.\n') +
    'НЕ выводи JSON, только структурированный markdown по-русски.'
  );
}

export function buildFinalAnswerPromptContract(
  lastQuestion: string,
  needMermaid: boolean,
): string {
  return (
    `Напиши подробный итоговый ответ СТРОГО на последний запрос пользователя:\n«${truncate(lastQuestion, 500)}»\n\n` +
    'Отвечай ТОЛЬКО на этот запрос. Если он не связан с предыдущими сообщениями — игнорируй предыдущий контекст.\n' +
    'Формат: структурированный markdown с заголовками, таблицами, списками.\n' +
    (needMermaid
      ? 'Обязательно добавь хотя бы одну Mermaid-диаграмму в блоке ```mermaid``` (без ASCII-псевдографики).\n'
      : 'Если описываешь архитектуру/взаимодействия/потоки — добавь Mermaid-диаграммы в блоках ```mermaid```.\n') +
    'НЕ выводи JSON. По-русски.'
  );
}

export function buildLoopExitFinalPromptContract(lastQuestion: string): string {
  return (
    `Анализ завершён. Напиши итоговый ответ СТРОГО на последний запрос пользователя:\n«${truncate(lastQuestion, 500)}»\n\n` +
    'Отвечай ТОЛЬКО на этот запрос. Не включай информацию из предыдущих сообщений, если она не относится к нему.\n' +
    'НЕ JSON. Markdown. По-русски.'
  );
}

export function buildPlanModeFinalPromptContract(lastQuestion: string): string {
  return (
    `Ты завершил режим плана. Подготовь итоговый план СТРОГО под последний запрос пользователя:\n«${truncate(lastQuestion, 500)}»\n\n` +
    'Формат ответа:\n' +
    '## Цель\n' +
    '## Что нужно изучить или изменить\n' +
    '## План реализации\n' +
    '## Риски и проверки\n\n' +
    'Не вноси новых правок. Это именно план, а не реализация.\n' +
    'НЕ JSON. Markdown. По-русски.'
  );
}

export function buildPlanModeFinalAnswerNudgeContract(): string {
  return (
    'Сейчас активен режим плана. Не заверши ход через final_answer напрямую.\n' +
    'Когда план готов, используй exit_plan_mode — после этого будет запрошен итоговый план для пользователя.'
  );
}

export function buildPlanModeRejectedPromptContract(
  feedback?: string,
  revisedPlan?: string,
): string {
  const notes: string[] = [
    'Пользователь не утвердил текущий план. Оставайся в режиме плана и доработай его.',
  ];

  if (feedback && feedback.trim()) {
    notes.push(`Комментарий пользователя:\n${feedback.trim()}`);
  }

  if (revisedPlan && revisedPlan.trim()) {
    notes.push(`Пользователь оставил черновик правок для ориентира:\n${revisedPlan.trim()}`);
  }

  notes.push(
    'Скорректируй план, при необходимости дочитай недостающий контекст и затем снова используй exit_plan_mode.',
  );

  return notes.join('\n\n');
}

export function buildPlanModeApprovedImplementationPromptContract(plan: string): string {
  return (
    'Пользователь утвердил план. Выйди из режима плана и переходи к реализации.\n\n' +
    'Согласованный план:\n' +
    `${plan.trim()}\n\n` +
    'Теперь выполни нужные изменения в workspace, а не повторяй сам план.'
  );
}
