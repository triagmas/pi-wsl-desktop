/**
 * UI-B R01 — метрики Windows-хоста в статус-баре.
 *
 * Источник — main-процесс (`node:os`), renderer получает готовый снимок.
 * Никаких shell-команд на каждый опрос (wmic/PowerShell не используются),
 * никакой телеметрии в сеть. Неизвестное значение — null, в UI — «—».
 */

/** Снимок метрик Windows-хоста. null = значение недоступно, не «ноль». */
export interface MetricsSample {
  /** Момент снятия (ms, Date.now). */
  at: number;
  /** Общая загрузка хоста, 0..100, один знак после запятой. null — нет данных. */
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memTotalBytes: number | null;
}

export const EMPTY_METRICS: MetricsSample = {
  at: 0,
  cpuPercent: null,
  memUsedBytes: null,
  memTotalBytes: null,
};

const GB = 1024 ** 3;

function gb(bytes: number): string {
  const text = (bytes / GB).toFixed(1).replace('.', ',');
  return text.endsWith(',0') ? text.slice(0, -2) : text;
}

/** Формат статус-бара: CPU «12%», RAM «8,4 / 32 ГБ»; недоступное — «—». */
export function formatMetrics(sample: MetricsSample): { cpu: string; ram: string } {
  const cpu = typeof sample.cpuPercent === 'number' && Number.isFinite(sample.cpuPercent)
    ? `${Math.round(sample.cpuPercent)}%`
    : '—';
  const hasMem =
    typeof sample.memUsedBytes === 'number' &&
    Number.isFinite(sample.memUsedBytes) &&
    typeof sample.memTotalBytes === 'number' &&
    Number.isFinite(sample.memTotalBytes) &&
    sample.memTotalBytes > 0;
  const ram = hasMem ? `${gb(sample.memUsedBytes as number)} / ${gb(sample.memTotalBytes as number)} ГБ` : '—';
  return { cpu, ram };
}

/** Проверка формы payload из preload: renderer не доверяет форме слепо. */
export function typeofSample(value: unknown): value is MetricsSample {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at)) return false;
  const nullableNumber = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x));
  return (
    nullableNumber(v.cpuPercent) && nullableNumber(v.memUsedBytes) && nullableNumber(v.memTotalBytes)
  );
}
