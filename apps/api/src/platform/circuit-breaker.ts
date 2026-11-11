/**
 * Minimal, readable circuit breaker (ADR-009). Guards the single legacy call site so a
 * down legacy system does not consume all worker capacity. closed → open → half-open.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker open. */
  failureThreshold: number;
  /** How long to stay open before allowing one probe in half-open. */
  resetTimeoutMs: number;
}

export class CircuitOpenError extends Error {
  constructor() {
    super('circuit breaker is open');
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private openedAt = 0;

  constructor(private readonly options: CircuitBreakerOptions) {}

  get currentState(): CircuitState {
    return this.state;
  }

  async run<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      throw new CircuitOpenError();
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Called by the consumer before each pull. Transitions open → half-open once the reset
   * window has passed, and returns false while the breaker is open so the consumer can
   * pause instead of burning retry attempts against a known-down dependency.
   */
  allowProbe(): boolean {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.options.resetTimeoutMs) {
      this.state = 'half_open';
    }
    return this.state !== 'open';
  }

  private onSuccess(): void {
    this.state = 'closed';
    this.failureCount = 0;
  }

  private onFailure(): void {
    this.failureCount += 1;
    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }
}
