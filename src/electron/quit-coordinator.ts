interface QuitEvent { preventDefault(): void }
interface Options {
  publication(): Promise<void> | null;
  busy(): boolean;
  unsaved(): string | null;
  confirm(): Promise<boolean>;
  cleanup(): void;
  resume(): void;
  failed(error: unknown): void;
}

/** Normal shutdown waits for writes and requires content-specific permission to discard work. */
export class QuitCoordinator {
  private pending = false;
  private committed = false;
  private approved: string | null = null;
  constructor(private readonly options: Options) {}
  get waiting() { return this.pending; }

  beforeQuit(event: QuitEvent) {
    if (this.committed) return;
    if (this.pending) { event.preventDefault(); return; }
    try {
      const publication = this.options.publication();
      if (publication) {
        event.preventDefault();
        this.approved = null;
        this.pending = true;
        void publication.then(
          () => queueMicrotask(() => { this.pending = false; this.resume(); }),
          error => { this.pending = false; this.notifyFailure(error); },
        );
        return;
      }
      // A native save/open dialog or display swap must finish before another quit decision.
      if (this.options.busy()) { event.preventDefault(); this.approved = null; return; }
      const unsaved = this.options.unsaved();
      if (unsaved === null || unsaved === this.approved) {
        this.approved = null;
        this.committed = true;
        this.options.cleanup();
        return;
      }
      event.preventDefault();
      this.pending = true;
      this.approved = null;
      void Promise.resolve().then(() => this.options.confirm()).then(
        discard => {
          this.pending = false;
          if (!discard) return;
          this.approved = unsaved;
          this.resume(); // Re-check writes, dialogs and actual contents, not just the prior revision.
        },
        error => { this.pending = false; this.notifyFailure(error); },
      );
    } catch (error) {
      event.preventDefault();
      this.notifyFailure(error);
    }
  }

  private resume() {
    try { this.options.resume(); } catch (error) { this.notifyFailure(error); }
  }

  private notifyFailure(error: unknown) {
    this.approved = null;
    try { this.options.failed(error); }
    catch (notificationError) { console.error("Unable to report a cancelled quit:", notificationError); }
  }
}
