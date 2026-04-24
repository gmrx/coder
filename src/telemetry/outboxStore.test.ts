import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MetricsOutboxStore } from './outboxStore';
import type { TelemetryEvent } from './types';

function buildEvent(id: string): TelemetryEvent {
  return {
    event_time: new Date(1_700_000_000_000).toISOString(),
    install_id: 'install-1',
    user_api_key: 'api-key',
    conversation_id: `conv-${id}`,
    run_id: `run-${id}`,
    source_type: 'free',
    source_project_key: '',
    source_task_key: '',
    event_family: 'message',
    event_name: 'user_request',
    status: '',
    model: '',
    tool_name: '',
    approval_kind: '',
    file_ext: '',
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    added_lines: 0,
    removed_lines: 0,
    pending_files: 0,
    pending_changes: 0,
    agent_lines: 0,
    agent_modified_by_user_lines: 0,
    agent_removed_lines: 0,
    agent_deleted_by_user_lines: 0,
    user_only_lines: 0,
    user_removed_lines: 0,
    unknown_files: 0,
    rewound_requests: 0,
    restored_files: 0,
    error_count: 0,
    approved: 0,
    cancelled: 0,
    auto_approved: 0,
    destructive: 0,
    attrs_json: '{}',
  };
}

test('outbox writes, lists, reads and prunes oldest batches', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cursorcoder-outbox-'));
  const store = new MetricsOutboxStore(tempRoot, { maxFiles: 2, maxBytes: 10_000 });

  await store.writeBatch([buildEvent('1')]);
  await store.writeBatch([buildEvent('2')]);
  await store.writeBatch([buildEvent('3')]);

  const batches = await store.listBatches();
  assert.equal(batches.length, 2);
  const contents = await Promise.all(batches.map((batch) => store.readBatch(batch)));
  assert.deepEqual(contents.map((items) => items[0].conversation_id), ['conv-2', 'conv-3']);
});
