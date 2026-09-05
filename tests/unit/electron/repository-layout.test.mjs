import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
async function sourceFiles(relative) {
  const dir = new URL(relative, root);
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = relative + entry.name;
    if (entry.isDirectory()) return sourceFiles(path + "/");
    return /\.(?:ts|tsx|cts)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("source root is organized by runtime responsibility", async () => {
  assert.deepEqual((await readdir(new URL("src/", root))).sort(), ["annotation", "electron", "renderer", "shared"]);
});

test("renderer imports shared contracts instead of Electron implementations", async () => {
  for (const path of await sourceFiles("src/renderer/")) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:@\/electron\/|\.\.\/electron\/)/, path);
    assert.doesNotMatch(source, /from\s+["'](?:electron|node:[^"']+)["']/, path);
  }
});

test("shared modules do not depend on desktop or UI implementations", async () => {
  for (const path of await sourceFiles("src/shared/")) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /from\s+["'](?:electron|node:[^"']+|react)["']/, path);
    assert.doesNotMatch(source, /from\s+["'][^"']*\/(?:electron|renderer)\//, path);
  }
});
