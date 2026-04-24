import { Buffer } from 'buffer';
import * as path from 'path';
import { isClickHouseMetricsConfigured } from './clickhouseConfig';
import { assertClickHouseIdentifier, buildClickHouseSchemaQueryPlan } from './clickhouseSchema';
import { MetricsOutboxStore } from './outboxStore';
import type {
  ClickHouseMetricsLogger,
  ClickHouseMetricsServiceOptions,
  TelemetryEvent,
} from './types';

const DEFAULT_LOGGER: ClickHouseMetricsLogger = {
  warn(message: string, error?: unknown) {
    if (error !== undefined) {
      console.warn(`[aiAssistant.telemetry] ${message}`, error);
      return;
    }
    console.warn(`[aiAssistant.telemetry] ${message}`);
  },
};

export class ClickHouseMetricsService {
  private readonly logger: ClickHouseMetricsLogger;
  private readonly fetchImpl: typeof fetch;
  private readonly outbox: MetricsOutboxStore;
  private readonly configured: boolean;
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly requestUrl: string;
  private readonly authHeader: string;
  private readonly buffer: TelemetryEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private draining = false;
  private disposed = false;
  private schemaReady = false;
  private schemaPromise: Promise<void> | null = null;

  constructor(private readonly options: ClickHouseMetricsServiceOptions) {
    this.logger = options.logger || DEFAULT_LOGGER;
    this.fetchImpl = options.fetchImpl || fetch;
    this.outbox = new MetricsOutboxStore(
      options.storagePath ? path.join(options.storagePath, 'metrics-outbox') : '',
      {
        maxFiles: options.config.outboxMaxFiles,
        maxBytes: options.config.outboxMaxBytes,
      },
    );
    this.configured = isClickHouseMetricsConfigured(options.config);
    this.enabled = this.configured && this.outbox.isReady();
    this.baseUrl = buildBaseUrl(options.config);
    this.requestUrl = buildInsertUrl(options.config);
    this.authHeader = `Basic ${Buffer.from(`${options.config.username}:${options.config.password}`, 'utf8').toString('base64')}`;

    if (!this.enabled) {
      if (this.configured && !this.outbox.isReady()) {
        this.logger.warn('Telemetry disabled: storage path недоступен.');
      }
      return;
    }

    if (this.options.config.retryIntervalMs > 0) {
      this.retryTimer = setInterval(() => {
        void this.drainNow();
      }, this.options.config.retryIntervalMs);
    }
    void this.drainNow();
  }

  enqueue(event: TelemetryEvent): void {
    if (!this.enabled || this.disposed) return;
    this.buffer.push(this.withInstallId(event));
    if (this.buffer.length >= this.options.config.batchSize) {
      void this.flushNow();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, this.options.config.flushIntervalMs);
  }

  enqueueMany(events: TelemetryEvent[]): void {
    for (const event of events) {
      this.enqueue(event);
    }
  }

  async flushNow(): Promise<void> {
    if (!this.enabled || this.disposed || this.buffer.length === 0) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const batch = this.buffer.splice(0, this.buffer.length);
    if (batch.length === 0) return;
    await this.outbox.writeBatch(batch);
    const pruned = await this.outbox.prune();
    if (pruned.removedFiles > 0) {
      this.logger.warn(`Outbox pruned: removed ${pruned.removedFiles} batch file(s), ${pruned.removedBytes} bytes.`);
    }
    await this.drainNow();
  }

  async drainNow(): Promise<void> {
    if (!this.enabled || this.disposed || this.draining) return;
    this.draining = true;
    try {
      try {
        await this.ensureSchema();
      } catch (error) {
        this.logger.warn('ClickHouse schema ensure failed. Will retry later.', error);
        return;
      }
      while (!this.disposed) {
        const batches = await this.outbox.listBatches();
        if (batches.length === 0) return;
        const nextBatch = batches[0];
        const events = await this.outbox.readBatch(nextBatch);
        if (events.length === 0) {
          await this.outbox.deleteBatch(nextBatch);
          continue;
        }
        try {
          await this.sendBatch(events);
          await this.outbox.deleteBatch(nextBatch);
        } catch (error) {
          this.logger.warn(`ClickHouse upload failed for batch ${nextBatch.fileName}. Will retry later.`, error);
          return;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    const pendingBatch = this.buffer.splice(0, this.buffer.length);
    this.disposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.enabled && pendingBatch.length > 0) {
      void this.outbox.writeBatch(pendingBatch).catch((error) => {
        this.logger.warn('Failed to persist telemetry buffer during dispose.', error);
      });
    }
  }

  private async sendBatch(events: TelemetryEvent[]): Promise<void> {
    const body = events.map((event) => JSON.stringify(normalizeTelemetryEvent(event))).join('\n') + '\n';
    const response = await this.fetchImpl(this.requestUrl, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/x-ndjson; charset=utf-8',
      },
      body,
      signal: AbortSignal.timeout(this.options.config.requestTimeoutMs),
    });
    if (response.ok) return;
    const responseText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }

  private async ensureSchema(): Promise<void> {
    if (!this.enabled || this.disposed || this.schemaReady) return;
    if (this.schemaPromise) {
      await this.schemaPromise;
      return;
    }

    this.schemaPromise = this.runSchemaMigrations()
      .then(() => {
        this.schemaReady = true;
      })
      .finally(() => {
        this.schemaPromise = null;
      });

    await this.schemaPromise;
  }

  private async runSchemaMigrations(): Promise<void> {
    for (const item of buildClickHouseSchemaQueryPlan(this.options.config)) {
      try {
        await this.sendQuery(item.query);
      } catch (error) {
        if (item.blocking) {
          throw error;
        }
        this.logger.warn(`ClickHouse optional schema step failed: ${item.label}.`, error);
      }
    }
  }

  private async sendQuery(query: string): Promise<void> {
    const response = await this.fetchImpl(buildQueryUrl(this.baseUrl, query), {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
      },
      signal: AbortSignal.timeout(this.options.config.requestTimeoutMs),
    });
    if (response.ok) return;
    const responseText = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }

  private withInstallId(event: TelemetryEvent): TelemetryEvent {
    return {
      ...event,
      install_id: this.options.installId,
    };
  }
}

function buildInsertUrl(config: ClickHouseMetricsServiceOptions['config']): string {
  const database = assertClickHouseIdentifier(config.database, 'database');
  const table = assertClickHouseIdentifier(config.table, 'table');
  const query = `INSERT INTO ${database}.${table} FORMAT JSONEachRow`;
  return buildQueryUrl(buildBaseUrl(config), query);
}

function buildBaseUrl(config: ClickHouseMetricsServiceOptions['config']): string {
  return String(config.url || '').trim().replace(/\/+$/, '');
}

function buildQueryUrl(base: string, query: string): string {
  return `${base}/?query=${encodeURIComponent(query)}`;
}

function normalizeTelemetryEvent(event: TelemetryEvent): TelemetryEvent {
  return {
    ...event,
    event_time: normalizeClickHouseDateTime(event.event_time),
  };
}

function normalizeClickHouseDateTime(value: string): string {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    return text;
  }

  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  const hours = String(parsed.getUTCHours()).padStart(2, '0');
  const minutes = String(parsed.getUTCMinutes()).padStart(2, '0');
  const seconds = String(parsed.getUTCSeconds()).padStart(2, '0');
  const millis = String(parsed.getUTCMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis}`;
}
