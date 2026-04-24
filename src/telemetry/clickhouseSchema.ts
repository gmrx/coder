import type { ClickHouseMetricsConfig } from './types';

export interface ClickHouseSchemaQuery {
  query: string;
  label: string;
  blocking: boolean;
}

type RawColumnDefinition = {
  name: string;
  type: string;
  after?: string;
};

type SchemaMigration = {
  version: string;
  description: string;
  blocking: boolean;
  queries: (names: ClickHouseSchemaNames) => string[];
};

type ClickHouseSchemaNames = {
  database: string;
  rawTable: string;
  migrationsTable: string;
  runMetricsView: string;
  dailyUsageView: string;
  codeChangesDailyView: string;
};

const RAW_EVENT_COLUMNS: RawColumnDefinition[] = [
  { name: 'event_time', type: 'DateTime64(3)' },
  { name: 'event_date', type: 'Date MATERIALIZED toDate(event_time)', after: 'event_time' },
  { name: 'install_id', type: 'String', after: 'event_date' },
  { name: 'user_api_key', type: 'String', after: 'install_id' },
  { name: 'conversation_id', type: 'String', after: 'user_api_key' },
  { name: 'run_id', type: 'String', after: 'conversation_id' },
  { name: 'source_type', type: 'LowCardinality(String)', after: 'run_id' },
  { name: 'source_project_key', type: 'String', after: 'source_type' },
  { name: 'source_task_key', type: 'String', after: 'source_project_key' },
  { name: 'event_family', type: 'LowCardinality(String)', after: 'source_task_key' },
  { name: 'event_name', type: 'LowCardinality(String)', after: 'event_family' },
  { name: 'status', type: 'LowCardinality(String)', after: 'event_name' },
  { name: 'model', type: 'String', after: 'status' },
  { name: 'tool_name', type: 'String', after: 'model' },
  { name: 'approval_kind', type: 'String', after: 'tool_name' },
  { name: 'file_ext', type: 'String', after: 'approval_kind' },
  { name: 'prompt_tokens', type: 'UInt32', after: 'file_ext' },
  { name: 'completion_tokens', type: 'UInt32', after: 'prompt_tokens' },
  { name: 'total_tokens', type: 'UInt32', after: 'completion_tokens' },
  { name: 'added_lines', type: 'UInt32', after: 'total_tokens' },
  { name: 'removed_lines', type: 'UInt32', after: 'added_lines' },
  { name: 'pending_files', type: 'UInt32', after: 'removed_lines' },
  { name: 'pending_changes', type: 'UInt32', after: 'pending_files' },
  { name: 'agent_lines', type: 'UInt32', after: 'pending_changes' },
  { name: 'agent_modified_by_user_lines', type: 'UInt32', after: 'agent_lines' },
  { name: 'agent_removed_lines', type: 'UInt32', after: 'agent_modified_by_user_lines' },
  { name: 'agent_deleted_by_user_lines', type: 'UInt32', after: 'agent_removed_lines' },
  { name: 'user_only_lines', type: 'UInt32', after: 'agent_deleted_by_user_lines' },
  { name: 'user_removed_lines', type: 'UInt32', after: 'user_only_lines' },
  { name: 'unknown_files', type: 'UInt32', after: 'user_removed_lines' },
  { name: 'rewound_requests', type: 'UInt32', after: 'unknown_files' },
  { name: 'restored_files', type: 'UInt32', after: 'rewound_requests' },
  { name: 'error_count', type: 'UInt32', after: 'restored_files' },
  { name: 'approved', type: 'UInt8', after: 'error_count' },
  { name: 'cancelled', type: 'UInt8', after: 'approved' },
  { name: 'auto_approved', type: 'UInt8', after: 'cancelled' },
  { name: 'destructive', type: 'UInt8', after: 'auto_approved' },
  { name: 'attrs_json', type: 'String', after: 'destructive' },
];

