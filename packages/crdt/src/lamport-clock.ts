/**
 * Lamport Clock — monotonically increasing logical timestamp for causal ordering
 * of CRDT updates and snapshots.
 */

export class LamportClock {
  private _value: number;

  constructor(initial = 0) {
    this._value = initial;
  }

  /** Current clock value */
  get value(): number {
    return this._value;
  }

  /** Increment and return the new value (for local events) */
  tick(): number {
    return ++this._value;
  }

  /**
   * Merge with a received remote clock:
   * local = max(local, remote) + 1
   */
  merge(remoteClock: number): number {
    this._value = Math.max(this._value, remoteClock) + 1;
    return this._value;
  }

  /**
   * Check if a remote clock value is valid (must be > last seen for that source).
   * For append-only log validation.
   */
  isValidNext(remoteClock: number): boolean {
    return remoteClock > this._value;
  }
}
