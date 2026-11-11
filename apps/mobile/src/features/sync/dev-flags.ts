/**
 * Diagnostics-only toggles (Level B) that make offline behaviour reproducible. The settings
 * screen flips these; the sync engine consults them. Never part of production logic.
 */
const listeners = new Set<() => void>();
export function subscribeOffline(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
let forceOffline = false;
let dropNextUpload = false;

export function setForceOffline(value: boolean): void {
  forceOffline = value;
  listeners.forEach((listener) => listener());
}

export function isForcedOffline(): boolean {
  return forceOffline;
}

export function requestDropNextUpload(): void {
  dropNextUpload = true;
}

/** Consumes (and clears) the "drop next upload" flag, for the sync engine's upload step. */
export function consumeDropNextUpload(): boolean {
  const value = dropNextUpload;
  dropNextUpload = false;
  return value;
}
