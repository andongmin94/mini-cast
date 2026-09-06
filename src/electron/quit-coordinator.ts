interface QuitEvent { preventDefault(): void }
interface Options {
  publication(): Promise<void> | null;
  cleanup(): void;
  resume(): void;
  failed(error: unknown): void;
}

/** The only owner of normal shutdown. A failed write never tears down a usable application. */
export class QuitCoordinator {
  private pending = false;
  private committed = false;
  constructor(private readonly options: Options) {}
  get waiting() { return this.pending; }

  beforeQuit(event: QuitEvent) {
    if (this.pending) { event.preventDefault(); return; }
    if (this.committed) return;
    const publication = this.options.publication();
    if (!publication) {
      this.committed = true;
      this.options.cleanup();
      return;
    }
    event.preventDefault();
    this.pending = true;
    void publication.then(
      () => {
        // Let the I/O handler publish its result and release its lease first.
        queueMicrotask(() => {
          this.pending = false;
          try { this.options.resume(); } catch (error) { this.notifyFailure(error); }
        });
      },
      error => { this.pending = false; this.notifyFailure(error); },
    );
  }

  private notifyFailure(error: unknown) {
    try { this.options.failed(error); }
    catch (notificationError) { console.error("Unable to report a cancelled quit:", notificationError); }
  }
}
