interface IoLease {
  publication: Promise<void> | null;
  settled: boolean;
  released: boolean;
}

/** One native transaction, including its authorized write, until it really settles. */
export class AnnotationIoGate {
  private active: IoLease | null = null;
  get busy() { return this.active !== null; }
  get publication(): Promise<void> | null { return this.active?.publication ?? null; }

  acquire(): (() => void) | null {
    if (this.active) return null;
    const lease: IoLease = { publication: null, settled: false, released: false };
    this.active = lease;
    return () => {
      lease.released = true;
      this.releaseIfSettled(lease);
    };
  }

  /** Register the promise before invoking filesystem/clipboard code, including synchronous throws. */
  publish(write: () => Promise<void>): Promise<void> {
    const lease = this.active;
    if (!lease || lease.released || lease.publication) throw new Error("No writable annotation I/O lease");
    const publication = Promise.resolve().then(write);
    lease.publication = publication;
    const settled = () => {
      lease.settled = true;
      this.releaseIfSettled(lease);
    };
    void publication.then(settled, settled);
    return publication;
  }

  private releaseIfSettled(lease: IoLease) {
    if (this.active === lease && lease.released && (!lease.publication || lease.settled)) this.active = null;
  }
}