const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    version: '001_raw_events_table',
    description: 'Create raw telemetry events table',
    blocking: true,
    queries: (names) => [buildCreateRawTableQuery(names.rawTable)],
  },
  {
    version: '002_raw_events_columns',
    description: 'Ensure all v1 raw telemetry columns exist',
    blocking: true,
    queries: (names) => RAW_EVENT_COLUMNS.map((column) => buildAddColumnQuery(names.rawTable, column)),
  },
  {
    version: '003_aggregate_views_v1',
    description: 'Create or replace telemetry aggregate views',
    blocking: false,
    queries: (names) => [
      buildRunMetricsViewQuery(names),
      buildDailyUsageViewQuery(names),
      buildCodeChangesDailyViewQuery(names),
    ],
  },
];

export function buildClickHouseSchemaQueries(config: ClickHouseMetricsConfig): string[] {
  return buildClickHouseSchemaQueryPlan(config).map((item) => item.query);
}

export function buildClickHouseSchemaQueryPlan(config: ClickHouseMetricsConfig): ClickHouseSchemaQuery[] {
  const names = buildSchemaNames(config);
  const queries: ClickHouseSchemaQuery[] = [
    {
      label: 'create database',
      query: `CREATE DATABASE IF NOT EXISTS ${names.database}`,
      blocking: false,
    },
    {
      label: 'create schema migrations table',
      query: buildCreateMigrationsTableQuery(names.migrationsTable),
      blocking: false,
    },
  ];

  for (const migration of SCHEMA_MIGRATIONS) {
    for (const query of migration.queries(names)) {
      queries.push({
        label: migration.version,
        query,
        blocking: migration.blocking,
      });
    }
    queries.push({
      label: `record ${migration.version}`,
      query: buildRecordMigrationQuery(names.migrationsTable, migration),
      blocking: false,
    });
  }

  return queries;
}

export function buildQualifiedClickHouseName(database: string, name: string): string {
  return `${assertClickHouseIdentifier(database, 'database')}.${assertClickHouseIdentifier(name, 'identifier')}`;
}

export function assertClickHouseIdentifier(value: string, name: string): string {
  const text = String(value || '').trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    return text;
  }
  throw new Error(`Invalid ClickHouse ${name}: ${text}`);
}

function buildSchemaNames(config: ClickHouseMetricsConfig): ClickHouseSchemaNames {
  const database = assertClickHouseIdentifier(config.database, 'database');
  const table = assertClickHouseIdentifier(config.table, 'table');
  return {
    database,
    rawTable: `${database}.${table}`,
    migrationsTable: `${database}.agent_schema_migrations`,
    runMetricsView: `${database}.v_run_metrics`,
    dailyUsageView: `${database}.v_daily_usage`,
    codeChangesDailyView: `${database}.v_code_changes_daily`,
  };
}

function buildCreateRawTableQuery(rawTable: string): string {
  return `CREATE TABLE IF NOT EXISTS ${rawTable}
(
${RAW_EVENT_COLUMNS.map((column) => `    ${column.name} ${column.type}`).join(',\n')}
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
ORDER BY
(
    event_date,
    event_family,
    event_name,
    source_type,
    source_project_key,
    source_task_key,
    conversation_id,
    run_id,
    event_time
)
TTL event_date + INTERVAL 180 DAY DELETE
SETTINGS index_granularity = 8192`;
}

function buildCreateMigrationsTableQuery(migrationsTable: string): string {
  return `CREATE TABLE IF NOT EXISTS ${migrationsTable}
(
    version String,
    description String,
    applied_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY version`;
}

function buildAddColumnQuery(rawTable: string, column: RawColumnDefinition): string {
  const after = column.after ? ` AFTER ${column.after}` : '';
  return `ALTER TABLE ${rawTable} ADD COLUMN IF NOT EXISTS ${column.name} ${column.type}${after}`;
}

function buildRecordMigrationQuery(migrationsTable: string, migration: SchemaMigration): string {
  const version = quoteClickHouseString(migration.version);
  const description = quoteClickHouseString(migration.description);
  return `INSERT INTO ${migrationsTable} (version, description)
SELECT ${version}, ${description}
WHERE NOT EXISTS
(
    SELECT 1
    FROM ${migrationsTable}
    WHERE version = ${version}
)`;
}

