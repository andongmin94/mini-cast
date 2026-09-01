import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

export type SmokeMode = "startup" | "interaction";

export interface SmokeOptions {
  mode: SmokeMode | null;
  sentinelPath: string | null;
  disableHardwareAcceleration: boolean;
}

export function readSmokeOptions(argv: readonly string[]): SmokeOptions {
  const mode = argv.includes("--interaction-smoke-test")
    ? "interaction"
    : argv.includes("--smoke-test")
      ? "startup"
      : null;
  const sentinel = argv.find((argument) =>
    argument.startsWith("--smoke-sentinel="),
  );
  return {
    mode,
    sentinelPath: sentinel ? sentinel.slice("--smoke-sentinel=".length) : null,
    disableHardwareAcceleration: argv.includes(
      "--disable-hardware-acceleration",
    ),
  };
}

export async function writeSmokeSentinel(
  path: string | null,
  payload: Record<string, unknown>,
) {
  if (!path) return;
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  description: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function runPowerShell(script: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      { windowsHide: true },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`PowerShell input injection failed: ${stderr}`));
    });
  });
}

const MOUSE_NATIVE_DECLARATION = String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MiniCastMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@
`;

export function injectWindowsClick(x: number, y: number) {
  const script = `${MOUSE_NATIVE_DECLARATION}
[MiniCastMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Start-Sleep -Milliseconds 100
[MiniCastMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[MiniCastMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`;
  return runPowerShell(script);
}

export function injectWindowsDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const steps = 12;
  const movements = Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    const x = Math.round(startX + (endX - startX) * progress);
    const y = Math.round(startY + (endY - startY) * progress);
    return `[MiniCastMouse]::SetCursorPos(${x}, ${y}) | Out-Null\nStart-Sleep -Milliseconds 20`;
  }).join("\n");
  const script = `${MOUSE_NATIVE_DECLARATION}
[MiniCastMouse]::SetCursorPos(${Math.round(startX)}, ${Math.round(startY)}) | Out-Null
Start-Sleep -Milliseconds 100
[MiniCastMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
${movements}
[MiniCastMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`;
  return runPowerShell(script);
}
