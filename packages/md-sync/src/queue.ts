/**
 * Runs async jobs strictly one after another. All engine work (local events, remote events,
 * reconcile) goes through one queue, so the 3-way decisions never race each other.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Resolves once every job queued so far (and any queued meanwhile) has finished. */
  async idle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = this.tail;
      await current;
    } while (current !== this.tail);
  }
}
