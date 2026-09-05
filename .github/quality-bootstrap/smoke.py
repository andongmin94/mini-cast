from pathlib import Path
import textwrap

# Assemble against the already-read baseline, with exact-match assertions.
# This bootstrap is deleted from the branch after it creates the real source files.
runtime = Path('.github/quality-bootstrap/runtime.py').read_text(encoding='utf-8')
left = runtime.index("edit('src/annotation/gesture-leases.ts'")
right = runtime.index('\nreplace_block(main,', left)
runtime = runtime[:left] + runtime[right:]
runtime = runtime.replace('gestureLeases.hasActive', 'gestureLeases.size > 0')
left = runtime.index("window = 'src/electron/window.ts'")
runtime = runtime[:left] + '''window = 'src/electron/window.ts'
edit(window, '\\n      webviewTag: false,', '\\n      webviewTag: false,\\n      devTools: !app.isPackaged,')
edit(window, '\\n          webviewTag: false,', '\\n          webviewTag: false,\\n          devTools: !app.isPackaged,\\n          backgroundThrottling: false,')
'''
exec(compile(runtime, 'runtime.py', 'exec'))

smoke = 'src/electron/smoke.ts'
edit(smoke, '  sentinelPath: string | null;', '  sentinelPath: string | null;\n  userDataPath: string | null;')
edit(smoke, '    mode,\n    sentinelPath:', '''    mode,
    userDataPath: argv.find((argument) => argument.startsWith("--smoke-user-data="))?.slice("--smoke-user-data=".length) ?? null,
    sentinelPath:''')
p = Path('tests/smoke-options.test.mjs')
s = p.read_text(encoding='utf-8')
s = s.replace('    mode: "startup",', '    mode: "startup",\n    userDataPath: null,').replace('      mode: "interaction",', '      mode: "interaction",\n      userDataPath: null,')
p.write_text(s, encoding='utf-8')

p = Path(smoke)
p.write_text(p.read_text(encoding='utf-8') + r'''

export function shortcutVirtualKeys(accelerator: string): number[] {
  const special: Record<string, number> = {
    Alt: 0x12, Shift: 0x10, Control: 0x11, Ctrl: 0x11,
    CommandOrControl: 0x11, Escape: 0x1b,
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
  const press = keys.map((key) => `[MiniCastKeyboard]::Key(${key}, $false)`).join("\n");
  const release = [...keys].reverse().map((key) => `[MiniCastKeyboard]::Key(${key}, $true)`).join("\n");
  return runPowerShell(`${KEY_NATIVE_DECLARATION}\ntry {\n${press}\nStart-Sleep -Milliseconds 80\n} finally {\n${release}\n}`);
}

export function injectWindowsMouseButton(x: number, y: number, pressed: boolean) {
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
''', encoding='utf-8')

# Smoke runs use isolated preferences, but the same tray, shortcuts and quit path.
main = 'src/electron/main.ts'
edit(main, 'const smokeOptions = readSmokeOptions(process.argv);', '''const smokeOptions = readSmokeOptions(process.argv);
if (smokeOptions.mode) {
  const directory = smokeOptions.userDataPath ?? mkdtempSync(path.join(tmpdir(), "mini-cast-smoke-"));
  if (!path.isAbsolute(directory)) throw new Error("Smoke userData must be an absolute isolated path");
  app.setPath("userData", directory);
}''')
edit(main, '  if (!smokeOptions.mode) refreshTransientAnnotationShortcuts();', '  refreshTransientAnnotationShortcuts();')
edit(main, '  if (!smokeOptions.mode) createSplash();', '  createSplash();')
edit(main, '''  if (smokeOptions.mode) {
    await runSmokeTest();
    return;
  }

  registerAnnotationHotkeys();
  createTray();
  ensureMainWindowVisible();

  if (app.isPackaged) Menu.setApplicationMenu(null);''', '''  registerAnnotationHotkeys();
  createTray();
  ensureMainWindowVisible();
  if (app.isPackaged) Menu.setApplicationMenu(null);

  if (smokeOptions.mode) await runSmokeTest();''')

