import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

export type SmokeMode = "startup" | "interaction";

export interface SmokeOptions {
  mode: SmokeMode | null;
  sentinelPath: string | null;
  userDataPath: string | null;
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
    userDataPath:
      argv
        .find((argument) => argument.startsWith("--smoke-user-data="))
        ?.slice("--smoke-user-data=".length) ?? null,
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
  startX: number, startY: number, endX: number, endY: number,
  modifiers: readonly "Shift"[] = [],
) {
  const steps = 12;
  const movements = Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    const x = Math.round(startX + (endX - startX) * progress);
    const y = Math.round(startY + (endY - startY) * progress);
    return `[MiniCastMouse]::SetCursorPos(${x}, ${y}) | Out-Null\nStart-Sleep -Milliseconds 20`;
  }).join("\n");
  const keys = modifiers.map(key => shortcutVirtualKeys(key)[0]);
  const press = keys.map(key => `[MiniCastKeyboard]::Key(${key}, $false)`).join("\n");
  const release = [...keys].reverse().map(key => `[MiniCastKeyboard]::Key(${key}, $true)`).join("\n");
  return runPowerShell(`${MOUSE_NATIVE_DECLARATION}
${keys.length ? KEY_NATIVE_DECLARATION : ""}
try {
${press}
[MiniCastMouse]::SetCursorPos(${Math.round(startX)}, ${Math.round(startY)}) | Out-Null
Start-Sleep -Milliseconds 100
[MiniCastMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
${movements}
} finally {
[MiniCastMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
${release}
}
`);
}

export function shortcutVirtualKeys(accelerator: string): number[] {
  const special: Record<string, number> = {
    Alt: 0x12,
    Shift: 0x10,
    Control: 0x11,
    Ctrl: 0x11,
    CommandOrControl: 0x11,
    Escape: 0x1b,
    Enter: 0x0d,
  };
  return accelerator.split("+").map((part) => {
    if (special[part] !== undefined) return special[part];
    if (/^[a-z0-9]$/i.test(part)) return part.toUpperCase().charCodeAt(0);
    throw new Error(`Unsupported Windows test accelerator: ${accelerator}`);
  });
}

const KEY_NATIVE_DECLARATION = String.raw`
Add-Type @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class MiniCastKeyboard {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort vk, scan; public uint flags, time; public UIntPtr extraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] public struct UNION {
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public KEYBDINPUT keyboard;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type; public UNION data;
  }
  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public static void Key(ushort vk, bool up) {
    var input = new INPUT { type = 1 };
    input.data.keyboard.vk = vk;
    input.data.keyboard.flags = up ? 2u : 0u;
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
      throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
`;

export function injectWindowsShortcut(accelerator: string) {
  const keys = shortcutVirtualKeys(accelerator);
  const press = keys
    .map((key) => `[MiniCastKeyboard]::Key(${key}, $false)`)
    .join("\n");
  const release = [...keys]
    .reverse()
    .map((key) => `[MiniCastKeyboard]::Key(${key}, $true)`)
    .join("\n");
  return runPowerShell(
    `${KEY_NATIVE_DECLARATION}\ntry {\n${press}\nStart-Sleep -Milliseconds 80\n} finally {\n${release}\n}`,
  );
}

export function injectWindowsMouseButton(
  x: number,
  y: number,
  pressed: boolean,
) {
  return runPowerShell(`${MOUSE_NATIVE_DECLARATION}
[MiniCastMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Start-Sleep -Milliseconds 60
[MiniCastMouse]::mouse_event(${pressed ? "0x0002" : "0x0004"}, 0, 0, 0, [UIntPtr]::Zero)
`);
}

export function injectWindowsMouseMove(x: number, y: number) {
  return runPowerShell(`${MOUSE_NATIVE_DECLARATION}
[MiniCastMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Start-Sleep -Milliseconds 60
`);
}
