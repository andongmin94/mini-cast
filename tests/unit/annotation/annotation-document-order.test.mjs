import assert from "node:assert/strict";
import test from "node:test";

import { shouldAdoptAnnotationDocument } from "../../../dist/annotation/document-order.js";

function document(displayId, revision) {
  return { displayId, revision, viewport: null, elements: [] };
}

test("authoritative document ordering accepts current and newer revisions", () => {
  assert.equal(shouldAdoptAnnotationDocument(10, 4, document(10, 4)), true);
  assert.equal(shouldAdoptAnnotationDocument(10, 4, document(10, 5)), true);
});

test("authoritative document ordering rejects stale and foreign snapshots", () => {
  assert.equal(shouldAdoptAnnotationDocument(10, 4, document(10, 3)), false);
  assert.equal(shouldAdoptAnnotationDocument(10, 4, document(20, 5)), false);
  assert.equal(shouldAdoptAnnotationDocument(null, -1, document(10, 0)), false);
});