# Extract the integration harness rather than growing the application entry point.
p = Path(main)
s = p.read_text(encoding='utf-8')
left = s.index('interface SmokeState {')
right = s.index('async function runSmokeTest()', left)
checks = s[left:right]
s = s[:left] + s[right:]
p.write_text(s, encoding='utf-8')
checks = checks.replace('annotationTool ===', 'context.state().tool ===').replace('annotationTool !==', 'context.state().tool !==')
checks = checks.replace('setAnnotationTool(', 'await selectTool(')
checks = checks.replace('sendAnnotationCommand(', 'await shortcutCommand(')
checks = checks.replace('''    if (!displayRefreshExecutor) {
      throw new Error("display refresh executor was not initialized");
    }
    await Promise.all([
      displayRefreshExecutor.request(),
      displayRefreshExecutor.request(),
    ]);''', '''    await Promise.all([context.refreshDisplays(), context.refreshDisplays()]);''')
assert 'displayRefreshExecutor' not in checks
checks = checks.replace('  await inspectAllRenderers();\n  await verifyControllerAnnotationToolWiring();', '''  await inspectAllRenderers();
  await verifySettingsFailureAndRetry();
  await verifyControllerAnnotationToolWiring();''')

# The highlighter must paint its own blank region; pre-existing pen pixels cannot pass it.
checks = checks.replace('''    await waitForCommittedCanvasInk(primary.id, true, "visible highlighter pixels");''', '''    const highlightPoint = {
      x: (highlighterStart.x + highlighterEnd.x) / 2 - primary.bounds.x,
      y: highlighterStart.y - primary.bounds.y,
    };
    await waitFor(async () => {
      const alpha = await canvasAlphaAt(primary.id, highlightPoint.x, highlightPoint.y);
      return alpha >= 80 && alpha <= 100;
    }, 5_000, "independent highlighter alpha (approximately 0.35)");''')
checks = checks.replace('''    const persisted = annotationHistory.getSnapshot(primary.id);''', '''    await waitFor(async () => (await canvasAlphaAt(primary.id, highlightPoint.x, highlightPoint.y)) === 0, 5_000, "highlighter-only region cleared by Undo");
    await shortcutCommand("redo");
    await waitFor(async () => (await canvasAlphaAt(primary.id, highlightPoint.x, highlightPoint.y)) >= 80, 5_000, "highlighter-only region restored by Redo");
    await shortcutCommand("undo");
    await waitFor(async () => (await canvasAlphaAt(primary.id, highlightPoint.x, highlightPoint.y)) === 0, 5_000, "highlighter-only region cleared again");

    const persisted = annotationHistory.getSnapshot(primary.id);''')

old = '''    await waitForCommittedCanvasInk(
      primary.id,
      true,
      "visual annotation restoration after overlay rebuild",
    );'''
assert checks.count(old) == 1
checks = checks.replace(old, old + '''

    const loaded = new Promise<void>((resolve) => rebuiltOverlay.webContents.once("did-finish-load", () => resolve()));
    rebuiltOverlay.webContents.reload();
    await loaded;
    await waitFor(async () => {
      const restored = await rebuiltOverlay.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('[data-mini-cast-overlay]');
        return root && Number(root.dataset.annotationRevision) === ${persisted.revision}
          && Number(root.dataset.annotationStrokes) === ${persisted.strokes.length};
      })()`);
      return Boolean(restored);
    }, 5_000, "real renderer reload restores the document revision and strokes");
    await waitForCommittedCanvasInk(primary.id, true, "real renderer reload restores Canvas pixels");

    const beforeCancellation = annotationHistory.getSnapshot(primary.id);
    await selectTool("pen");
    await waitForOverlayInput(primary.id, true);
    try {
      await injectWindowsMouseButton(start.x, start.y, true);
      await injectWindowsMouseMove(end.x, end.y);
      await waitFor(async () => Boolean(await rebuiltOverlay.webContents.executeJavaScript("document.querySelector('[data-active-gesture]')")), 5_000, "held pointer gesture starts");
      await shortcutCommand("undo");
      await waitFor(async () => !(await rebuiltOverlay.webContents.executeJavaScript("Boolean(document.querySelector('[data-active-gesture]'))")), 5_000, "Ctrl+Z cancels the held gesture");
      if (annotationHistory.getSnapshot(primary.id).revision !== beforeCancellation.revision) throw new Error("Undo of an active gesture modified committed history");
    } finally {
      await injectWindowsMouseButton(end.x, end.y, false);
    }

    await selectTool("pen");
    try {
      await injectWindowsMouseButton(start.x, start.y, true);
      await injectWindowsMouseMove(end.x, end.y);
      await injectWindowsShortcut("Escape");
      await waitFor(() => context.state().tool === "pass-through", 5_000, "native Escape while dragging");
      await waitForOverlayInput(primary.id, false);
    } finally {
      await injectWindowsMouseButton(end.x, end.y, false);
    }
    if (annotationHistory.getSnapshot(primary.id).revision !== beforeCancellation.revision) throw new Error("Escape committed an unfinished stroke");
    await injectWindowsClick(end.x, end.y);
    await waitFor(() => clickCount === 2, 5_000, "click-through after held-pointer Escape");
    await selectTool("pen");
    await waitForOverlayInput(primary.id, true);
''')
checks = checks.replace('await waitFor(() => clickCount === 2, 5_000, "restored click-through");', 'await waitFor(() => clickCount === 3, 5_000, "restored click-through");\n    diagnostics.stress = await measureAnnotationPipeline(primary.id, start, end);')
# executeJavaScript must return serializable primitives, not DOM elements.
checks = checks.replace('executeJavaScript("document.querySelector(\'[data-active-gesture]\')")', 'executeJavaScript("Boolean(document.querySelector(\'[data-active-gesture]\'))")')

