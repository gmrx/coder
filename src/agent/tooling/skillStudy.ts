import { truncate } from '../../core/utils';
import type { DiscoveredSkill, SkillSearchMatch } from '../skills/discovery';
import type { StructuredPresentationSection } from './presentationItems';
import type { ToolSearchPresentation, ToolSearchRecommendation } from './definitions/toolSearch';

export interface SkillToolPresentation {
  summary: string;
  detail: string;
  preview?: string;
  nextStep?: string;
  skillName: string;
  source: string;
  skillPath: string;
  taskContext?: string;
  sections?: StructuredPresentationSection[];
}

function clean(text: unknown): string {
  return String(text || '').trim();
}

function compact(text: string, max = 220): string {
  const value = clean(text).replace(/\s+/g, ' ');
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function normalizeTaskContext(args: any): string {
  return clean(args?.task || args?.args || args?.query || args?.goal || args?.instruction || '');
}

export function buildSkillInvokeTemplate(skillName: string, taskContext?: string): string {
  return JSON.stringify({
    tool: 'skill',
    args: {
      name: skillName,
      ...(taskContext ? { task: taskContext } : { task: '<что нужно сделать этим навыком>' }),
    },
  });
}

export function isExplicitSkillQuery(query: string): boolean {
  const value = String(query || '').trim();
  return /^[$/]/.test(value) || /(skill|skills|навык|навыки|скилл|скиллы|slash command|slash-команд)/i.test(value);
}

function buildSkillPreview(markdown: string): string {
  const lines = String(markdown || '').trim().split('\n');
  return truncate(lines.slice(0, 24).join('\n').trim(), 2_400);
}

export function buildSkillLoadedPresentation(skill: DiscoveredSkill, markdown: string, args: any): SkillToolPresentation {
  const taskContext = normalizeTaskContext(args);
  return {
    summary: `Навык "${skill.name}" загружен`,
    detail: [skill.sourceLabel, skill.skillFilePath].filter(Boolean).join(' • '),
    preview: buildSkillPreview(markdown),
    nextStep: taskContext
      ? 'Продолжай выполнение по инструкциям навыка с учётом переданного контекста.'
      : 'Продолжай выполнение по инструкциям навыка. Не пересказывай их, а применяй в следующих шагах.',
    skillName: skill.name,
    source: skill.sourceLabel,
    skillPath: skill.skillFilePath,
    ...(taskContext ? { taskContext } : {}),
    sections: [{
      title: 'Навык',
      items: [{
        title: skill.name,
        subtitle: skill.description || skill.title,
        meta: `${skill.sourceLabel} • ${skill.skillFilePath}`,
      }],
    }],
  };
}

export function formatSkillLoadedResult(skill: DiscoveredSkill, markdown: string, args: any): string {
  const taskContext = normalizeTaskContext(args);
  const lines = [
    `Навык "${skill.name}" загружен.`,
    `Источник: ${skill.sourceLabel}`,
    `Файл: ${skill.skillFilePath}`,
    skill.description ? `Описание: ${skill.description}` : '',
    taskContext ? `Контекст запуска: ${taskContext}` : '',
    '',
    'Следуй этим инструкциям как reusable workflow для текущей задачи:',
    '',
    `<skill name="${skill.name}" source="${skill.sourceLabel}" path="${skill.skillFilePath}">`,
    truncate(String(markdown || '').trim(), 36_000),
    '</skill>',
    '',
    taskContext
      ? 'Теперь продолжай выполнение, применяя навык к указанному контексту.'
      : 'Теперь продолжай выполнение по инструкциям навыка и используй обычные утилиты по мере необходимости.',
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildSkillNotFoundPresentation(rawName: string, suggestions: DiscoveredSkill[]): SkillToolPresentation {
  return {
    summary: 'Навык не найден',
    detail: rawName ? `name: ${rawName}` : 'Имя навыка не указано',
    preview: suggestions.length > 0
      ? suggestions.slice(0, 6).map((skill) => `- ${skill.name} — ${skill.description || skill.title}`).join('\n')
      : 'Подходящих навыков не найдено.',
    nextStep: suggestions[0] ? `Попробуй: ${buildSkillInvokeTemplate(suggestions[0].name)}` : '',
    skillName: rawName || '',
    source: '',
    skillPath: '',
    sections: suggestions.length > 0 ? [{
      title: 'Похожие навыки',
      items: suggestions.slice(0, 6).map((skill) => ({
        title: skill.name,
        subtitle: skill.description || skill.title,
        meta: `${skill.sourceLabel} • ${skill.skillFilePath}`,
      })),
    }] : [],
  };
}

export function formatSkillNotFoundResult(rawName: string, suggestions: DiscoveredSkill[]): string {
  const lines = [
    rawName ? `Навык "${rawName}" не найден.` : 'Имя навыка не указано.',
  ];

  if (suggestions.length > 0) {
    lines.push('', 'Похожие навыки:');
    suggestions.slice(0, 6).forEach((skill, index) => {
      lines.push(`${index + 1}. ${skill.name} — ${skill.description || skill.title}`);
      lines.push(`   Источник: ${skill.sourceLabel}`);
      lines.push(`   Шаблон вызова: ${buildSkillInvokeTemplate(skill.name)}`);
    });
  } else {
    lines.push('', 'Проверь имя навыка или добавь пользовательский SKILL.md в глобальный каталог навыков, вне workspace проекта.');
  }

  return lines.join('\n');
}

export function buildSkillToolSearchResult(
  query: string,
  matches: SkillSearchMatch[],
  fallbackToolName?: string,
): {
  content: string;
  presentation: ToolSearchPresentation;
  recommendation: ToolSearchRecommendation;
} {
  const top = matches[0];
  const nextStep = buildSkillInvokeTemplate(top.skill.name);
  const lines = [
    `tool_search "${query}"`,
    '',
    'Подобрал навык для этого запроса:',
    '',
    'Рекомендуемый инструмент: skill',
    `Почему начать с него: найден навык "${top.skill.name}" (${top.reasons.join('; ') || 'лучший матч по имени и описанию'})`,
    `Следующий шаг: ${nextStep}`,
    'Короткий маршрут:',
    `- сначала загрузи навык через ${nextStep}`,
    '- затем следуй его инструкциям и продолжай обычными утилитами',
    '',
    'Найденные навыки:',
    '',
  ];

  matches.slice(0, 6).forEach((match, index) => {
    lines.push(`${index + 1}. ${match.skill.name} — ${match.skill.description || match.skill.title}`);
    if (match.reasons.length > 0) {
      lines.push(`   Почему подходит: ${match.reasons.join('; ')}`);
    }
    lines.push(`   Источник: ${match.skill.sourceLabel}`);
    lines.push(`   Шаблон вызова: ${buildSkillInvokeTemplate(match.skill.name)}`);
    lines.push('');
  });

  if (fallbackToolName) {
    lines.push(`Если нужен не навык, а обычный инструмент, ближайшая альтернатива: ${fallbackToolName}.`);
  }

  return {
    content: lines.join('\n').trim(),
    presentation: {
      query,
      matchCount: matches.length,
      summary: 'Подобрал навык',
      detail: `${matches.length} навыков`,
      preview: matches
        .slice(0, 4)
        .map((match) => `- ${match.skill.name} — ${compact(match.skill.description || match.skill.title, 120)}`)
        .join('\n'),
      nextStep,
      recommendation: {
        toolName: 'skill',
        nextStep,
      },
      sections: [{
        title: 'Навыки',
        items: matches.slice(0, 6).map((match) => ({
          title: match.skill.name,
          subtitle: match.skill.description || match.skill.title,
          meta: `${match.skill.sourceLabel}${match.reasons.length > 0 ? ` • ${match.reasons.slice(0, 2).join(' • ')}` : ''}`,
        })),
      }],
      matches: matches.slice(0, 6).map((match) => ({
        toolName: 'skill',
        summary: `Навык: ${match.skill.name} — ${match.skill.description || match.skill.title}`,
        reasons: match.reasons.slice(0, 2),
      })),
      tools: ['skill'],
    },
    recommendation: {
      toolName: 'skill',
      nextStep,
    },
  };
}
