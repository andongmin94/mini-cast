use rdev::{listen, Button, EventType, Key};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicI64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{BOOL, LPARAM, RECT},
    Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW},
    UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_BACK, VK_CONTROL, VK_DOWN, VK_ESCAPE, VK_F1, VK_F10, VK_F11, VK_F12,
        VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_LCONTROL, VK_LEFT, VK_LMENU,
        VK_LSHIFT, VK_LWIN, VK_MENU, VK_RCONTROL, VK_RETURN, VK_RIGHT, VK_RMENU, VK_RSHIFT,
        VK_RWIN, VK_SHIFT, VK_SPACE, VK_TAB, VK_UP,
    },
    UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    },
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    window::Color,
    AppHandle, Emitter, EventTarget, Manager, State, WebviewUrl, WebviewWindowBuilder, Window,
    WindowEvent,
};

const MAIN_LABEL: &str = "main";
const OVERLAY_LABEL_PREFIX: &str = "overlay-";
const STORE_FILE_NAME: &str = "store.json";
const TRAY_SHOW_MENU_ID: &str = "tray_show";
const TRAY_QUIT_MENU_ID: &str = "tray_quit";
const COMBINATION_DEDUP_MS: i64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DisplayInfo {
    id: i64,
    name: String,
    scale_factor: f64,
    bounds: Bounds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlaySettings {
    cursor_fill_color: String,
    cursor_stroke_color: String,
    cursor_size: u32,
    cursor_stroke_size: u32,
    show_cursor_highlight: bool,
    key_display_monitor: u32,
    key_display_duration: u32,
    key_display_font_size: u32,
    key_display_background_color: String,
    key_display_text_color: String,
    key_display_position: String,
    show_key_display: bool,
}

impl Default for OverlaySettings {
    fn default() -> Self {
        Self {
            cursor_fill_color: "rgba(0, 100, 255, 0.5)".to_string(),
            cursor_stroke_color: "rgba(32, 38, 50, 0.5)".to_string(),
            cursor_size: 30,
            cursor_stroke_size: 3,
            show_cursor_highlight: true,
            key_display_monitor: 0,
            key_display_duration: 2000,
            key_display_font_size: 16,
            key_display_background_color: "rgba(0, 0, 0, 0.5)".to_string(),
            key_display_text_color: "#FFFFFF".to_string(),
            key_display_position: "bottom-right".to_string(),
            show_key_display: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayInitPayload {
    id: usize,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MousePositionPayload {
    x: i32,
    y: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyPressPayload {
    key: String,
    code: String,
    ctrl_key: bool,
    shift_key: bool,
    alt_key: bool,
    meta_key: bool,
    timestamp: i64,
    display_id: usize,
    combination: String,
}

#[derive(Debug, Clone)]
struct KeyInput {
    key: String,
    code: String,
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    install_mode: String,
    platform: String,
    arch: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct PersistedStore {
    values: HashMap<String, Value>,
}

#[derive(Debug, Default)]
struct InputTracker {
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
    last_combination: String,
    last_timestamp_ms: i64,
}

struct AppState {
    store: Mutex<PersistedStore>,
    settings: Mutex<OverlaySettings>,
    displays: Mutex<Vec<DisplayInfo>>,
    input_tracker: Mutex<InputTracker>,
    last_rdev_key_event_ms: AtomicI64,
    is_quitting: Mutex<bool>,
    tray: Mutex<Option<TrayIcon>>,
    input_started: AtomicBool,
}

fn overlay_label(index: usize) -> String {
    format!("{OVERLAY_LABEL_PREFIX}{index}")
}

fn parse_overlay_index(label: &str) -> Option<usize> {
    label
        .strip_prefix(OVERLAY_LABEL_PREFIX)
        .and_then(|value| value.parse::<usize>().ok())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn store_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?;

    fs::create_dir_all(&dir)
        .map_err(|err| format!("failed to create app data directory: {err}"))?;

    dir.push(STORE_FILE_NAME);
    Ok(dir)
}

fn load_store_from_disk(app: &AppHandle) -> PersistedStore {
    let Ok(path) = store_file_path(app) else {
        return PersistedStore::default();
    };

    let Ok(raw) = fs::read_to_string(path) else {
        return PersistedStore::default();
    };

    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_store_to_disk(app: &AppHandle, store: &PersistedStore) -> Result<(), String> {
    let path = store_file_path(app)?;
    let payload = serde_json::to_string_pretty(store)
        .map_err(|err| format!("failed to serialize store: {err}"))?;

    fs::write(path, payload).map_err(|err| format!("failed to write store: {err}"))
}

fn get_store_value(state: &AppState, key: &str) -> Result<Option<Value>, String> {
    let guard = state
        .store
        .lock()
        .map_err(|_| "failed to lock application store".to_string())?;

    Ok(guard.values.get(key).cloned())
}

fn set_store_value(
    app: &AppHandle,
    state: &AppState,
    key: &str,
    value: Value,
) -> Result<(), String> {
    let snapshot = {
        let mut guard = state
            .store
            .lock()
            .map_err(|_| "failed to lock application store".to_string())?;
        guard.values.insert(key.to_string(), value);
        guard.clone()
    };

    save_store_to_disk(app, &snapshot)
}

fn load_settings_from_store(store: &PersistedStore) -> OverlaySettings {
    store
        .values
        .get("settings")
        .cloned()
        .and_then(|payload| serde_json::from_value(payload).ok())
        .unwrap_or_default()
}

fn parse_windows_display_index(raw: Option<&str>) -> Option<u32> {
    let name = raw?.trim();
    if name.is_empty() {
        return None;
    }

    let normalized = name.to_ascii_uppercase();
    let marker_position = normalized.rfind("DISPLAY")?;
    let suffix = &normalized[marker_position + "DISPLAY".len()..];

    let first_digit_offset = suffix
        .char_indices()
        .find_map(|(index, char)| char.is_ascii_digit().then_some(index))?;

    let digits = suffix[first_digit_offset..]
        .chars()
        .take_while(|char| char.is_ascii_digit())
        .collect::<String>();

    if digits.is_empty() {
        None
    } else {
        digits.parse::<u32>().ok()
    }
}

#[cfg(target_os = "windows")]
fn windows_display_indices_by_bounds() -> HashMap<Bounds, u32> {
    unsafe extern "system" fn enum_monitor(
        monitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let entries = unsafe { &mut *(lparam as *mut Vec<(Bounds, u32)>) };

        let mut info = unsafe { std::mem::zeroed::<MONITORINFOEXW>() };
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;

        if unsafe { GetMonitorInfoW(monitor, &mut info.monitorInfo as *mut _) } == 0 {
            return 1;
        }

        let device_name_end = info
            .szDevice
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(info.szDevice.len());
        let device_name = String::from_utf16_lossy(&info.szDevice[..device_name_end]);

        if let Some(display_index) = parse_windows_display_index(Some(device_name.as_str())) {
            let rect = info.monitorInfo.rcMonitor;
            entries.push((
                Bounds {
                    x: rect.left,
                    y: rect.top,
                    width: (rect.right - rect.left).max(0) as u32,
                    height: (rect.bottom - rect.top).max(0) as u32,
                },
                display_index,
            ));
        }

        1
    }

    let mut entries = Vec::<(Bounds, u32)>::new();
    let entries_ptr = &mut entries as *mut Vec<(Bounds, u32)>;
    unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(enum_monitor),
            entries_ptr as LPARAM,
        );
    }

    let mut mapping = HashMap::<Bounds, u32>::new();
    for (bounds, display_index) in entries {
        mapping.entry(bounds).or_insert(display_index);
    }
    mapping
}

#[cfg(not(target_os = "windows"))]
fn windows_display_indices_by_bounds() -> HashMap<Bounds, u32> {
    HashMap::new()
}

fn monitor_display_name(display_index: u32) -> String {
    format!("Monitor {}", display_index)
}

#[cfg(target_os = "windows")]
fn force_window_topmost(window: &tauri::WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = SetWindowPos(
                hwnd.0 as _,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn force_window_topmost(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn is_virtual_key_down(virtual_key: i32) -> bool {
    unsafe { ((GetAsyncKeyState(virtual_key) as u16) & 0x8000) != 0 }
}

#[cfg(target_os = "windows")]
fn fallback_modifier_snapshot() -> (bool, bool, bool, bool) {
    let ctrl = is_virtual_key_down(VK_CONTROL as i32)
        || is_virtual_key_down(VK_LCONTROL as i32)
        || is_virtual_key_down(VK_RCONTROL as i32);
    let shift = is_virtual_key_down(VK_SHIFT as i32)
        || is_virtual_key_down(VK_LSHIFT as i32)
        || is_virtual_key_down(VK_RSHIFT as i32);
    let alt = is_virtual_key_down(VK_MENU as i32)
        || is_virtual_key_down(VK_LMENU as i32)
        || is_virtual_key_down(VK_RMENU as i32);
    let meta = is_virtual_key_down(VK_LWIN as i32) || is_virtual_key_down(VK_RWIN as i32);
    (ctrl, shift, alt, meta)
}

#[cfg(target_os = "windows")]
fn fallback_polled_keys() -> &'static [(i32, &'static str, &'static str)] {
    &[
        (0x30, "0", "Digit0"),
        (0x31, "1", "Digit1"),
        (0x32, "2", "Digit2"),
        (0x33, "3", "Digit3"),
        (0x34, "4", "Digit4"),
        (0x35, "5", "Digit5"),
        (0x36, "6", "Digit6"),
        (0x37, "7", "Digit7"),
        (0x38, "8", "Digit8"),
        (0x39, "9", "Digit9"),
        (0x41, "A", "KeyA"),
        (0x42, "B", "KeyB"),
        (0x43, "C", "KeyC"),
        (0x44, "D", "KeyD"),
        (0x45, "E", "KeyE"),
        (0x46, "F", "KeyF"),
        (0x47, "G", "KeyG"),
        (0x48, "H", "KeyH"),
        (0x49, "I", "KeyI"),
        (0x4A, "J", "KeyJ"),
        (0x4B, "K", "KeyK"),
        (0x4C, "L", "KeyL"),
        (0x4D, "M", "KeyM"),
        (0x4E, "N", "KeyN"),
        (0x4F, "O", "KeyO"),
        (0x50, "P", "KeyP"),
        (0x51, "Q", "KeyQ"),
        (0x52, "R", "KeyR"),
        (0x53, "S", "KeyS"),
        (0x54, "T", "KeyT"),
        (0x55, "U", "KeyU"),
        (0x56, "V", "KeyV"),
        (0x57, "W", "KeyW"),
        (0x58, "X", "KeyX"),
        (0x59, "Y", "KeyY"),
        (0x5A, "Z", "KeyZ"),
        (VK_SPACE as i32, "Space", "Space"),
        (VK_TAB as i32, "Tab", "Tab"),
        (VK_RETURN as i32, "Enter", "Enter"),
        (VK_BACK as i32, "Backspace", "Backspace"),
        (VK_ESCAPE as i32, "Esc", "Escape"),
        (VK_LEFT as i32, "Left", "ArrowLeft"),
        (VK_RIGHT as i32, "Right", "ArrowRight"),
        (VK_UP as i32, "Up", "ArrowUp"),
        (VK_DOWN as i32, "Down", "ArrowDown"),
        (VK_F1 as i32, "F1", "F1"),
        (VK_F2 as i32, "F2", "F2"),
        (VK_F3 as i32, "F3", "F3"),
        (VK_F4 as i32, "F4", "F4"),
        (VK_F5 as i32, "F5", "F5"),
        (VK_F6 as i32, "F6", "F6"),
        (VK_F7 as i32, "F7", "F7"),
        (VK_F8 as i32, "F8", "F8"),
        (VK_F9 as i32, "F9", "F9"),
        (VK_F10 as i32, "F10", "F10"),
        (VK_F11 as i32, "F11", "F11"),
        (VK_F12 as i32, "F12", "F12"),
    ]
}

#[cfg(target_os = "windows")]
fn start_windows_key_fallback_worker(app: &AppHandle) {
    let app_for_poll = app.clone();
    thread::spawn(move || {
        let mut previous_down = HashSet::<i32>::new();
        let keys = fallback_polled_keys();
        let poll_interval = Duration::from_millis(4);
        let emit_silence_threshold_ms = 120;

        loop {
            let Some(state) = app_for_poll.try_state::<AppState>() else {
                thread::sleep(poll_interval);
                continue;
            };

            let now = now_ms();
            let last_emit_ms = state.last_rdev_key_event_ms.load(Ordering::Relaxed);
            if now - last_emit_ms < emit_silence_threshold_ms {
                previous_down.clear();
                thread::sleep(poll_interval);
                continue;
            }

            let mut current_down = HashSet::<i32>::new();
            for (virtual_key, key_name, key_code) in keys.iter().copied() {
                if !is_virtual_key_down(virtual_key) {
                    continue;
                }

                current_down.insert(virtual_key);
                if previous_down.contains(&virtual_key) {
                    continue;
                }

                let (ctrl, shift, alt, meta) = fallback_modifier_snapshot();
                emit_key_press_if_allowed(
                    &app_for_poll,
                    state.inner(),
                    KeyInput {
                        key: key_name.to_string(),
                        code: key_code.to_string(),
                        ctrl,
                        shift,
                        alt,
                        meta,
                    },
                );
            }

            previous_down = current_down;
            thread::sleep(poll_interval);
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn start_windows_key_fallback_worker(_app: &AppHandle) {}

fn fetch_displays(app: &AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|err| format!("failed to read display list: {err}"))?;
    let primary_bounds = app.primary_monitor().ok().flatten().map(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        Bounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }
    });
    let windows_indices_by_bounds = windows_display_indices_by_bounds();
    let windows_indices_by_origin = windows_indices_by_bounds
        .iter()
        .map(|(bounds, index)| ((bounds.x, bounds.y), *index))
        .collect::<HashMap<_, _>>();

    struct DisplayCandidate {
        windows_display_index: Option<u32>,
        assigned_display_index: Option<u32>,
        is_primary: bool,
        scale_factor: f64,
        bounds: Bounds,
    }

    let mut candidates = monitors
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let raw_name = monitor.name().cloned();
            let bounds = Bounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            };
            let windows_display_index = windows_indices_by_bounds
                .get(&bounds)
                .copied()
                .or_else(|| windows_indices_by_origin.get(&(bounds.x, bounds.y)).copied())
                .or_else(|| {
                    windows_indices_by_origin
                        .iter()
                        .find_map(|((origin_x, origin_y), value)| {
                            ((bounds.x - *origin_x).abs() <= 4 && (bounds.y - *origin_y).abs() <= 4)
                                .then_some(*value)
                        })
                })
                .or_else(|| parse_windows_display_index(raw_name.as_deref()));

            DisplayCandidate {
                windows_display_index,
                assigned_display_index: None,
                is_primary: primary_bounds
                    .as_ref()
                    .map(|primary| *primary == bounds)
                    .unwrap_or(false),
                scale_factor: monitor.scale_factor(),
                bounds,
            }
        })
        .collect::<Vec<_>>();

    let mut used_display_indices = HashSet::<u32>::new();

    if let Some(primary_candidate) = candidates.iter_mut().find(|candidate| candidate.is_primary) {
        primary_candidate.assigned_display_index = Some(1);
        used_display_indices.insert(1);
    }

    for candidate in candidates.iter_mut() {
        if candidate.assigned_display_index.is_some() {
            continue;
        }

        if let Some(display_index) = candidate.windows_display_index {
            if display_index == 1 {
                continue;
            }
            if used_display_indices.insert(display_index) {
                candidate.assigned_display_index = Some(display_index);
            }
        }
    }

    let mut next_display_index = 2u32;
    for candidate in candidates.iter_mut() {
        if candidate.assigned_display_index.is_none() {
            while used_display_indices.contains(&next_display_index) {
                next_display_index += 1;
            }
            candidate.assigned_display_index = Some(next_display_index);
            used_display_indices.insert(next_display_index);
            next_display_index += 1;
        }
    }

    candidates.sort_by(|left, right| {
        let left_index = left.assigned_display_index.unwrap_or(u32::MAX);
        let right_index = right.assigned_display_index.unwrap_or(u32::MAX);
        left_index
            .cmp(&right_index)
            .then(left.bounds.y.cmp(&right.bounds.y))
            .then(left.bounds.x.cmp(&right.bounds.x))
    });

    let displays = candidates
        .into_iter()
        .enumerate()
        .map(|(index, candidate)| {
            let assigned_display_index = candidate
                .assigned_display_index
                .unwrap_or((index + 1) as u32);

            DisplayInfo {
                id: assigned_display_index as i64,
                name: monitor_display_name(assigned_display_index),
                scale_factor: candidate.scale_factor,
                bounds: candidate.bounds,
            }
        })
        .collect::<Vec<_>>();

    Ok(displays)
}

fn refresh_displays_state(app: &AppHandle, state: &AppState) -> Result<Vec<DisplayInfo>, String> {
    let displays = fetch_displays(app)?;
    let mut guard = state
        .displays
        .lock()
        .map_err(|_| "failed to lock displays state".to_string())?;
    *guard = displays.clone();
    Ok(displays)
}

fn emit_displays_updated(app: &AppHandle, displays: &[DisplayInfo]) {
    let _ = app.emit_to(
        EventTarget::webview_window(MAIN_LABEL.to_string()),
        "displays-updated",
        displays,
    );
}

fn emit_settings_to_overlays(app: &AppHandle, state: &AppState, settings: &OverlaySettings) {
    let displays = state
        .displays
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    for (index, _) in displays.iter().enumerate() {
        let label = overlay_label(index);
        if app.get_webview_window(&label).is_some() {
            let _ = app.emit_to(
                EventTarget::webview_window(label.clone()),
                "update-settings",
                settings,
            );
        }
    }
}

fn ensure_overlay_z_order(app: &AppHandle, state: &AppState) {
    let displays = state
        .displays
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    for (index, _) in displays.iter().enumerate() {
        let label = overlay_label(index);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_always_on_top(true);
            let _ = window.set_visible_on_all_workspaces(true);
            let _ = window.set_focusable(false);
            let _ = window.set_ignore_cursor_events(true);
            force_window_topmost(&window);
            if matches!(window.is_visible(), Ok(false)) {
                let _ = window.show();
            }
        }
    }
}

fn close_overlay_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(OVERLAY_LABEL_PREFIX) {
            let _ = window.destroy();
        }
    }
}

fn displays_need_overlay_recreate(previous: &[DisplayInfo], next: &[DisplayInfo]) -> bool {
    if previous.len() != next.len() {
        return true;
    }

    previous.iter().zip(next.iter()).any(|(before, after)| {
        before.bounds != after.bounds || (before.scale_factor - after.scale_factor).abs() > 0.01
    })
}

fn recreate_overlay_windows(
    app: &AppHandle,
    displays: &[DisplayInfo],
) -> Result<(), String> {
    close_overlay_windows(app);

    for (index, display) in displays.iter().enumerate() {
        let mut builder = WebviewWindowBuilder::new(
            app,
            overlay_label(index),
            WebviewUrl::App("overlay.html".into()),
        )
        .title("MiniCast Overlay")
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .position(display.bounds.x as f64, display.bounds.y as f64)
        .inner_size(display.bounds.width as f64, display.bounds.height as f64);

        if let Some(icon) = app.default_window_icon().cloned() {
            builder = builder
                .icon(icon)
                .map_err(|err| format!("failed to set overlay icon: {err}"))?;
        }

        let window = builder
            .build()
            .map_err(|err| format!("failed to create overlay window: {err}"))?;

        let _ = window.set_focusable(false);
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.set_visible_on_all_workspaces(true);
        force_window_topmost(&window);
    }

    Ok(())
}

fn display_index_from_point(displays: &[DisplayInfo], x: f64, y: f64) -> Option<usize> {
    displays.iter().enumerate().find_map(|(index, display)| {
        let left = display.bounds.x as f64;
        let top = display.bounds.y as f64;
        let right = left + display.bounds.width as f64;
        let bottom = top + display.bounds.height as f64;

        if x >= left && x < right && y >= top && y < bottom {
            Some(index)
        } else {
            None
        }
    })
}

fn display_index_from_monitor(
    app: &AppHandle,
    displays: &[DisplayInfo],
    x: f64,
    y: f64,
) -> Option<usize> {
    let monitor = app.monitor_from_point(x, y).ok().flatten()?;
    let position = monitor.position();
    let size = monitor.size();
    let bounds = Bounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    displays
        .iter()
        .enumerate()
        .find_map(|(index, display)| (display.bounds == bounds).then_some(index))
}

fn emit_mouse_move_for_point(app: &AppHandle, state: &AppState, x: f64, y: f64) {
    let displays = state
        .displays
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    let active_index = display_index_from_monitor(app, &displays, x, y)
        .or_else(|| display_index_from_point(&displays, x, y));

    for (index, display) in displays.iter().enumerate() {
        let label = overlay_label(index);
        if app.get_webview_window(&label).is_none() {
            continue;
        }

        if Some(index) == active_index {
            let payload = MousePositionPayload {
                x: (x - display.bounds.x as f64).round() as i32,
                y: (y - display.bounds.y as f64).round() as i32,
            };
            let _ = app.emit_to(
                EventTarget::webview_window(label.clone()),
                "mouse-move",
                payload,
            );
        } else {
            let _ = app.emit_to(
                EventTarget::webview_window(label.clone()),
                "mouse-move",
                Value::Null,
            );
        }
    }
}

fn emit_mouse_button_event(app: &AppHandle, state: &AppState, event_name: &str) {
    let displays = state
        .displays
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    for (index, _) in displays.iter().enumerate() {
        let label = overlay_label(index);
        if app.get_webview_window(&label).is_some() {
            let _ = app.emit_to(
                EventTarget::webview_window(label.clone()),
                event_name,
                Value::Null,
            );
        }
    }
}

fn build_combination(key_name: &str, ctrl: bool, shift: bool, alt: bool, meta: bool) -> String {
    let mut parts = Vec::new();
    if ctrl {
        parts.push("Ctrl".to_string());
    }
    if shift {
        parts.push("Shift".to_string());
    }
    if alt {
        parts.push("Alt".to_string());
    }
    if meta {
        parts.push("Meta".to_string());
    }

    if parts.is_empty() {
        key_name.to_string()
    } else {
        parts.push(key_name.to_string());
        parts.join(" + ")
    }
}

fn should_emit_combination(state: &AppState, combination: &str, timestamp_ms: i64) -> bool {
    let Ok(mut tracker) = state.input_tracker.lock() else {
        return true;
    };

    if tracker.last_combination == combination
        && timestamp_ms - tracker.last_timestamp_ms <= COMBINATION_DEDUP_MS
    {
        return false;
    }

    tracker.last_combination = combination.to_string();
    tracker.last_timestamp_ms = timestamp_ms;
    true
}

fn modifier_snapshot(state: &AppState) -> (bool, bool, bool, bool) {
    let Ok(tracker) = state.input_tracker.lock() else {
        return (false, false, false, false);
    };

    (tracker.ctrl, tracker.shift, tracker.alt, tracker.meta)
}

fn set_modifier_state(state: &AppState, key: Key, pressed: bool) -> bool {
    let Ok(mut tracker) = state.input_tracker.lock() else {
        return false;
    };

    match key {
        Key::ControlLeft | Key::ControlRight => {
            tracker.ctrl = pressed;
            true
        }
        Key::ShiftLeft | Key::ShiftRight => {
            tracker.shift = pressed;
            true
        }
        Key::Alt | Key::AltGr => {
            tracker.alt = pressed;
            true
        }
        Key::MetaLeft | Key::MetaRight => {
            tracker.meta = pressed;
            true
        }
        Key::CapsLock => true,
        _ => false,
    }
}

fn title_case(raw: &str) -> String {
    let mut chars = raw.chars();
    match chars.next() {
        Some(first) => {
            let mut value = first.to_ascii_uppercase().to_string();
            value.push_str(&chars.as_str().to_ascii_lowercase());
            value
        }
        None => String::new(),
    }
}

fn key_name(key: Key) -> String {
    match key {
        Key::Escape => "Esc".to_string(),
        Key::Return => "Enter".to_string(),
        Key::Backspace => "Backspace".to_string(),
        Key::Space => "Space".to_string(),
        Key::Tab => "Tab".to_string(),
        Key::UpArrow => "Up".to_string(),
        Key::DownArrow => "Down".to_string(),
        Key::LeftArrow => "Left".to_string(),
        Key::RightArrow => "Right".to_string(),
        Key::Dot => ".".to_string(),
        Key::Comma => ",".to_string(),
        Key::SemiColon => ";".to_string(),
        Key::Slash => "/".to_string(),
        Key::BackSlash => "\\".to_string(),
        Key::Equal => "=".to_string(),
        Key::Minus => "-".to_string(),
        Key::LeftBracket => "[".to_string(),
        Key::RightBracket => "]".to_string(),
        Key::Quote => "'".to_string(),
        Key::BackQuote => "`".to_string(),
        Key::ControlLeft | Key::ControlRight => "Ctrl".to_string(),
        Key::ShiftLeft | Key::ShiftRight => "Shift".to_string(),
        Key::Alt | Key::AltGr => "Alt".to_string(),
        Key::MetaLeft | Key::MetaRight => "Meta".to_string(),
        Key::Num0 => "0".to_string(),
        Key::Num1 => "1".to_string(),
        Key::Num2 => "2".to_string(),
        Key::Num3 => "3".to_string(),
        Key::Num4 => "4".to_string(),
        Key::Num5 => "5".to_string(),
        Key::Num6 => "6".to_string(),
        Key::Num7 => "7".to_string(),
        Key::Num8 => "8".to_string(),
        Key::Num9 => "9".to_string(),
        Key::KeyA => "A".to_string(),
        Key::KeyB => "B".to_string(),
        Key::KeyC => "C".to_string(),
        Key::KeyD => "D".to_string(),
        Key::KeyE => "E".to_string(),
        Key::KeyF => "F".to_string(),
        Key::KeyG => "G".to_string(),
        Key::KeyH => "H".to_string(),
        Key::KeyI => "I".to_string(),
        Key::KeyJ => "J".to_string(),
        Key::KeyK => "K".to_string(),
        Key::KeyL => "L".to_string(),
        Key::KeyM => "M".to_string(),
        Key::KeyN => "N".to_string(),
        Key::KeyO => "O".to_string(),
        Key::KeyP => "P".to_string(),
        Key::KeyQ => "Q".to_string(),
        Key::KeyR => "R".to_string(),
        Key::KeyS => "S".to_string(),
        Key::KeyT => "T".to_string(),
        Key::KeyU => "U".to_string(),
        Key::KeyV => "V".to_string(),
        Key::KeyW => "W".to_string(),
        Key::KeyX => "X".to_string(),
        Key::KeyY => "Y".to_string(),
        Key::KeyZ => "Z".to_string(),
        Key::Kp0 => "0".to_string(),
        Key::Kp1 => "1".to_string(),
        Key::Kp2 => "2".to_string(),
        Key::Kp3 => "3".to_string(),
        Key::Kp4 => "4".to_string(),
        Key::Kp5 => "5".to_string(),
        Key::Kp6 => "6".to_string(),
        Key::Kp7 => "7".to_string(),
        Key::Kp8 => "8".to_string(),
        Key::Kp9 => "9".to_string(),
        Key::KpDelete => ".".to_string(),
        Key::KpPlus => "+".to_string(),
        Key::KpMinus => "-".to_string(),
        Key::KpMultiply => "*".to_string(),
        Key::KpDivide => "/".to_string(),
        Key::KpReturn => "Enter".to_string(),
        Key::F1 => "F1".to_string(),
        Key::F2 => "F2".to_string(),
        Key::F3 => "F3".to_string(),
        Key::F4 => "F4".to_string(),
        Key::F5 => "F5".to_string(),
        Key::F6 => "F6".to_string(),
        Key::F7 => "F7".to_string(),
        Key::F8 => "F8".to_string(),
        Key::F9 => "F9".to_string(),
        Key::F10 => "F10".to_string(),
        Key::F11 => "F11".to_string(),
        Key::F12 => "F12".to_string(),
        other => {
            let raw = format!("{other:?}");
            if let Some(value) = raw.strip_prefix("Key") {
                return value.to_ascii_uppercase();
            }
            if let Some(value) = raw.strip_prefix("Num") {
                return value.to_string();
            }
            title_case(&raw)
        }
    }
}

fn emit_key_press_if_allowed(
    app: &AppHandle,
    state: &AppState,
    input: KeyInput,
) {
    let combination = build_combination(
        &input.key,
        input.ctrl,
        input.shift,
        input.alt,
        input.meta,
    );
    let timestamp = now_ms();

    if !should_emit_combination(state, &combination, timestamp) {
        return;
    }

    let displays = state
        .displays
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    if displays.is_empty() {
        return;
    }

    state
        .last_rdev_key_event_ms
        .store(timestamp, Ordering::Relaxed);

    for (index, _) in displays.iter().enumerate() {
        let label = overlay_label(index);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.set_always_on_top(true);
            let _ = window.set_visible_on_all_workspaces(true);
            let _ = window.set_focusable(false);
            let _ = window.set_ignore_cursor_events(true);
            force_window_topmost(&window);

            let payload = KeyPressPayload {
                key: input.key.clone(),
                code: input.code.clone(),
                ctrl_key: input.ctrl,
                shift_key: input.shift,
                alt_key: input.alt,
                meta_key: input.meta,
                timestamp,
                display_id: index,
                combination: combination.clone(),
            };
            let _ = app.emit_to(
                EventTarget::webview_window(label.clone()),
                "key-press",
                payload,
            );
        }
    }
}

fn mouse_button_names(
    button: Button,
) -> Option<(&'static str, &'static str, &'static str, &'static str)> {
    match button {
        Button::Left => Some((
            "mouse-left-down",
            "mouse-left-up",
            "MOUSE_LEFT",
            "Mouse left",
        )),
        Button::Right => Some((
            "mouse-right-down",
            "mouse-right-up",
            "MOUSE_RIGHT",
            "Mouse right",
        )),
        Button::Middle => Some((
            "mouse-middle-down",
            "mouse-middle-up",
            "MOUSE_MIDDLE",
            "Mouse middle",
        )),
        _ => None,
    }
}

fn handle_global_input_event(app: &AppHandle, event_type: EventType) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let state = state.inner();

    match event_type {
        EventType::KeyPress(key) => {
            if set_modifier_state(state, key, true) {
                return;
            }

            let (ctrl, shift, alt, meta) = modifier_snapshot(state);
            let key_name = key_name(key);
            let code = format!("{key:?}");
            emit_key_press_if_allowed(
                app,
                state,
                KeyInput {
                    key: key_name,
                    code,
                    ctrl,
                    shift,
                    alt,
                    meta,
                },
            );
        }
        EventType::KeyRelease(key) => {
            let _ = set_modifier_state(state, key, false);
        }
        EventType::ButtonPress(button) => {
            if let Some((down_event, _up_event, code, display_name)) = mouse_button_names(button) {
                emit_mouse_button_event(app, state, down_event);
                let (ctrl, shift, alt, meta) = modifier_snapshot(state);
                emit_key_press_if_allowed(
                    app,
                    state,
                    KeyInput {
                        key: display_name.to_string(),
                        code: code.to_string(),
                        ctrl,
                        shift,
                        alt,
                        meta,
                    },
                );
            }
        }
        EventType::ButtonRelease(button) => {
            if let Some((_down_event, up_event, _code, _display_name)) = mouse_button_names(button)
            {
                emit_mouse_button_event(app, state, up_event);
            }
        }
        _ => {}
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(main_window) = app.get_webview_window(MAIN_LABEL) {
        let _ = main_window.show();
        let _ = main_window.unminimize();
        let _ = main_window.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let show_item = MenuItem::with_id(
        app,
        TRAY_SHOW_MENU_ID,
        "\u{C5F4}\u{AE30}",
        true,
        None::<&str>,
    )
        .map_err(|err| format!("failed to create tray show menu item: {err}"))?;
    let quit_item = MenuItem::with_id(
        app,
        TRAY_QUIT_MENU_ID,
        "\u{C885}\u{B8CC}",
        true,
        None::<&str>,
    )
        .map_err(|err| format!("failed to create tray quit menu item: {err}"))?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])
        .map_err(|err| format!("failed to create tray menu: {err}"))?;

    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("MiniCast")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray: &TrayIcon, event: TrayIconEvent| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app: &AppHandle, event| {
            if event.id() == TRAY_SHOW_MENU_ID {
                show_main_window(app);
            } else if event.id() == TRAY_QUIT_MENU_ID {
                let state = app.state::<AppState>();
                if let Ok(mut quitting) = state.is_quitting.lock() {
                    *quitting = true;
                }
                app.exit(0);
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let tray = builder
        .build(app)
        .map_err(|err| format!("failed to build tray icon: {err}"))?;

    let state = app.state::<AppState>();
    let mut guard = state
        .tray
        .lock()
        .map_err(|_| "failed to lock tray state".to_string())?;
    *guard = Some(tray);

    Ok(())
}

fn setup_main_close_behavior(app: &AppHandle) -> Result<(), String> {
    let main_window = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;

    let app_handle = app.clone();
    let main_for_hide = main_window.clone();

    main_window.on_window_event(move |event| {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                let state = app_handle.state::<AppState>();
                let should_quit = state.is_quitting.lock().map(|flag| *flag).unwrap_or(false);

                if !should_quit {
                    api.prevent_close();
                    let _ = main_for_hide.hide();
                }
            }
            WindowEvent::Focused(true) => {
                let state = app_handle.state::<AppState>();
                ensure_overlay_z_order(&app_handle, state.inner());
            }
            _ => {}
        }
    });

    Ok(())
}

fn start_input_workers(app: &AppHandle, state: &AppState) {
    if state.input_started.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_for_cursor = app.clone();
    thread::spawn(move || {
        let resync_interval = Duration::from_millis(16);
        let min_emit_interval = Duration::from_millis(2);
        let keepalive_interval = Duration::from_millis(100);
        let mut last_z_order_sync = Instant::now();
        let mut last_cursor_px: Option<(i32, i32)> = None;
        let mut last_emit_at = Instant::now();

        loop {
            if let Ok(position) = app_for_cursor.cursor_position() {
                if let Some(state) = app_for_cursor.try_state::<AppState>() {
                    let cursor_px = (position.x.round() as i32, position.y.round() as i32);
                    let cursor_moved = last_cursor_px.map(|prev| prev != cursor_px).unwrap_or(true);
                    let elapsed_since_emit = last_emit_at.elapsed();
                    let should_emit = last_cursor_px.is_none()
                        || (cursor_moved && elapsed_since_emit >= min_emit_interval)
                        || elapsed_since_emit >= keepalive_interval;

                    if should_emit {
                        emit_mouse_move_for_point(
                            &app_for_cursor,
                            state.inner(),
                            position.x,
                            position.y,
                        );
                        last_cursor_px = Some(cursor_px);
                        last_emit_at = Instant::now();
                    }

                    if last_z_order_sync.elapsed() >= resync_interval {
                        ensure_overlay_z_order(&app_for_cursor, state.inner());
                        last_z_order_sync = Instant::now();
                    }
                }
            }
            thread::sleep(Duration::from_millis(1));
        }
    });

    let app_for_input = app.clone();
    thread::spawn(move || {
        let app_clone = app_for_input.clone();
        if let Err(err) = listen(move |event| {
            handle_global_input_event(&app_clone, event.event_type);
        }) {
            log::error!("failed to start global input listener: {:?}", err);
        }
    });

    start_windows_key_fallback_worker(app);
}

fn app_runtime_info() -> RuntimeInfo {
    let has_portable_context = std::env::var_os("PORTABLE_EXECUTABLE_FILE").is_some()
        || std::env::var_os("PORTABLE_EXECUTABLE_DIR").is_some();

    let install_mode = if cfg!(target_os = "windows") && has_portable_context {
        "portable"
    } else if cfg!(target_os = "windows") && !cfg!(debug_assertions) {
        "msi"
    } else {
        "unknown"
    };

    RuntimeInfo {
        install_mode: install_mode.to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

#[tauri::command]
fn minimize_main(window: Window) -> Result<(), String> {
    window
        .minimize()
        .map_err(|err| format!("failed to minimize window: {err}"))
}

#[tauri::command]
fn hide_main(window: Window) -> Result<(), String> {
    window
        .hide()
        .map_err(|err| format!("failed to hide window: {err}"))
}

#[tauri::command]
async fn request_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let previous_displays = state
            .inner()
            .displays
            .lock()
            .map_err(|_| "failed to lock displays state".to_string())?
            .clone();

        let displays = fetch_displays(&app)?;

        {
            let mut guard = state
                .inner()
                .displays
                .lock()
                .map_err(|_| "failed to lock displays state".to_string())?;
            *guard = displays.clone();
        }

        if displays_need_overlay_recreate(&previous_displays, &displays) {
            recreate_overlay_windows(&app, &displays)?;
        }

        emit_displays_updated(&app, &displays);
        Ok(displays)
    })
    .await
    .map_err(|err| format!("display refresh task failed: {err}"))?
}