header = '''import { app, BrowserWindow, screen, type WebContents } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { AnnotationHistory } from "../annotation/history.js";
import type { AnnotationCommand, AnnotationState, AnnotationTool } from "./contract.js";
import type { SettingsWriteState } from "./settings-writer.js";
import { ACTIVE_COMMAND_SHORTCUTS, TOOL_SHORTCUTS } from "./annotation-shortcuts.js";
import { injectWindowsClick, injectWindowsDrag, injectWindowsShortcut, injectWindowsMouseButton, injectWindowsMouseMove, waitFor } from "./smoke.js";
import { hideMainWindow, mainWindow, overlayDisplays, overlayWindows, showMainWindow } from "./window.js";

export interface SmokeContext {
  history: AnnotationHistory;
  state(): AnnotationState;
  refreshDisplays(): Promise<void>;
  publishDocument(displayId: number): void;
  settingsPath: string;
  settingsState(): SettingsWriteState;
}

/** Test orchestration uses production services only for fixtures and observations. */
export function createSmokeChecks(context: SmokeContext) {
  const annotationHistory = context.history;
  const diagnostics: Record<string, unknown> = {};

  async function selectTool(tool: AnnotationTool) {
    const binding = TOOL_SHORTCUTS.find((item) => item.tool === tool);
    if (!binding) throw new Error(`No accelerator for ${tool}`);
    await injectWindowsShortcut(binding.accelerator);
    await waitFor(() => context.state().tool === tool, 5_000, `native tool shortcut ${binding.accelerator}`);
  }

  async function shortcutCommand(command: AnnotationCommand) {
    const binding = ACTIVE_COMMAND_SHORTCUTS.find((item) => item.command === command);
    if (!binding) throw new Error(`No accelerator for ${command}`);
    await injectWindowsShortcut(binding.accelerator);
  }

  async function canvasAlphaAt(displayId: number, x: number, y: number) {
    const target = overlayWindows[overlayDisplays.findIndex((item) => item.id === displayId)];
    if (!target) throw new Error("Missing annotation surface");
    return await target.webContents.executeJavaScript(`(() => {
      const canvas = document.querySelector('canvas');
      const context = canvas?.getContext('2d', { willReadFrequently: true });
      if (!canvas || !context) return -1;
      const x = Math.round(${x} * canvas.width / canvas.clientWidth);
      const y = Math.round(${y} * canvas.height / canvas.clientHeight);
      return context.getImageData(x, y, 1, 1).data[3];
    })()`) as number;
  }

  async function verifySettingsFailureAndRetry() {
    const controller = mainWindow;
    if (!controller) throw new Error("Missing controller");
    const file = context.settingsPath;
    const backup = file + ".smoke-backup";
    await waitFor(() => context.settingsState() !== "pending", 5_000, "initial preference write");
    if (!existsSync(file)) throw new Error("The isolated settings file was not created");
    renameSync(file, backup);
    mkdirSync(file);
    try {
      await controller.webContents.executeJavaScript(`(async () => {
        const settings = await miniCast.getSettings();
        miniCast.saveSettings({ ...settings, cursorSize: 36 });
      })()`);
      await waitFor(() => context.settingsState() === "failed", 5_000, "actual filesystem write failure is contained");
      await waitFor(async () => Boolean(await controller.webContents.executeJavaScript("Boolean(document.querySelector('[data-settings-status=failed]'))")), 5_000, "settings failure notice reaches the controller");
    } finally {
      rmdirSync(file);
      renameSync(backup, file);
    }
    await clickControllerElement(controller, '[data-settings-retry]', "explicit settings Retry button");
    await waitFor(() => context.settingsState() === "saved", 5_000, "settings Retry writes the retained value");
    const persisted = JSON.parse(readFileSync(file, "utf8"));
    if (persisted.settings.cursorSize !== 36) throw new Error("Retry did not persist the latest preferences");
    diagnostics.settingsFailureAndRetry = true;
  }

  async function measureAnnotationPipeline(displayId: number, start: { x: number; y: number }, end: { x: number; y: number }) {
    const viewport = annotationHistory.getSnapshot(displayId).viewport;
    if (!viewport) throw new Error("Missing benchmark viewport");
    const beforePixels = await committedCanvasInkPixels(displayId);
    const begin = performance.now();
    for (let index = 0; index < 1000; index += 1) {
      annotationHistory.addStroke(displayId, {
        id: `stress-${index}`, tool: "pen", color: "#007AFF", width: 1, opacity: 1,
        points: Array.from({ length: 128 }, (_, point) => ({
          x: ((index % 40) + 0.1 + point / 127 * 0.8) / 40 * Math.min(viewport.width, 800),
          y: (Math.floor(index / 40) + 0.5) / 25 * Math.min(viewport.height, 500),
        })),
      });
    }
    const fixtureMs = performance.now() - begin;
    const snapshotStart = performance.now();
    const snapshot = annotationHistory.getSnapshot(displayId);
    const snapshotMs = performance.now() - snapshotStart;
    const serializeStart = performance.now();
    const bytes = Buffer.byteLength(JSON.stringify(snapshot));
    const serializeMs = performance.now() - serializeStart;
    const publishStart = performance.now();
    context.publishDocument(displayId);
    const target = overlayWindows[overlayDisplays.findIndex((item) => item.id === displayId)];
    if (!target) throw new Error("Missing benchmark renderer");
    await waitFor(async () => Number(await target.webContents.executeJavaScript("document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationStrokes")) === snapshot.strokes.length, 10_000, "128k-point snapshot reaches the renderer");
    await waitFor(async () => (await committedCanvasInkPixels(displayId)) > beforePixels + 500, 10_000, "large fixture actually paints additional Canvas pixels");
    const publishAndPaintMs = performance.now() - publishStart;
    await selectTool("pen");
    await waitForOverlayInput(displayId, true);
    const dragStart = performance.now();
    await injectWindowsDrag(start.x, start.y, end.x, end.y);
    await waitFor(() => annotationHistory.getSnapshot(displayId).strokes.length === snapshot.strokes.length + 1, 10_000, "native drawing still commits over a 128k-point document");
    const nativeDragIncludingInjectionMs = performance.now() - dragStart;
    await shortcutCommand("undo");
    await waitFor(() => annotationHistory.getSnapshot(displayId).strokes.length === snapshot.strokes.length, 10_000, "native Undo on the large document");
    const metrics = { fixtureStrokes: 1000, fixturePoints: 128000, snapshotBytes: bytes, fixtureMs, snapshotMs, serializeMs, publishAndPaintMs, nativeDragIncludingInjectionMs, mainMemory: process.memoryUsage(), processes: app.getAppMetrics().map(({ type, memory }) => ({ type, memory })) };
    console.log("MiniCast bounded stress diagnostics:", JSON.stringify(metrics));
    return metrics;
  }

'''
footer = '\n  return { inspectAllRenderers, performInteractionSmoke, diagnostics };\n}\n'
Path('src/electron/interaction-smoke.ts').write_text(header + textwrap.indent(checks, '  ') + footer, encoding='utf-8')

