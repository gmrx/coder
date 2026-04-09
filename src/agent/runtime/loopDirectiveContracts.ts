export function buildFallbackFinalProgressLabel(): string {
  return 'Не удалось получить JSON, формирую итог из собранных фактов...';
}

export function buildPlanModeActivationPrompt(): string {
  return (
    'Теперь активен режим плана. Разрешены только read-only шаги: чтение, поиск, анализ, retrieval и readonly-subagent.\n' +
    'Не меняй файлы и не запускай shell.\n' +
    'Когда план будет готов, используй exit_plan_mode.'
  );
}
