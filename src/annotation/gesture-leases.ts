const GESTURE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

export function isGestureId(value: unknown): value is string {
  return typeof value === "string" && GESTURE_ID_PATTERN.test(value);
}

export interface GestureLease {
  ownerId: number;
  gestureId: string;
}

export class GestureLeaseRegistry {
  private readonly leases = new Map<number, string>();

  begin(ownerId: number, gestureId: string) {
    const previous = this.leases.get(ownerId) ?? null;
    this.leases.set(ownerId, gestureId);
    return previous;
  }

  matches(ownerId: number, gestureId: string) {
    return this.leases.get(ownerId) === gestureId;
  }

  end(ownerId: number, gestureId: string) {
    if (!this.matches(ownerId, gestureId)) return false;
    this.leases.delete(ownerId);
    return true;
  }

  removeOwner(ownerId: number) {
    return this.leases.delete(ownerId);
  }

  cancelAll() {
    const canceled = [...this.leases].map(([ownerId, gestureId]) => ({
      ownerId,
      gestureId,
    }));
    this.leases.clear();
    return canceled;
  }

  get size() {
    return this.leases.size;
  }
}
