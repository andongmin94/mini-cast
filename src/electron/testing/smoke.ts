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
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MiniCastMouse {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT bounds);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtr(IntPtr window, int index);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  static string DescribeWindow(IntPtr window) {
    var name = new StringBuilder(256);
    GetClassName(window, name, name.Capacity);
    uint pid; GetWindowThreadProcessId(window, out pid);
    RECT bounds; GetWindowRect(window, out bounds);
    return String.Format("hwnd={0},class={1},pid={2},rect={3}/{4}/{5}/{6},visible={7},enabled={8},exStyle={9:X},dpi={10}",
      window, name, pid, bounds.Left, bounds.Top, bounds.Right, bounds.Bottom,
      IsWindowVisible(window), IsWindowEnabled(window), GetWindowLongPtr(window, -20).ToInt64(), GetDpiForWindow(window));
  }
  public static void WaitForTarget(IntPtr expected, int x, int y) {
    var deadline = DateTime.UtcNow.AddSeconds(5);
    IntPtr actual;
    do {
      actual = GetAncestor(WindowFromPoint(new POINT { X = x, Y = y }), 2);
      if (actual == expected) return;
      System.Threading.Thread.Sleep(50);
    } while (DateTime.UtcNow < deadline);
    throw new InvalidOperationException(String.Format(
      "Native click target mismatch at ({0}, {1}): expected [{2}]; actual [{3}]; foreground [{4}]",
      x, y, DescribeWindow(expected), DescribeWindow(actual), DescribeWindow(GetForegroundWindow())));
  }
}
'@
[MiniCastMouse]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
`;

async function physicalPoint(x: number, y: number) {
  // Electron window/DOM coordinates are DIPs; the native helper uses physical pixels.
  const { screen } = await import("electron");
  return screen.dipToScreenPoint({ x: Math.round(x), y: Math.round(y) });
}

export async function injectWindowsClick(x: number, y: number, targetWindow?: Buffer) {
  const point = await physicalPoint(x, y);
  const script = `${MOUSE_NATIVE_DECLARATION}
${targetWindow ? `[MiniCastMouse]::WaitForTarget([IntPtr]::new(${targetWindow.readBigUInt64LE()}), ${point.x}, ${point.y})` : ""}
[MiniCastMouse]::SetCursorPos(${point.x}, ${point.y}) | Out-Null
Start-Sleep -Milliseconds 100
[MiniCastMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[MiniCastMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`;
  return runPowerShell(script);
}

export async function injectWindowsDrag(
  startX: number, startY: number, endX: number, endY: number,
  modifiers: readonly "Shift"[] = [],
) {
  const { screen } = await import("electron");
  const start = screen.dipToScreenPoint({ x: Math.round(startX), y: Math.round(startY) });
  const steps = 12;
  const movements = Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    const x = Math.round(startX + (endX - startX) * progress);
    const y = Math.round(startY + (endY - startY) * progress);
    const point = screen.dipToScreenPoint({ x, y });
    return `[MiniCastMouse]::SetCursorPos(${point.x}, ${point.y}) | Out-Null\nStart-Sleep -Milliseconds 20`;
  }).join("\n");
  const keys = modifiers.map(key => shortcutVirtualKeys(key)[0]);
  const press = keys.map(key => `[MiniCastKeyboard]::Key(${key}, $false)`).join("\n");
  const release = [...keys].reverse().map(key => `[MiniCastKeyboard]::Key(${key}, $true)`).join("\n");
  return runPowerShell(`${MOUSE_NATIVE_DECLARATION}
${keys.length ? KEY_NATIVE_DECLARATION : ""}
try {
${press}
[MiniCastMouse]::SetCursorPos(${start.x}, ${start.y}) | Out-Null
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
    Right: 0x27,
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

export async function injectWindowsMouseButton(
  x: number,
  y: number,
  pressed: boolean,
) {
  const point = await physicalPoint(x, y);
  return runPowerShell(`${MOUSE_NATIVE_DECLARATION}
[MiniCastMouse]::SetCursorPos(${point.x}, ${point.y}) | Out-Null
Start-Sleep -Milliseconds 60
[MiniCastMouse]::mouse_event(${pressed ? "0x0002" : "0x0004"}, 0, 0, 0, [UIntPtr]::Zero)
`);
}

export async function injectWindowsMouseMove(x: number, y: number) {
  const point = await physicalPoint(x, y);
  return runPowerShell(`${MOUSE_NATIVE_DECLARATION}
[MiniCastMouse]::SetCursorPos(${point.x}, ${point.y}) | Out-Null
Start-Sleep -Milliseconds 60
`);
}