function buildRunMetricsViewQuery(names: ClickHouseSchemaNames): string {
  return `CREATE OR REPLACE VIEW ${names.runMetricsView} AS
SELECT
    min(event_time) AS first_event_time,
    minIf(event_time, event_family = 'run' AND event_name = 'started') AS run_started_at,
    maxIf(event_time, event_family = 'run' AND event_name = 'finished') AS run_finished_at,
    run_id,
    anyHeavy(conversation_id) AS conversation_id,
    anyHeavy(install_id) AS install_id,
    anyHeavy(user_api_key) AS user_api_key,
    anyHeavy(source_type) AS source_type,
    anyHeavy(source_project_key) AS source_project_key,
    anyHeavy(source_task_key) AS source_task_key,
    argMaxIf(status, event_time, event_family = 'run' AND event_name = 'finished') AS run_status,
    argMaxIf(model, event_time, model != '') AS model,
    countIf(event_family = 'tool' AND event_name = 'started') AS tool_calls,
    countIf(event_family = 'tool' AND event_name = 'finished') AS tool_results,
    countIf(event_family = 'tool' AND event_name = 'error') AS tool_errors,
    countIf(event_family = 'approval' AND event_name = 'request') AS approvals_requested,
    countIf(event_family = 'approval' AND event_name = 'resolved') AS approvals_resolved,
    sumIf(approved, event_family = 'approval' AND event_name = 'resolved') AS approvals_approved,
    sumIf(cancelled, event_family = 'approval' AND event_name = 'resolved') AS approvals_cancelled,
    sumIf(auto_approved, event_family = 'approval') AS auto_approvals,
    countIf(event_family = 'question' AND event_name = 'request') AS questions_requested,
    countIf(event_family = 'question' AND event_name = 'resolved') AS questions_resolved,
    countIf(event_family = 'checkpoint' AND event_name = 'created') AS checkpoints_created,
    countIf(event_family = 'checkpoint' AND event_name = 'updated') AS checkpoints_updated,
    countIf(event_family = 'checkpoint' AND event_name = 'reverted') AS checkpoints_reverted,
    countIf(event_family = 'checkpoint' AND event_name = 'undo_revert') AS checkpoints_undo_reverted,
    countIf(event_family = 'checkpoint' AND event_name = 'branch_committed') AS checkpoints_branch_committed,
    sumIf(prompt_tokens, event_family = 'model' AND event_name = 'usage') AS prompt_tokens,
    sumIf(completion_tokens, event_family = 'model' AND event_name = 'usage') AS completion_tokens,
    sumIf(total_tokens, event_family = 'model' AND event_name = 'usage') AS total_tokens,
    sumIf(added_lines, event_family = 'file' AND event_name = 'change') AS added_lines,
    sumIf(removed_lines, event_family = 'file' AND event_name = 'change') AS removed_lines,
    maxIf(pending_files, event_family = 'change' AND event_name = 'snapshot') AS pending_files,
    maxIf(pending_changes, event_family = 'change' AND event_name = 'snapshot') AS pending_changes,
    maxIf(agent_lines, event_family = 'change' AND event_name = 'snapshot') AS agent_lines,
    maxIf(agent_modified_by_user_lines, event_family = 'change' AND event_name = 'snapshot') AS agent_modified_by_user_lines,
    maxIf(agent_removed_lines, event_family = 'change' AND event_name = 'snapshot') AS agent_removed_lines,
    maxIf(agent_deleted_by_user_lines, event_family = 'change' AND event_name = 'snapshot') AS agent_deleted_by_user_lines,
    maxIf(user_only_lines, event_family = 'change' AND event_name = 'snapshot') AS user_only_lines,
    maxIf(user_removed_lines, event_family = 'change' AND event_name = 'snapshot') AS user_removed_lines,
    maxIf(unknown_files, event_family = 'change' AND event_name = 'snapshot') AS unknown_files,
    sumIf(rewound_requests, event_family = 'checkpoint' AND event_name = 'reverted') AS rewound_requests,
    sumIf(restored_files, event_family = 'checkpoint' AND event_name = 'reverted') AS restored_files,
    sum(error_count) AS error_count
FROM ${names.rawTable}
WHERE run_id != ''
GROUP BY run_id`;
}

