/** One native annotation file/clipboard operation at a time, shared by both UIs. */
export class AnnotationIoGate {
  private locked = false;
  get busy() { return this.locked; }
  acquire(): (() => void) | null {
    if (this.locked) return null;
    this.locked = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.locked = false;
    };
  }
}
