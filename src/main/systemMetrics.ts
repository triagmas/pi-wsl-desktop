/**
 * UI-B R01 — сэмплер метрик Windows-хоста (main-процесс).
 *
 * CPU считается по приросту накопительных времён `os.cpus()` между опросами —
 * это загрузка хоста, а не процесса Pi и не гостевой Ubuntu. Первый опрос
 * честно отдаёт null (в UI «—»), потому что дельты ещё нет.
 */
import os from 'node:os';
import { EMPTY_METRICS, type MetricsSample } from '../shared/terminalMetrics';

export { EMPTY_METRICS, formatMetrics, typeofSample } from '../shared/terminalMetrics';
export type { MetricsSample } from '../shared/terminalMetrics';

interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

export interface MetricsReader {
  cpus?: () => Array<{ times: CpuTimes }>;
  totalmem?: () => number;
  freemem?: () => number;
  now?: () => number;
  /** Нижняя граница между пересчётами CPU: чаще — отдаём кэш. */
  minIntervalMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 500;

function sumTimes(cpus: Array<{ times: CpuTimes }>): { idle: number; total: number } | null {
  if (!Array.isArray(cpus) || cpus.length === 0) return null;
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu?.times;
    if (!t) return null;
    const values = [t.user, t.nice, t.sys, t.idle, t.irq];
    if (!values.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

export class SystemMetricsSampler {
  private last: MetricsSample = EMPTY_METRICS;
  private hasSample = false;
  private prevTimes: { idle: number; total: number } | null = null;
  private readonly cpus: () => Array<{ times: CpuTimes }>;
  private readonly totalmem: () => number;
  private readonly freemem: () => number;
  private readonly now: () => number;
  private readonly minIntervalMs: number;

  constructor(reader: MetricsReader = {}) {
    this.cpus = reader.cpus ?? (() => os.cpus());
    this.totalmem = reader.totalmem ?? (() => os.totalmem());
    this.freemem = reader.freemem ?? (() => os.freemem());
    this.now = reader.now ?? (() => Date.now());
    this.minIntervalMs = reader.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  /** Текущий снимок. Дёшево: без shell-команд и без сетевых вызовов. */
  sample(): MetricsSample {
    const at = this.now();
    if (this.hasSample && at - this.last.at < this.minIntervalMs) {
      return this.last;
    }

    const memory = this.readMemory();
    const times = this.readTimes();

    let cpuPercent: number | null = null;
    if (times && this.prevTimes) {
      const idleDelta = times.idle - this.prevTimes.idle;
      const totalDelta = times.total - this.prevTimes.total;
      if (totalDelta > 0 && idleDelta >= 0) {
        const busy = 100 * (1 - idleDelta / totalDelta);
        cpuPercent = Math.round(Math.min(100, Math.max(0, busy)) * 10) / 10;
      }
    }
    if (times) this.prevTimes = times;

    this.last = { at, cpuPercent, ...memory };
    this.hasSample = true;
    return this.last;
  }

  private readMemory(): Pick<MetricsSample, 'memUsedBytes' | 'memTotalBytes'> {
    try {
      const total = this.totalmem();
      const free = this.freemem();
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0) {
        return { memUsedBytes: null, memTotalBytes: null };
      }
      const used = Math.max(0, Math.min(total, total - free));
      return { memUsedBytes: used, memTotalBytes: total };
    } catch {
      return { memUsedBytes: null, memTotalBytes: null };
    }
  }

  private readTimes(): { idle: number; total: number } | null {
    try {
      return sumTimes(this.cpus());
    } catch {
      return null;
    }
  }
}
