import path from "node:path";

/** Append the selected format only when the user omitted an extension entirely. */
export function withDefaultExtension(filePath: string, extension: string) {
  return path.extname(filePath) ? filePath : `${filePath}.${extension}`;
}
