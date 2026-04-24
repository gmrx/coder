import * as fs from 'fs/promises';
import * as path from 'path';
import type { MetricsOutboxBatchInfo, TelemetryEvent } from './types';

interface StoredTelemetryBatch {
  createdAt: number;
  events: TelemetryEvent[];
}

export class MetricsOutboxStore {
  constructor(
    private readonly rootPath: string,
    private readonly limits: { maxFiles: number; maxBytes: number },
  ) {}

  isReady(): boolean {
    return String(this.rootPath || '').trim().length > 0;
  }

  async writeBatch(events: TelemetryEvent[]): Promise<MetricsOutboxBatchInfo | null> {
    if (!this.isReady() || events.length === 0) return null;
    await fs.mkdir(this.rootPath, { recursive: true });
    const createdAt = Date.now();
    const fileName = `${createdAt}-${Math.random().toString(36).slice(2, 10)}.json`;
    const filePath = path.join(this.rootPath, fileName);
    const tempPath = `${filePath}.tmp`;
    const payload: StoredTelemetryBatch = {
      createdAt,
      events: events.map((event) => ({ ...event })),
    };
    await fs.writeFile(tempPath, JSON.stringify(payload), 'utf8');
    await fs.rename(tempPath, filePath);
    await this.prune();
    const stat = await fs.stat(filePath);
    return {
      fileName,
      filePath,
      size: stat.size,
      createdAt,
    };
  }

  async listBatches(): Promise<MetricsOutboxBatchInfo[]> {
    if (!this.isReady()) return [];
    try {
      const fileNames = await fs.readdir(this.rootPath);
      const output: MetricsOutboxBatchInfo[] = [];
      for (const fileName of fileNames) {
        if (!fileName.endsWith('.json')) continue;
        const filePath = path.join(this.rootPath, fileName);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;
        output.push({
          fileName,
          filePath,
          size: stat.size,
          createdAt: parseCreatedAt(fileName, stat.mtimeMs),
        });
      }
      output.sort((left, right) => left.createdAt - right.createdAt || left.fileName.localeCompare(right.fileName));
      return output;
    } catch {
      return [];
    }
  }

  async readBatch(batch: MetricsOutboxBatchInfo): Promise<TelemetryEvent[]> {
    const raw = await fs.readFile(batch.filePath, 'utf8');
    const parsed = JSON.parse(raw) as StoredTelemetryBatch | TelemetryEvent[];
    if (Array.isArray(parsed)) {
      return parsed.map((event) => ({ ...event }));
    }
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    return events.map((event) => ({ ...event }));
  }

  async deleteBatch(batch: MetricsOutboxBatchInfo): Promise<void> {
    try {
      await fs.unlink(batch.filePath);
    } catch {
      // Ignore missing files.
    }
  }

  async prune(): Promise<{ removedFiles: number; removedBytes: number }> {
    const batches = await this.listBatches();
    let totalBytes = batches.reduce((sum, batch) => sum + batch.size, 0);
    let removedFiles = 0;
    let removedBytes = 0;
    let fileCount = batches.length;
    for (const batch of batches) {
      if (fileCount <= this.limits.maxFiles && totalBytes <= this.limits.maxBytes) break;
      await this.deleteBatch(batch);
      removedFiles += 1;
      removedBytes += batch.size;
      fileCount -= 1;
      totalBytes -= batch.size;
    }
    return { removedFiles, removedBytes };
  }
}

function parseCreatedAt(fileName: string, fallbackMs: number): number {
  const match = /^(\d+)-/.exec(fileName);
  if (!match) return Math.max(0, Math.floor(fallbackMs || 0));
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : Math.max(0, Math.floor(fallbackMs || 0));
}
