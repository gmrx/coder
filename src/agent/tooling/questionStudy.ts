import type { AgentQuestionPrompt } from '../runtime/questions';
import type { StructuredPresentationSection } from './presentationItems';

export interface AskUserResultPresentation {
  summary: string;
  detail: string;
  preview: string;
  nextStep: string;
  questionCount: number;
  answerCount: number;
  answers: Record<string, string>;
  sections?: StructuredPresentationSection[];
}

function hasText(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function normalizeText(value: unknown, fallback = ''): string {
  return hasText(value) ? String(value).trim() : fallback;
}

export function normalizeAskUserQuestions(rawQuestions: any): AgentQuestionPrompt[] {
  const questions = Array.isArray(rawQuestions) ? rawQuestions : [];
  return questions
    .map((question, questionIndex) => {
      const options = Array.isArray(question?.options) ? question.options : [];
      const rawQuestion = normalizeText(question?.question, `Вопрос ${questionIndex + 1}?`);
      const trimmedQuestion = rawQuestion.replace(/[\s:;,.!]+$/u, '').trim();
      const normalizedQuestion = trimmedQuestion.endsWith('?')
        ? trimmedQuestion
        : `${trimmedQuestion || `Вопрос ${questionIndex + 1}`}?`;
      return {
        question: normalizedQuestion,
        header: normalizeText(question?.header, `Вопрос ${questionIndex + 1}`),
        multiSelect: !!question?.multiSelect,
        options: options
          .map((option: any, optionIndex: number) => ({
            label: normalizeText(option?.label, `Вариант ${optionIndex + 1}`),
            description: normalizeText(option?.description),
          }))
          .filter((option: { label: string }) => option.label),
      };
    })
    .filter((question: AgentQuestionPrompt) => question.question && question.header);
}

export function validateAskUserQuestions(rawQuestions: any): string | null {
  const questions = normalizeAskUserQuestions(rawQuestions);
  if (questions.length === 0) {
    return 'Для "ask_user" обязателен args.questions с хотя бы одним вопросом';
  }
  if (questions.length > 4) {
    return 'Для "ask_user" можно задать не больше 4 вопросов за один вызов';
  }

  const questionTexts = new Set<string>();
  for (const question of questions) {
    if (question.header.length > 20) {
      return `Для "ask_user" header должен быть коротким: "${question.header}"`;
    }
    if (questionTexts.has(question.question)) {
      return `В "ask_user" тексты вопросов должны быть уникальными: "${question.question}"`;
    }
    questionTexts.add(question.question);

    if (question.options.length < 2 || question.options.length > 4) {
      return `Для вопроса "${question.question}" укажи от 2 до 4 вариантов`;
    }

    const labels = new Set<string>();
    for (const option of question.options) {
      if (labels.has(option.label)) {
        return `Для вопроса "${question.question}" labels вариантов должны быть уникальными`;
      }
      labels.add(option.label);
      if (!option.description) {
        return `Для вопроса "${question.question}" у каждого варианта нужен description`;
      }
    }
  }

  return null;
}

export function buildAskUserResultContent(
  answers: Record<string, string>,
  reason?: string,
  questions: AgentQuestionPrompt[] = [],
): string {
  const entries = Object.entries(answers || {});
  if (entries.length === 0) {
    return reason || 'Пользователь не ответил на вопросы.';
  }

  const lines = [
    'Пользователь ответил на вопросы:',
    ...entries.map(([question, answer]) => `- ${question} → ${answer}`),
  ];

  entries.forEach(([questionText, answer]) => {
    const prompt = questions.find((question) => question.question === questionText);
    if (!prompt) return;
    const normalizedAnswer = String(answer || '').trim().toLowerCase();
    const matchesOption = prompt.options.some((option) => option.label.trim().toLowerCase() === normalizedAnswer);
    const hasCustomMarker = normalizedAnswer.startsWith('свой вариант:');
    if (!hasCustomMarker && matchesOption) return;

    lines.push(
      '',
      `Пользователь ввёл свой вариант для "${questionText}".`,
      'Показанные варианты:',
      ...prompt.options.map((option) => `- ${option.label} — ${option.description}`),
      'Не подставляй случайные идентификаторы. Если нужен точный ID или slug, либо сопоставь ответ с вариантами выше, либо задай уточняющий вопрос.',
    );
  });

  lines.push('', 'Продолжай выполнение с учётом этих ответов.');
  return lines.join('\n');
}

export function buildAskUserSuccessPresentation(
  questions: AgentQuestionPrompt[],
  answers: Record<string, string>,
): AskUserResultPresentation {
  const entries = Object.entries(answers || {});
  return {
    summary: 'Получил ответ пользователя',
    detail: `вопросов: ${questions.length} • ответов: ${entries.length}`,
    preview: entries.map(([question, answer]) => `${question}\n→ ${answer}`).join('\n\n'),
    nextStep: 'Продолжай выполнение с учётом ответов пользователя.',
    questionCount: questions.length,
    answerCount: entries.length,
    answers: { ...answers },
    sections: entries.length > 0 ? [{
      title: 'Ответы',
      items: entries.map(([question, answer]) => ({
        title: question,
        subtitle: answer,
      })),
    }] : [],
  };
}

export function buildAskUserBlockedPresentation(
  questions: AgentQuestionPrompt[],
  reason: string,
): AskUserResultPresentation {
  return {
    summary: 'Ответ пользователя не получен',
    detail: reason,
    preview: reason,
    nextStep: '',
    questionCount: questions.length,
    answerCount: 0,
    answers: {},
    sections: [],
  };
}