#[tauri::command]
fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: OverlaySettings,
) -> Result<(), String> {
    {
        let mut guard = state
            .settings
            .lock()
            .map_err(|_| "failed to lock settings state".to_string())?;
        *guard = settings.clone();
    }

    let payload = serde_json::to_value(&settings)
        .map_err(|err| format!("failed to encode settings payload: {err}"))?;
    set_store_value(&app, state.inner(), "settings", payload)?;
    emit_settings_to_overlays(&app, state.inner(), &settings);

    Ok(())
}

#[tauri::command]
fn get_value(state: State<'_, AppState>, key: String) -> Result<Value, String> {
    if key == "runtimeInfo" {
        return serde_json::to_value(app_runtime_info())
            .map_err(|err| format!("failed to encode runtime info: {err}"));
    }

    let value = get_store_value(state.inner(), &key)?;
    Ok(value.unwrap_or(Value::Null))
}

#[tauri::command]
fn overlay_ready(window: Window, state: State<'_, AppState>) -> Result<(), String> {
    let window_label = window.label().to_string();
    let Some(index) = parse_overlay_index(window.label()) else {
        return Ok(());
    };

    let display = {
        let displays = state
            .displays
            .lock()
            .map_err(|_| "failed to lock displays state".to_string())?;
        displays.get(index).cloned()
    };

    if let Some(display) = display {
        let init_payload = OverlayInitPayload {
            id: index,
            x: display.bounds.x,
            y: display.bounds.y,
            width: display.bounds.width,
            height: display.bounds.height,
        };

        window
            .emit_to(
                EventTarget::webview_window(window_label.clone()),
                "init",
                init_payload,
            )
            .map_err(|err| format!("failed to emit init event: {err}"))?;
    }

    let settings = state
        .settings
        .lock()
        .map_err(|_| "failed to lock settings state".to_string())?
        .clone();

    window
        .emit_to(
            EventTarget::webview_window(window_label.clone()),
            "update-settings",
            settings,
        )
        .map_err(|err| format!("failed to emit update-settings event: {err}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let loaded_store = load_store_from_disk(app.handle());
            let initial_settings = load_settings_from_store(&loaded_store);

            app.manage(AppState {
                store: Mutex::new(loaded_store),
                settings: Mutex::new(initial_settings),
                displays: Mutex::new(Vec::new()),
                input_tracker: Mutex::new(InputTracker::default()),
                last_rdev_key_event_ms: AtomicI64::new(0),
                is_quitting: Mutex::new(false),
                tray: Mutex::new(None),
                input_started: AtomicBool::new(false),
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if !cfg!(debug_assertions) {
                if let Some(main_window) = app.get_webview_window(MAIN_LABEL) {
                    if let Err(err) = main_window.set_resizable(false) {
                        log::error!("failed to disable resize on main window: {err}");
                    }
                    if let Err(err) = main_window.set_maximizable(false) {
                        log::error!("failed to disable maximize on main window: {err}");
                    }
                }
            }

            if let Err(err) = setup_main_close_behavior(app.handle()) {
                log::error!("failed to initialize main close behavior: {err}");
            }
            if let Err(err) = setup_tray(app.handle()) {
                log::error!("failed to initialize system tray: {err}");
            }

            let state = app.state::<AppState>();
            match refresh_displays_state(app.handle(), state.inner()) {
                Ok(displays) => {
                    if let Err(err) =
                        recreate_overlay_windows(app.handle(), &displays)
                    {
                        log::error!("failed to create overlay windows: {err}");
                    }
                    emit_displays_updated(app.handle(), &displays);
                }
                Err(err) => {
                    log::error!("failed to refresh display state: {err}");
                }
            }

            start_input_workers(app.handle(), state.inner());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            minimize_main,
            hide_main,
            request_displays,
            update_settings,
            get_value,
            overlay_ready
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
