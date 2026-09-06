import type { EventEmitter } from "node:events";
import type { AnnotationIoGate } from "./annotation-io-gate.js";

/** Preparation expires permanently on hide/reload; an authorized publication is allowed to finish. */
export class AnnotationIoLifetime {
  private expired = false;
  private publishing = false;
  private disposed = false;
  private subscriptions: (() => void)[] = [];

  constructor(private readonly onInvalidate: () => void = () => undefined) {}
  get invalidated() { return this.expired; }

  readonly invalidate = () => {
    if (this.publishing || this.expired || this.disposed) return;
    this.expired = true;
    this.onInvalidate();
  };

  watch(emitter: Pick<EventEmitter, "on" | "removeListener">, events: readonly string[]) {
    if (this.disposed) throw new Error("Annotation I/O lifetime is disposed");
    for (const event of events) {
      emitter.on(event, this.invalidate);
      this.subscriptions.push(() => emitter.removeListener(event, this.invalidate));
    }
  }

  publish(gate: AnnotationIoGate, write: () => Promise<void>): Promise<void> {
    if (this.expired || this.disposed || this.publishing) throw new Error("Annotation I/O preparation expired");
    const publication = gate.publish(write);
    this.publishing = true;
    return publication;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.subscriptions) stop();
    this.subscriptions = [];
  }
}
