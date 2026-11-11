/**
 * Mutable fault state for the on-premises stand-in (Level B).
 * The /dev/faults routes mutate this so the platform can be shown recovering from
 * realistic failures (down, slow, duplicate, reject, error500). See FAILURE_SCENARIOS.md.
 */
export type FaultMode = 'ok' | 'down' | 'slow' | 'duplicate' | 'reject' | 'error500';

export interface FaultState {
  mode: FaultMode;
  latencyMs: number;
}

let state: FaultState = { mode: 'ok', latencyMs: 0 };

export function getFaultState(): FaultState {
  return state;
}

export function setFaultState(next: Partial<FaultState>): FaultState {
  state = { ...state, ...next };
  return state;
}
