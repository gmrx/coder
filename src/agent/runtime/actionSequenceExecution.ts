import type { AgentAction } from '../prompt';
import { resolveToolAlias } from '../tooling/aliases';
import {
  getToolDefinition,
  isToolConcurrencySafe,
  isToolReadOnly,
  requiresToolApproval,
  shouldDeferTool,
  toolRequiresUserInteraction,
} from '../tooling/catalog';
import type { AgentSession } from './agentSession';
import type { TurnLoopState } from './turnState';
import { executeAgentToolStep } from './toolExecutionStep';

type ActionSequenceGroup =
  | {
    kind: 'parallel';
    actions: AgentAction[];
  }
  | {
    kind: 'serial';
    action: AgentAction;
  };

const SEQUENCE_CONTROL_TOOLS = new Set([
  'final_answer',
  'enter_plan_mode',
  'exit_plan_mode',
]);

export function validateActionSequence(actions: AgentAction[]): string | null {
  if (!actions.length) {
    return 'Массив действий пуст. Верни хотя бы один корректный tool call.';
  }

  for (const action of actions) {
    if (!action?.tool) {
      return 'В массиве действий найден элемент без поля "tool".';
    }
    if (SEQUENCE_CONTROL_TOOLS.has(action.tool)) {
      return `Инструмент "${action.tool}" нельзя смешивать с другими действиями в одном JSON-массиве. Верни его отдельным JSON-блоком.`;
    }
  }

  return null;
}

export async function executeAgentActionSequence(
  session: AgentSession,
  state: TurnLoopState,
  response: string,
  actions: AgentAction[],
): Promise<void> {
  const groups = partitionActionSequence(actions);
  let finished = false;
  emitActionSequenceStarted(session, state, groups);
  session.pushAssistant(response);

  for (let index = 0; index < groups.length; index++) {
    if (session.signal?.aborted) {
      emitActionSequenceStopped(session, state, groups, index);
      finished = true;
      break;
    }

    const group = groups[index];
    const stepKey = groups.length === 1
      ? state.iteration
      : `${state.iteration}.${index + 1}`;
    emitActionSequenceProgress(session, state, groups, index, stepKey);

    const execution = group.kind === 'parallel' && group.actions.length > 1
      ? await executeParallelActionGroup(session, state, stepKey, group.actions)
      : await executeSerialActionGroup(
        session,
        state,
        stepKey,
        group.kind === 'parallel' ? group.actions[0] : group.action,
      );

    if (session.signal?.aborted) {
      emitActionSequenceStopped(session, state, groups, index + 1);
      finished = true;
      break;
    }

    if (execution.status === 'error' || execution.status === 'blocked') {
      emitActionSequenceInterrupted(session, state, groups, index + 1, stepKey, execution.status);
      finished = true;
      break;
    }
  }

  if (!finished && !session.signal?.aborted) {
    emitActionSequenceCompleted(session, state, groups);
  }
}

function emitActionSequenceStarted(
  session: AgentSession,
  state: TurnLoopState,
  groups: ActionSequenceGroup[],
): void {
  const totalActions = groups.reduce(
    (sum, group) => sum + (group.kind === 'parallel' ? group.actions.length : 1),
    0,
  );
  const detail = buildActionSequenceDetail(state, groups);

  session.trace.emit('agent-action-sequence', 'Выполняю волну действий из одного ответа модели.', {
    step: state.iteration,
    totalActions,
    groupCount: groups.length,
    completedGroups: 0,
    status: 'running',
    summary: totalActions > 1
      ? `Выполняю волну из ${totalActions} шагов`
      : 'Выполняю шаг из одного ответа модели',
    detail,
  });
}

function emitActionSequenceProgress(
  session: AgentSession,
  state: TurnLoopState,
  groups: ActionSequenceGroup[],
  groupIndex: number,
  currentStepKey: number | string,
): void {
  const totalActions = groups.reduce(
    (sum, group) => sum + (group.kind === 'parallel' ? group.actions.length : 1),
    0,
  );
  const currentGroup = groupIndex + 1;
  session.trace.emit('agent-action-sequence', 'Продолжаю волну действий.', {
    step: state.iteration,
    totalActions,
    groupCount: groups.length,
    completedGroups: groupIndex,
    currentGroup,
    currentStepKey: String(currentStepKey),
    status: 'running',
    summary: groups.length > 1
      ? `Выполняю волну ${currentGroup}/${groups.length}`
      : 'Выполняю шаг из одного ответа модели',
    detail: buildActionSequenceDetail(state, groups),
  });
}

function emitActionSequenceStopped(
  session: AgentSession,
  state: TurnLoopState,
  groups: ActionSequenceGroup[],
  completedGroups: number,
): void {
  const totalActions = groups.reduce(
    (sum, group) => sum + (group.kind === 'parallel' ? group.actions.length : 1),
    0,
  );
  session.trace.emit('agent-action-sequence', 'Волна действий остановлена.', {
    step: state.iteration,
    totalActions,
    groupCount: groups.length,
    completedGroups,
    status: 'stopped',
    summary: 'Останавливаю волну шагов',
    detail: `${completedGroups}/${groups.length} волн завершено до остановки.`,
  });
}

