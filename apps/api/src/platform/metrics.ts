/**
 * Minimal in-process metrics (Level B). The worker writes cross-process state into
 * runtime_flags; the API's /dev/metrics endpoint combines these with DB-derived gauges.
 */
const counters = new Map<string, number>();

export function increment(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function setGauge(name: string, value: number): void {
  counters.set(name, value);
}

export function snapshot(): Record<string, number> {
  return Object.fromEntries([...counters.entries()].sort());
}
