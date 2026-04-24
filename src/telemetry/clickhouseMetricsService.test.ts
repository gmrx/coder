import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ClickHouseMetricsService } from './clickhouseMetricsService';
import { MetricsOutboxStore } from './outboxStore';
import type { TelemetryEvent } from './types';

function buildEvent(id: string): TelemetryEvent {
  return {
    event_time: new Date(1_700_000_000_000).toISOString(),
    install_id: 'install-1',
    user_api_key: 'api-key',
    conversation_id: `conv-${id}`,
    run_id: `run-${id}`,
    source_type: 'jira',
    source_project_key: 'PRJ',
    source_task_key: 'PRJ-1',
    event_family: 'run',
    event_name: 'finished',
    status: 'done',
    model: 'Qwen-Test',
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

test('metrics service keeps failed batches locally and drains them later', async () => {
  let statusCode = 500;
  const requests: Array<{ url: string; body: string }> = [];
  const fetchImpl: typeof fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      body: String(init?.body || ''),
    });
    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      text: async () => (statusCode === 200 ? 'ok' : 'fail'),
    } as Response;
  }) as typeof fetch;

  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'cursorcoder-metrics-'));
  const outbox = new MetricsOutboxStore(path.join(storageRoot, 'metrics-outbox'), {
    maxFiles: 100,
    maxBytes: 25 * 1024 * 1024,
  });
  const service = new ClickHouseMetricsService({
    installId: 'install-1',
    storagePath: storageRoot,
    config: {
      url: 'https://clickhouse.local',
      username: 'metrics',
      password: 'metrics-pass',
      database: 'ai_assistant_metrics',
      table: 'agent_events_raw',
      requestTimeoutMs: 5_000,
      flushIntervalMs: 60_000,
      retryIntervalMs: 0,
      batchSize: 50,
      outboxMaxFiles: 100,
      outboxMaxBytes: 25 * 1024 * 1024,
    },
    fetchImpl,
    logger: { warn() {} },
  });

  try {
    service.enqueue(buildEvent('1'));
    await service.flushNow();
    assert.equal((await outbox.listBatches()).length, 1);

    statusCode = 200;
    await service.drainNow();
    assert.equal((await outbox.listBatches()).length, 0);
    assert.ok(requests.length > 4);
    assert.match(requests[0].url, /CREATE%20DATABASE%20IF%20NOT%20EXISTS%20ai_assistant_metrics/);
    assert.match(requests.map((request) => request.url).join('\n'), /CREATE%20TABLE%20IF%20NOT%20EXISTS%20ai_assistant_metrics\.agent_events_raw/);
    assert.match(requests.map((request) => request.url).join('\n'), /ALTER%20TABLE%20ai_assistant_metrics\.agent_events_raw%20ADD%20COLUMN%20IF%20NOT%20EXISTS%20attrs_json/);
    const insertRequest = requests[requests.length - 1];
    assert.doesNotMatch(insertRequest.body, /T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    assert.match(insertRequest.body, /"event_time":"2023-11-14 22:13:20\.000"/);
    assert.match(insertRequest.body, /"conversation_id":"conv-1"/);
  } finally {
    service.dispose();
  }
});
