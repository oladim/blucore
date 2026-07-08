/**
 * PER-NETWORK CIRCUIT BREAKER
 * A Stedi incident should return fast, honest 503s — not hang the
 * event loop with thousands of pending sockets.
 */
type State = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private state: State = 'closed';
  private failures = 0;
  private openedAt = 0;

  constructor(
    private readonly name: string,
    private readonly failureThreshold = 8,
    private readonly resetTimeoutMs = 30_000,
  ) {}

  isAvailable(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open' && Date.now() - this.openedAt > this.resetTimeoutMs) {
      this.state = 'half_open';
      return true; // allow one probe
    }
    return this.state === 'half_open';
  }

  recordSuccess(): void { this.state = 'closed'; this.failures = 0; }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === 'half_open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  get status() { return { name: this.name, state: this.state, failures: this.failures }; }
}