# main only initiates the harness; the integration scenarios are not embedded in it.
edit(main, '  BrowserWindow,\n', '')
edit(main, '''  injectWindowsClick,
  injectWindowsDrag,
''', '')
edit(main, '  waitFor,\n', '')
edit(main, 'import { createTray, destroyTray }', 'import { createSmokeChecks } from "./interaction-smoke.js";\nimport { createTray, destroyTray, isTrayReady }')
edit('src/electron/tray.ts', 'export function destroyTray()', '''export function isTrayReady() {
  return tray !== null && !tray.isDestroyed();
}

export function destroyTray()''')
edit(main, '  const test = mode === "interaction" ? performInteractionSmoke() : inspectAllRenderers();', '''  if (!isTrayReady()) throw new Error("Production tray was not created");
  if (unavailableShortcuts.size) throw new Error(`Unavailable production shortcuts: ${[...unavailableShortcuts].join(", ")}`);
  const checks = createSmokeChecks({
    history: annotationHistory,
    state: getAnnotationState,
    refreshDisplays: () => {
      if (!displayRefreshExecutor) throw new Error("Display executor is unavailable");
      return displayRefreshExecutor.request();
    },
    publishDocument: sendAnnotationDocument,
    settingsPath,
    settingsState: () => settingsWriter?.state ?? "failed",
  });
  const test = mode === "interaction" ? checks.performInteractionSmoke() : checks.inspectAllRenderers();''')
