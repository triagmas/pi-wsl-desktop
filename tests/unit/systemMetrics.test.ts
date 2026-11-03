/**
 * UI-B R01 — метрики Windows-хоста считает main-процесс (node:os), renderer
 * получает готовый снимок. Контракт: первый опрос не выдумывает CPU (null → «—»),
 * дельта считается между опросами, частые вызовы не пересчитываются,
 * недоступные значения — null, а не ноль.
 */
import { describe, expect, it, vi } from 'vitest';
import { SystemMetricsSampler, formatMetrics, typeofSample } from '../../src/main/systemMetrics';

interface Cpu {
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}

function cpu(idle: number, busy: number): Cpu {
  return { times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } };
}

const GB = 1024 ** 3;

describe('system metrics sampler (Windows host)', () => {
  it('returns null CPU on the first sample instead of a fake zero', () => {
    const sampler = new SystemMetricsSampler({
      cpus: () => [cpu(1000, 500)],
      totalmem: () => 32 * GB,
      freemem: () => 20 * GB,
      now: () => 1_000,
    });
    const first = sampler.sample();
    expect(first.cpuPercent).toBeNull();
    expect(first.memTotalBytes).toBe(32 * GB);
    expect(first.memUsedBytes).toBe(12 * GB);
    expect(first.at).toBe(1_000);
  });

  it('computes CPU from the idle/total delta between samples', () => {
    let clock = 0;
    let idle = 0;
    let busy = 0;
    const sampler = new SystemMetricsSampler({
      cpus: () => [cpu(idle, busy)],
      totalmem: () => 8 * GB,
      freemem: () => 6 * GB,
      now: () => clock,
    });
    sampler.sample();
    clock = 2_000;
    idle = 1_500; // 1.5 s idle
    busy = 500; // 0.5 s busy  → 25 %
    expect(sampler.sample().cpuPercent).toBe(25);

    clock = 4_000;
    idle = 1_600; // +100 idle
    busy = 900; // +400 busy → 80 %
    expect(sampler.sample().cpuPercent).toBe(80);
  });

  it('never returns more than 100 % or a negative value', () => {
    let clock = 0;
    let idle = 0;
    let busy = 0;
    const sampler = new SystemMetricsSampler({
      cpus: () => [cpu(idle, busy)],
      totalmem: () => GB,
      freemem: () => GB,
      now: () => clock,
    });
    sampler.sample();
    clock = 1_000;
    idle = 0;
    busy = 100; // всё время ушло в busy → 100 %
    expect(sampler.sample().cpuPercent).toBe(100);
    clock = 2_000;
    idle = 90; // counters went backwards (их сбрасывает ОС) → не отрицательное значение
    busy = 0;
    expect(sampler.sample().cpuPercent).toBeNull();
  });

  it('reuses the last sample for calls inside the minimum interval', () => {
    let clock = 0;
    let idle = 0;
    const cpus = vi.fn(() => [cpu(idle, 100)]);
    const sampler = new SystemMetricsSampler({
      cpus,
      totalmem: () => GB,
      freemem: () => GB / 2,
      now: () => clock,
      minIntervalMs: 500,
    });
    sampler.sample();
    clock = 100;
    idle = 50;
    const cached = sampler.sample();
    expect(cached.cpuPercent).toBeNull();
    expect(cpus).toHaveBeenCalledTimes(1);
    clock = 600;
    sampler.sample();
    expect(cpus).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable host readers as null (not zero)', () => {
    const sampler = new SystemMetricsSampler({
      cpus: () => [],
      totalmem: () => Number.NaN,
      freemem: () => Number.NaN,
      now: () => 0,
    });
    const sample = sampler.sample();
    expect(sample.cpuPercent).toBeNull();
    expect(sample.memTotalBytes).toBeNull();
    expect(sample.memUsedBytes).toBeNull();
  });

  it('sums all cores and tolerates a throwing reader', () => {
    const sampler = new SystemMetricsSampler({
      cpus: () => {
        throw new Error('boom');
      },
      totalmem: () => 16 * GB,
      freemem: () => 4 * GB,
      now: () => 0,
    });
    const sample = sampler.sample();
    expect(sample.cpuPercent).toBeNull();
    expect(sample.memUsedBytes).toBe(12 * GB);
  });
});

describe('metrics formatting (status bar)', () => {
  it('renders dashes for missing values and never a fake zero', () => {
    expect(formatMetrics({ at: 0, cpuPercent: null, memUsedBytes: null, memTotalBytes: null })).toEqual({
      cpu: '—',
      ram: '—',
    });
  });

  it('formats CPU in percent and RAM in GB with a Russian decimal comma', () => {
    const fmt = formatMetrics({
      at: 0,
      cpuPercent: 12.34,
      memUsedBytes: 8.4 * GB,
      memTotalBytes: 32 * GB,
    });
    expect(fmt.cpu).toBe('12%');
    expect(fmt.ram).toBe('8,4 / 32 ГБ');
  });

  it('keeps sub-gigabyte memory readable', () => {
    const fmt = formatMetrics({ at: 0, cpuPercent: 0, memUsedBytes: 512 * 1024 ** 2, memTotalBytes: 16 * GB });
    expect(fmt.cpu).toBe('0%');
    expect(fmt.ram).toBe('0,5 / 16 ГБ');
  });

  it('exposes a runtime shape guard for the preload payload', () => {
    expect(typeofSample({ at: 1, cpuPercent: 5, memUsedBytes: 1, memTotalBytes: 2 })).toBe(true);
    expect(typeofSample({ at: 1, cpuPercent: null, memUsedBytes: null, memTotalBytes: null })).toBe(true);
    expect(typeofSample({ at: 1 })).toBe(false);
    expect(typeofSample(null)).toBe(false);
    expect(typeofSample('nope')).toBe(false);
  });
});
