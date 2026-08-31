export class CoalescingSerialExecutor {
  private requested = false;
  private running: Promise<void> | null = null;

  constructor(private readonly task: () => Promise<void>) {}

  request() {
    this.requested = true;
    this.running ??= this.drain().finally(() => {
      this.running = null;
      if (this.requested) void this.request().catch(() => undefined);
    });
    return this.running;
  }

  private async drain() {
    while (this.requested) {
      this.requested = false;
      await this.task();
    }
  }
}
