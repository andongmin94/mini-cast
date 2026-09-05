import assert from "node:assert/strict";
import test from "node:test";

import {
  GestureLeaseRegistry,
  isGestureId,
} from "../../../dist/annotation/gesture-leases.js";

test("gesture leases reject stale commits after cancellation or replacement", () => {
  const leases = new GestureLeaseRegistry();
  assert.equal(leases.begin(10, "gesture_0001"), null);
  assert.equal(leases.matches(10, "gesture_0001"), true);
  assert.equal(leases.begin(10, "gesture_0002"), "gesture_0001");
  assert.equal(leases.matches(10, "gesture_0001"), false);
  assert.equal(leases.matches(10, "gesture_0002"), true);

  assert.deepEqual(leases.cancelAll(), [
    { ownerId: 10, gestureId: "gesture_0002" },
  ]);
  assert.equal(leases.matches(10, "gesture_0002"), false);
});

test("ending a gesture only removes the matching lease", () => {
  const leases = new GestureLeaseRegistry();
  leases.begin(10, "gesture_0001");
  assert.equal(leases.end(10, "gesture_other"), false);
  assert.equal(leases.size, 1);
  assert.equal(leases.end(10, "gesture_0001"), true);
  assert.equal(leases.size, 0);
});

test("gesture id validation is bounded and character-safe", () => {
  assert.equal(isGestureId("gesture_0001"), true);
  assert.equal(isGestureId("short"), false);
  assert.equal(isGestureId("gesture with spaces"), false);
  assert.equal(isGestureId("x".repeat(129)), false);
});
