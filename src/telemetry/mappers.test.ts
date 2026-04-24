import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatRunTelemetryEvents,
  buildExtensionMessageTelemetryEvents,
  buildUserMessageTelemetryEvent,
} from './mappers';
import type { TelemetryConversationContext } from './types';

function createJiraContext(): TelemetryConversationContext {
  return {
    conversationId: 'conv-1',
    userApiKey: 'model-api-key',
    source: {
      type: 'jira',
      projectKey: 'PRJ',
      projectName: 'Project',
      issueKey: 'PRJ-123',
      issueTitle: 'Issue title',
      issueUrl: 'https://jira.local/browse/PRJ-123',
      issueStatus: 'Open',
      issueDescription: 'Issue description',
    },
  };
}

test('buildUserMessageTelemetryEvent keeps only base dimensions', () => {
  const event = buildUserMessageTelemetryEvent(createJiraContext(), 1_700_000_000_000);
  assert.equal(event.event_family, 'message');
  assert.equal(event.event_name, 'user_request');
  assert.equal(event.source_type, 'jira');
  assert.equal(event.source_project_key, 'PRJ');
  assert.equal(event.source_task_key, 'PRJ-123');
  assert.equal(event.user_api_key, 'model-api-key');
  assert.equal(event.event_time, '2023-11-14 22:13:20.000');
});

test('assistant message telemetry keeps the current run id', () => {
  const [event] = buildExtensionMessageTelemetryEvents(createJiraContext(), {
    type: 'assistant',
    text: 'Done',
  }, 'run-42', 1_700_000_000_000);

  assert.equal(event.event_family, 'message');
  assert.equal(event.event_name, 'assistant_response');
  assert.equal(event.run_id, 'run-42');
  assert.equal(event.status, 'sent');
});

test('file change telemetry strips file path and diff text payloads', () => {
  const [event] = buildExtensionMessageTelemetryEvents(createJiraContext(), {
    type: 'fileChange',
    changeId: 'chg-1',
    step: '3',
    filePath: 'src/secret/path/index.ts',
    changeType: 'edit',
    tool: 'write_file',
    summary: 'edited',
    stats: {
      added: 12,
      removed: 4,
      beforeLines: 30,
      afterLines: 38,
    },
    oldSnippet: 'TOP-SECRET-OLD',
    newSnippet: 'TOP-SECRET-NEW',
    cellIdx: undefined,
    diffLines: [],
  }, 'run-1', 1_700_000_000_001);

  assert.equal(event.run_id, 'run-1');
  assert.equal(event.event_family, 'file');
  assert.equal(event.event_name, 'change');
  assert.equal(event.tool_name, 'write_file');
  assert.equal(event.file_ext, '.ts');
  assert.equal(event.added_lines, 12);
  assert.equal(event.removed_lines, 4);
  assert.doesNotMatch(event.attrs_json, /secret\/path\/index\.ts/i);
  assert.doesNotMatch(event.attrs_json, /TOP-SECRET/i);
  assert.match(event.attrs_json, /"change_id":"chg-1"/);
});

test('trace telemetry maps model usage and tool errors into normalized rows', () => {
  const modelEvents = buildChatRunTelemetryEvents(createJiraContext(), {
    kind: 'trace',
    trace: {
      runId: 'run-2',
      phase: 'agent-model-usage',
      text: 'usage updated',
      data: {
        model: 'Qwen-Test',
        promptTokens: 100,
        completionTokens: 23,
      },
    },
  }, 1_700_000_000_002);

  assert.equal(modelEvents.length, 1);
  assert.equal(modelEvents[0].event_family, 'model');
  assert.equal(modelEvents[0].event_name, 'usage');
  assert.equal(modelEvents[0].model, 'Qwen-Test');
  assert.equal(modelEvents[0].prompt_tokens, 100);
  assert.equal(modelEvents[0].completion_tokens, 23);
  assert.equal(modelEvents[0].total_tokens, 123);

  const toolEvents = buildChatRunTelemetryEvents(createJiraContext(), {
    kind: 'trace',
    trace: {
      runId: 'run-2',
      phase: 'tool-batch-child-result',
      text: 'shell failed',
      data: {
        tool: 'shell',
        status: 'error',
        error: true,
        parentTool: 'tool_batch',
        index: 1,
        total: 2,
      },
    },
  }, 1_700_000_000_003);

  assert.equal(toolEvents.length, 2);
  assert.equal(toolEvents[0].event_family, 'tool');
  assert.equal(toolEvents[0].event_name, 'finished');
  assert.equal(toolEvents[0].status, 'error');
  assert.equal(toolEvents[1].event_name, 'error');
  assert.equal(toolEvents[1].error_count, 1);
});

test('auto approval telemetry keeps flags but omits sensitive command text', () => {
  const events = buildChatRunTelemetryEvents(createJiraContext(), {
    kind: 'auto-approval',
    runId: 'run-3',
    request: {
      kind: 'shell',
      confirmId: 'approval-1',
      title: 'Run shell',
      command: 'rm -rf /very/secret/path',
      cwd: '/repo',
      destructive: true,
    },
    result: {
      kind: 'shell',
      confirmId: 'approval-1',
      approved: true,
      reason: 'auto_approved',
      command: 'rm -rf /very/secret/path',
    },
  }, 1_700_000_000_004);

  assert.equal(events.length, 2);
  assert.equal(events[0].event_family, 'approval');
  assert.equal(events[0].event_name, 'request');
  assert.equal(events[0].destructive, 1);
  assert.equal(events[0].auto_approved, 1);
  assert.equal(events[1].event_name, 'resolved');
  assert.equal(events[1].approved, 1);
  assert.equal(events[1].auto_approved, 1);
  assert.doesNotMatch(events[0].attrs_json, /rm -rf|very\/secret/i);
  assert.doesNotMatch(events[1].attrs_json, /rm -rf|very\/secret/i);
});
