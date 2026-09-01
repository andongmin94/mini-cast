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