edit(main, 'const timeoutMs = mode === "interaction" ? 60_000 : 30_000;', 'const timeoutMs = mode === "interaction" ? 180_000 : 30_000;')
# Do not leave the losing Promise.race timeout armed on a successful test.
edit(main, '  await Promise.race([\n    test,', '  let watchdog: ReturnType<typeof setTimeout> | undefined;\n  try {\n    await Promise.race([\n    test,')
edit(main, '      setTimeout(() => reject(new Error("smoke test timed out")), timeoutMs);', '      watchdog = setTimeout(() => reject(new Error("smoke test timed out")), timeoutMs);')
edit(main, '  ]);\n\n  await writeSmokeSentinel', '    ]);\n  } finally {\n    if (watchdog) clearTimeout(watchdog);\n  }\n\n  await writeSmokeSentinel')
edit(main, '    gpuFeatureStatus: app.getGPUFeatureStatus(),', '''    gpuFeatureStatus: app.getGPUFeatureStatus(),
    settingsRecovered,
    expectedQuitCursorSize: 37,
    trayCreated: isTrayReady(),
    diagnostics: checks.diagnostics,''')
edit(main, '''  stopDisplayRefresh();
  prepareWindowsForQuit();
  stopInputCapture();
  app.exit(0);''', '''  // Queue a final preference after the sentinel write, then quit normally before
  // the debounce elapses. The parent process checks the persisted value.
  currentSettings = { ...currentSettings, cursorSize: 37 };
  scheduleSettingsPersist();
  app.quit();''')

# Give the external verifier an isolated directory for every process invocation,
# retain its diagnostics, and verify the real before-quit preference flush.
verify = 'scripts/verify-windows.ps1'
edit(verify, '    [switch]$DisableHardwareAcceleration\n', '    [switch]$DisableHardwareAcceleration,\n    [switch]$CorruptSettings\n')
edit(verify, '  $arguments = @($modeArgument, "--smoke-sentinel=$sentinel")', '''  $userData = Join-Path $env:RUNNER_TEMP ("mini-cast-userdata-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $userData | Out-Null
  if ($CorruptSettings) {
    Set-Content -LiteralPath (Join-Path $userData 'config.json') -Value '{broken-json' -Encoding utf8
  }
  $arguments = @($modeArgument, "`"--smoke-sentinel=$sentinel`"", "`"--smoke-user-data=$userData`"")''')
edit(verify, '''    if ($launcher.ExitCode -ne 0) {
      throw "$Label launcher exited with code $($launcher.ExitCode)."
    }''', '''    if ($launcher.ExitCode -ne 0) {
      throw "$Label launcher exited with code $($launcher.ExitCode)."
    }
    if (-not $payload.trayCreated) { throw "$Label skipped the production tray." }
    if ([bool]$payload.settingsRecovered -ne [bool]$CorruptSettings) {
      throw "$Label did not handle its settings fixture as expected."
    }
    $saved = Get-Content -LiteralPath (Join-Path $userData 'config.json') -Raw | ConvertFrom-Json
    if ($saved.settings.cursorSize -ne $payload.expectedQuitCursorSize) {
      throw "$Label did not flush the final preference on normal quit."
    }
    Write-Host "$Label: normal quit, preferences flush and tray initialization verified."
    Copy-Item -LiteralPath $sentinel -Destination (Join-Path $LogDirectory "$Label-sentinel.json") -Force''')
edit(verify, '''    Remove-Item $sentinel -Force -ErrorAction SilentlyContinue
    Stop-MiniCastProcesses''', '''    if (Test-Path $sentinel) {
      Copy-Item -LiteralPath $sentinel -Destination (Join-Path $LogDirectory "$Label-sentinel.json") -Force
    }
    Remove-Item $sentinel -Force -ErrorAction SilentlyContinue
    Stop-MiniCastProcesses
    Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue''')
