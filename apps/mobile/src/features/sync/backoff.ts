/**
 * Exponential backoff with jitter, for submission and upload retries. Bounded so a device
 * left offline does not wait arbitrarily long; the sync engine re-runs on connectivity
 * recovery regardless of this schedule.
 */
export function backoffDelayMs(
  attempts: number,
  options: { baseMs?: number; capMs?: number; jitter?: boolean } = {},
): number {
  const { baseMs = 2_000, capMs = 300_000, jitter = true } = options;
  const exponent = Math.min(attempts, 8); // prevent overflow at high attempt counts
  const delay = Math.min(baseMs * 2 ** exponent, capMs);
  if (!jitter) return delay;
  // Add up to 30% random jitter so many devices don't retry in lockstep.
  return Math.round(delay + Math.random() * delay * 0.3);
}