function emitActionSequenceInterrupted(
  session: AgentSession,
  state: TurnLoopState,
  groups: ActionSequenceGroup[],
  completedGroups: number,
  currentStepKey: number | string,
  status: 'error' | 'blocked',
): void {
  const totalActions = groups.reduce(
    (sum, group) => sum + (group.kind === 'parallel' ? group.actions.length : 1),
    0,
  );
  session.trace.emit('agent-action-sequence', 'Волна действий прервана.', {
    step: state.iteration,
    totalActions,
    groupCount: groups.length,
    completedGroups,
    currentStepKey: String(currentStepKey),
    status,
    summary: status === 'blocked' ? 'Волна шагов упёрлась в блокер' : 'Волна шагов завершилась ошибкой',
    detail: `Остановился на подшаге ${currentStepKey}.`,
  });
}

function emitActionSequenceCompleted(
  session: AgentSession,
  state: TurnLoopState,
  groups: ActionSequenceGroup[],
): void {
  if (!groups.length) return;
  const totalActions = groups.reduce(
    (sum, group) => sum + (group.kind === 'parallel' ? group.actions.length : 1),
    0,
  );
  session.trace.emit('agent-action-sequence', 'Волна действий завершена.', {
    step: state.iteration,
    totalActions,
    groupCount: groups.length,
    completedGroups: groups.length,
    status: 'done',
    summary: groups.length > 1 ? 'Волна шагов завершена' : 'Шаг ответа модели завершён',
    detail: `${groups.length}/${groups.length} волн завершено.`,
  });
}

function buildActionSequenceDetail(
  state: TurnLoopState,
  groups: ActionSequenceGroup[],
): string {
  return groups.map((group, index) => {
    const stepKey = groups.length === 1 ? String(state.iteration) : `${state.iteration}.${index + 1}`;
    if (group.kind === 'parallel') {
      const toolNames = group.actions.map((action) => getActionDisplayName(action));
      return `${stepKey}: параллельно ${toolNames.join(' • ')}`;
    }
    return `${stepKey}: ${getActionDisplayName(group.action)}`;
  }).join('  |  ');
}

function partitionActionSequence(actions: AgentAction[]): ActionSequenceGroup[] {
  const groups: ActionSequenceGroup[] = [];

  for (const action of actions) {
    if (canAutoParallelizeAction(action)) {
      const last = groups[groups.length - 1];
      if (last?.kind === 'parallel') {
        last.actions.push(action);
        continue;
      }
      groups.push({
        kind: 'parallel',
        actions: [action],
      });
      continue;
    }

    groups.push({
      kind: 'serial',
      action,
    });
  }

  return groups;
}

function canAutoParallelizeAction(action: AgentAction): boolean {
  const resolved = resolveToolAlias(action.tool, action.args || {});
  const toolName = resolved.toolName;
  const definition = getToolDefinition(toolName);

  if (!definition || toolName === 'tool_batch') return false;
  if (SEQUENCE_CONTROL_TOOLS.has(toolName)) return false;
  if (!isToolReadOnly(toolName)) return false;
  if (!isToolConcurrencySafe(toolName)) return false;
  if (toolRequiresUserInteraction(toolName) || requiresToolApproval(toolName)) return false;
  if (shouldDeferTool(toolName)) return false;
  if (definition.virtual) return false;

  return true;
}

async function executeParallelActionGroup(
  session: AgentSession,
  state: TurnLoopState,
  stepKey: number | string,
  actions: AgentAction[],
) {
  return executeAgentToolStep(
    session,
    state,
    '',
    {
      tool: 'tool_batch',
      args: {
        tools: actions.map((action) => ({
          tool: action.tool,
          args: action.args || {},
        })),
      },
      reasoning: buildParallelBatchReasoning(actions),
    },
    {
      pushAssistant: false,
      stepKey,
    },
  );
}

async function executeSerialActionGroup(
  session: AgentSession,
  state: TurnLoopState,
  stepKey: number | string,
  action: AgentAction,
) {
  return executeAgentToolStep(
    session,
    state,
    '',
    action,
    {
      pushAssistant: false,
      stepKey,
    },
  );
}

function buildParallelBatchReasoning(actions: AgentAction[]): string {
  const names = actions.map((action) => resolveToolAlias(action.tool, action.args || {}).toolName);
  const uniqueNames = Array.from(new Set(names));
  if (uniqueNames.length === 1) {
    return `Параллельно выполняю ${actions.length} независимых read-only вызова ${uniqueNames[0]} из одного ответа модели.`;
  }
  return `Параллельно выполняю ${actions.length} независимых read-only шага из одного ответа модели: ${uniqueNames.join(', ')}.`;
}

function getActionDisplayName(action: AgentAction): string {
  const resolved = resolveToolAlias(action.tool, action.args || {});
  const definition = getToolDefinition(resolved.toolName);
  return definition?.capabilities?.userFacingName || resolved.toolName;
}
