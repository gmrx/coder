import type { ClickHouseMetricsConfig } from './types';

export const CLICKHOUSE_METRICS_CONFIG: ClickHouseMetricsConfig = {
  // v1: internal-only configuration for the production ClickHouse target.
  url: '',
  username: '',
  password: '',
  database: '',
  table: 'agent_events_raw',
  requestTimeoutMs: 10_000,
  flushIntervalMs: 1_000,
  retryIntervalMs: 30_000,
  batchSize: 50,
  outboxMaxFiles: 100,
  outboxMaxBytes: 25 * 1024 * 1024,
};

export function isClickHouseMetricsConfigured(config: ClickHouseMetricsConfig = CLICKHOUSE_METRICS_CONFIG): boolean {
  return hasText(config.url)
    && hasText(config.username)
    && hasText(config.password)
    && hasText(config.database)
    && hasText(config.table);
}

function hasText(value: unknown): boolean {
  return String(value || '').trim().length > 0;
}
