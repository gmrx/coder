import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClickHouseSchemaQueryPlan } from './clickhouseSchema';
import type { ClickHouseMetricsConfig } from './types';

const CONFIG: ClickHouseMetricsConfig = {
  url: 'https://clickhouse.local',
  username: 'metrics',
  password: 'secret',
  database: 'ai_agent',
  table: 'agent_events_raw',
  requestTimeoutMs: 5_000,
  flushIntervalMs: 1_000,
  retryIntervalMs: 30_000,
  batchSize: 50,
  outboxMaxFiles: 100,
  outboxMaxBytes: 25 * 1024 * 1024,
};

test('schema plan creates database, raw table, migrations and idempotent column alters', () => {
  const plan = buildClickHouseSchemaQueryPlan(CONFIG);
  const sql = plan.map((item) => item.query).join('\n\n');

  assert.match(sql, /CREATE DATABASE IF NOT EXISTS ai_agent/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_agent\.agent_schema_migrations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_agent\.agent_events_raw/);
  assert.match(sql, /ALTER TABLE ai_agent\.agent_events_raw ADD COLUMN IF NOT EXISTS event_time DateTime64\(3\)/);
  assert.match(sql, /ALTER TABLE ai_agent\.agent_events_raw ADD COLUMN IF NOT EXISTS attrs_json String AFTER destructive/);
  assert.match(sql, /INSERT INTO ai_agent\.agent_schema_migrations/);
});

test('schema plan treats aggregate views and bookkeeping as non-blocking', () => {
  const plan = buildClickHouseSchemaQueryPlan(CONFIG);
  const viewQueries = plan.filter((item) => /CREATE OR REPLACE VIEW/.test(item.query));
  const migrationRecordQueries = plan.filter((item) => item.label.startsWith('record '));

  assert.equal(viewQueries.length, 3);
  assert.ok(viewQueries.every((item) => !item.blocking));
  assert.ok(migrationRecordQueries.length >= 1);
  assert.ok(migrationRecordQueries.every((item) => !item.blocking));
});

test('schema plan rejects unsafe identifiers', () => {
  assert.throws(
    () => buildClickHouseSchemaQueryPlan({ ...CONFIG, database: 'ai-agent; DROP TABLE x' }),
    /Invalid ClickHouse database/,
  );
});
