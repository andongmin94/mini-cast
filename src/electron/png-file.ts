import path from "node:path";
import { writeFile } from "atomically";

/** Only a native-dialog-selected PNG path reaches this function. */
export async function writePngFile(filePath: string, bytes: Uint8Array) {
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== ".png")
    throw new Error("Export destination must be an absolute PNG path");
  // Reuse the atomic writer already used by electron-store/conf. Its temp file
  // is renamed only after the complete payload is written and fsync has finished.
  await writeFile(filePath, Buffer.from(bytes), { timeout: 1000 });
}
