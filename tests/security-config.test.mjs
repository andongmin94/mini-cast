import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packaged renderer CSP denies network and embedded content", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /script-src 'self';/);
  assert.match(html, /connect-src 'none';/);
  assert.match(html, /object-src 'none';/);
  assert.match(html, /frame-src 'none'/);
});

test("build uses a pinned patched Electron and never publishes implicitly", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.devDependencies.electron, "44.1.0");
  assert.match(packageJson.scripts.build, /electron-builder --publish never$/);
});

test("verification workflow pins actions and validates the distributable ZIP", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/verify.yml", import.meta.url),
    "utf8",
  );
  const actionRefs = [...workflow.matchAll(/uses: (actions\/[^@\s]+)@([^\s]+)/g)];
  assert.ok(actionRefs.length >= 3);
  actionRefs.forEach(([, action, ref]) => {
    assert.match(ref, /^[0-9a-f]{40}$/, `${action} must be pinned by commit SHA`);
  });
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node-version: 24\.19\.0/);
  assert.match(workflow, /최종 ZIP 무결성 및 내부 해시 대조/);
  assert.match(workflow, /BUNDLE-SHA256\.txt/);
  assert.match(workflow, /MiniCast-\*-windows\.zip/);
});