function buildDailyUsageViewQuery(names: ClickHouseSchemaNames): string {
  return `CREATE OR REPLACE VIEW ${names.dailyUsageView} AS
SELECT
    event_date AS day,
    user_api_key,
    source_type,
    source_project_key,
    source_task_key,
    if(model = '', 'unknown', model) AS model,
    uniqExact(conversation_id) AS conversations,
    countIf(event_family = 'message' AND event_name = 'user_request') AS user_requests,
    countIf(event_family = 'message' AND event_name = 'assistant_response') AS assistant_responses,
    countIf(event_family = 'run' AND event_name = 'started') AS run_starts,
    countIf(event_family = 'run' AND event_name = 'finished') AS run_finishes,
    countIf(event_family = 'tool' AND event_name = 'started') AS tool_calls,
    countIf(event_family = 'tool' AND event_name = 'error') AS tool_errors,
    countIf(event_family = 'approval' AND event_name = 'request') AS approvals_requested,
    countIf(event_family = 'approval' AND event_name = 'resolved') AS approvals_resolved,
    countIf(event_family = 'question' AND event_name = 'request') AS questions_requested,
    countIf(event_family = 'question' AND event_name = 'resolved') AS questions_resolved,
    countIf(event_family = 'checkpoint' AND event_name = 'created') AS checkpoints_created,
    sum(prompt_tokens) AS prompt_tokens,
    sum(completion_tokens) AS completion_tokens,
    sum(total_tokens) AS total_tokens,
    sum(added_lines) AS added_lines,
    sum(removed_lines) AS removed_lines
FROM ${names.rawTable}
GROUP BY
    day,
    user_api_key,
    source_type,
    source_project_key,
    source_task_key,
    model`;
}

function buildCodeChangesDailyViewQuery(names: ClickHouseSchemaNames): string {
  return `CREATE OR REPLACE VIEW ${names.codeChangesDailyView} AS
SELECT
    event_date AS day,
    user_api_key,
    source_type,
    source_project_key,
    source_task_key,
    countIf(event_family = 'file' AND event_name = 'change') AS file_changes,
    sumIf(added_lines, event_family = 'file' AND event_name = 'change') AS added_lines,
    sumIf(removed_lines, event_family = 'file' AND event_name = 'change') AS removed_lines,
    maxIf(pending_files, event_family = 'change' AND event_name = 'snapshot') AS pending_files,
    maxIf(pending_changes, event_family = 'change' AND event_name = 'snapshot') AS pending_changes,
    maxIf(agent_lines, event_family = 'change' AND event_name = 'snapshot') AS agent_lines,
    maxIf(agent_modified_by_user_lines, event_family = 'change' AND event_name = 'snapshot') AS agent_modified_by_user_lines,
    maxIf(agent_removed_lines, event_family = 'change' AND event_name = 'snapshot') AS agent_removed_lines,
    maxIf(agent_deleted_by_user_lines, event_family = 'change' AND event_name = 'snapshot') AS agent_deleted_by_user_lines,
    maxIf(user_only_lines, event_family = 'change' AND event_name = 'snapshot') AS user_only_lines,
    maxIf(user_removed_lines, event_family = 'change' AND event_name = 'snapshot') AS user_removed_lines,
    maxIf(unknown_files, event_family = 'change' AND event_name = 'snapshot') AS unknown_files,
    countIf(event_family = 'checkpoint' AND event_name = 'created') AS checkpoints_created,
    countIf(event_family = 'checkpoint' AND event_name = 'updated') AS checkpoints_updated,
    countIf(event_family = 'checkpoint' AND event_name = 'reverted') AS checkpoints_reverted,
    countIf(event_family = 'checkpoint' AND event_name = 'undo_revert') AS checkpoints_undo_reverted,
    countIf(event_family = 'checkpoint' AND event_name = 'branch_committed') AS checkpoints_branch_committed,
    sumIf(rewound_requests, event_family = 'checkpoint' AND event_name = 'reverted') AS rewound_requests,
    sumIf(restored_files, event_family = 'checkpoint' AND event_name = 'reverted') AS restored_files
FROM ${names.rawTable}
GROUP BY
    day,
    user_api_key,
    source_type,
    source_project_key,
    source_task_key`;
}

function quoteClickHouseString(value: string): string {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}