# PowerShell requires braces when a colon follows a variable in a string.
edit(verify, 'Write-Host "$Label: normal quit', 'Write-Host "${Label}: normal quit')
edit(verify, "-Label 'unpacked-interaction' -TimeoutSeconds 90", "-Label 'unpacked-interaction' -TimeoutSeconds 210")
edit(verify, "-Label 'unpacked-software-interaction' -TimeoutSeconds 90", "-Label 'unpacked-software-interaction' -TimeoutSeconds 210")
edit(verify, "Write-Host 'Verifying portable launcher startup and complete shutdown...'", '''Write-Host 'Verifying recovery of an actually corrupt settings file...'
Invoke-MiniCastSmoke -Executable $unpackedExecutable -Mode startup -Label 'corrupt-settings-startup' -CorruptSettings
Write-Host 'Verifying portable launcher startup and complete shutdown...' ''')

workflow = '.github/workflows/verify.yml'
edit(workflow, '      - name: 실패 로그 업로드\n        if: failure()', '      - name: 검증 진단 로그 업로드\n        if: always()')
edit(workflow, '          name: mini-cast-verification-logs', '          name: mini-cast-verification-logs')

Path('tests/windows-shortcuts.test.mjs').write_text('''import assert from "node:assert/strict";
import test from "node:test";
import { shortcutVirtualKeys } from "../dist/electron/smoke.js";

test("Windows shortcut injection maps the actual production accelerators", () => {
  assert.deepEqual(shortcutVirtualKeys("Alt+Shift+3"), [0x12, 0x10, 0x33]);
  assert.deepEqual(shortcutVirtualKeys("CommandOrControl+Shift+Z"), [0x11, 0x10, 0x5a]);
  assert.deepEqual(shortcutVirtualKeys("Escape"), [0x1b]);
  assert.throws(() => shortcutVirtualKeys("Alt+not-a-key"), /Unsupported/);
});
''', encoding='utf-8')

readme = Path('README.md')
readme.write_text(readme.read_text(encoding='utf-8') + '''
## 0.3.3 안정화 범위

설정 저장 실패는 판서나 종료 정리를 중단하지 않습니다. 저장하지 못한 최신 값은 메모리에 유지되고 컨트롤러에서 다시 시도할 수 있습니다. 문법적으로 손상된 설정 파일은 `electron-store`의 복구 기능으로 기본값으로 초기화하며 컨트롤러에서 이를 알립니다. 읽기 권한 오류 등 JSON 손상 이외의 시작 오류는 덮어쓰지 않고 시작 오류로 보고합니다.

판서 용량 초과와 일반 취소는 서로 다른 결과로 처리합니다. 새 획을 거부해도 기존 판서를 지우지 않으며, 용량 초과는 화면에 안내합니다. Undo/Redo 버튼은 실제 이력 상태를 반영합니다.

Windows 검증은 정상 실행과 같은 트레이·전역 단축키를 등록합니다. 실제 키 입력으로 도구 전환, Ctrl+Z/Redo와 누른 채 Escape를 검사하며 형광펜은 다른 획과 겹치지 않는 영역의 알파 값을 검사합니다. renderer reload와 오버레이 창 재생성은 각각 별도로 검사합니다. 모든 검증 프로세스는 격리된 설정 디렉터리를 사용하며 `app.quit()`의 정상 종료 및 마지막 설정 저장을 확인합니다.

`src/electron/interaction-smoke.ts`에 통합 검증 시나리오를 분리했습니다. 1,000획·128,000포인트의 fixture에서 snapshot 복제·직렬화·IPC 후 Canvas 표시와 추가 Windows 입력을 계측합니다. 이 수치는 CI의 제한된 부하 측정이며 1시간 실기기 강의나 특정 GPU·펜 드라이버의 보증이 아닙니다. 실행별 측정과 sentinel은 Actions의 `mini-cast-verification-logs`에 보관합니다.
''', encoding='utf-8')

# Source completeness checks for the assembled commit.
main_source = Path(main).read_text(encoding='utf-8')
assert 'async function performInteractionSmoke' not in main_source
assert 'app.exit(0)' not in main_source
assert 'if (!smokeOptions.mode)' not in main_source
assert 'context.state().tool' in Path('src/electron/interaction-smoke.ts').read_text(encoding='utf-8')
print('Assembled failure handling, UI status, native-input/reload/quit tests, and bounded stress diagnostics.')
