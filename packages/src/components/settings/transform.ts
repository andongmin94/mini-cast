import {
  DEFAULT_CONTROLLER_SETTINGS,
  DEFAULT_OVERLAY_SETTINGS,
} from "@/components/settings/defaults";
import {
  type ControllerSettings,
  type KeyDisplayPosition,
  type OverlaySettings,
} from "@/components/settings/types";

function hexToRgba(hex: string, alpha: number = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function rgbaToHex(rgba: string): { hex: string; opacity: number } {
  const match = rgba.match(
    /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/,
  );
  if (match) {
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    const a = match[4] ? parseFloat(match[4]) : 1;
    const hex =
      "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    return { hex, opacity: 1 - a };
  }
  return { hex: "#000000", opacity: 0 };
}

function isKeyDisplayPosition(value: unknown): value is KeyDisplayPosition {
  return (
    value === "top-left" ||
    value === "top-right" ||
    value === "bottom-left" ||
    value === "bottom-right"
  );
}

export function toOverlaySettings(
  settings: ControllerSettings,
): OverlaySettings {
  return {
    cursorFillColor: hexToRgba(
      settings.cursorFillColor,
      1 - settings.cursorFillOpacity,
    ),
    cursorStrokeColor: hexToRgba(
      settings.cursorStrokeColor,
      1 - settings.cursorStrokeOpacity,
    ),
    cursorSize: settings.cursorSize,
    cursorStrokeSize: settings.cursorStrokeSize,
    showCursorHighlight: settings.showCursorHighlight,
    keyDisplayMonitor: settings.keyDisplayMonitor,
    keyDisplayDuration: settings.keyDisplayDuration,
    keyDisplayFontSize: settings.keyDisplayFontSize,
    keyDisplayBackgroundColor: hexToRgba(
      settings.keyDisplayBackgroundColor,
      1 - settings.keyDisplayBackgroundOpacity,
    ),
    keyDisplayTextColor: settings.keyDisplayTextColor,
    keyDisplayPosition: settings.keyDisplayPosition,
    showKeyDisplay: settings.showKeyDisplay,
  };
}

export function toControllerSettings(
  settings: Partial<OverlaySettings> | null | undefined,
): ControllerSettings {
  const source = settings ?? {};
  const fill = rgbaToHex(
    source.cursorFillColor ?? DEFAULT_OVERLAY_SETTINGS.cursorFillColor,
  );
  const stroke = rgbaToHex(
    source.cursorStrokeColor ?? DEFAULT_OVERLAY_SETTINGS.cursorStrokeColor,
  );
  const background = rgbaToHex(
    source.keyDisplayBackgroundColor ??
      DEFAULT_OVERLAY_SETTINGS.keyDisplayBackgroundColor,
  );

  return {
    ...DEFAULT_CONTROLLER_SETTINGS,
    cursorFillColor: fill.hex,
    cursorFillOpacity: fill.opacity,
    cursorStrokeColor: stroke.hex,
    cursorStrokeOpacity: stroke.opacity,
    cursorSize: source.cursorSize ?? DEFAULT_CONTROLLER_SETTINGS.cursorSize,
    cursorStrokeSize:
      source.cursorStrokeSize ?? DEFAULT_CONTROLLER_SETTINGS.cursorStrokeSize,
    showCursorHighlight:
      source.showCursorHighlight ?? DEFAULT_CONTROLLER_SETTINGS.showCursorHighlight,
    keyDisplayMonitor:
      source.keyDisplayMonitor ?? DEFAULT_CONTROLLER_SETTINGS.keyDisplayMonitor,
    keyDisplayDuration:
      source.keyDisplayDuration ?? DEFAULT_CONTROLLER_SETTINGS.keyDisplayDuration,
    keyDisplayFontSize:
      source.keyDisplayFontSize ?? DEFAULT_CONTROLLER_SETTINGS.keyDisplayFontSize,
    keyDisplayBackgroundColor: background.hex,
    keyDisplayBackgroundOpacity: background.opacity,
    keyDisplayTextColor:
      source.keyDisplayTextColor ?? DEFAULT_CONTROLLER_SETTINGS.keyDisplayTextColor,
    keyDisplayPosition: isKeyDisplayPosition(source.keyDisplayPosition)
      ? source.keyDisplayPosition
      : DEFAULT_CONTROLLER_SETTINGS.keyDisplayPosition,
    showKeyDisplay:
      source.showKeyDisplay ?? DEFAULT_CONTROLLER_SETTINGS.showKeyDisplay,
  };
}
