import type { OverlaySettings } from "./contract.js";

export type SettingsWriteState = "saved" | "pending" | "failed";

/** Debounces preferences, retains failed writes, and never owns app shutdown. */
export class SettingsWriter {
  private pending: OverlaySettings | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private currentState: SettingsWriteState = "saved";

  constructor(
    private readonly write: (settings: OverlaySettings) => void,
    private readonly onState: (state: SettingsWriteState) => void,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  get state() {
    return this.currentState;
  }

  schedule(settings: OverlaySettings) {
    this.pending = { ...settings };
    this.cancelTimer();
    this.setState("pending");
    this.timer = setTimeout(() => this.flush(), 150);
  }

  /** Used both by the explicit Retry action and by the normal quit handler. */
  flush(): boolean {
    this.cancelTimer();
    if (!this.pending) return true;

    try {
      this.write(this.pending);
    } catch (error) {
      this.setState("failed");
      this.onError(error);
      return false;
    }
    this.pending = null;
    this.setState("saved");
    return true;
  }

  private cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private setState(state: SettingsWriteState) {
    if (state === this.currentState) return;
    this.currentState = state;
    this.onState(state);
  }
}
