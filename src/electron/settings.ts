import {
  DEFAULT_OVERLAY_SETTINGS,
  type KeyDisplayPosition,
  type OverlaySettings,
} from "./contract.js";

const POSITIONS = new Set<KeyDisplayPosition>([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);

const SETTING_KEYS = Object.keys(
  DEFAULT_OVERLAY_SETTINGS,
) as Array<keyof OverlaySettings>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(
  source: UnknownRecord,
  key: keyof OverlaySettings,
  fallback: boolean,
) {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function readColor(
  source: UnknownRecord,
  key: keyof OverlaySettings,
  fallback: string,
) {
  const value = source[key];
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 128
    ? value
    : fallback;
}

function readNumber(
  source: UnknownRecord,
  key: keyof OverlaySettings,
  fallback: number,
  min: number,
  max: number,
  integer = false,
) {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;

  const normalized = integer ? Math.round(value) : value;
  return Math.min(max, Math.max(min, normalized));
}

function readPosition(source: UnknownRecord) {
  const value = source.keyDisplayPosition;
  return typeof value === "string" &&
    POSITIONS.has(value as KeyDisplayPosition)
    ? (value as KeyDisplayPosition)
    : DEFAULT_OVERLAY_SETTINGS.keyDisplayPosition;
}

export function normalizeOverlaySettings(
  value: unknown,
  displayCount = 1,
): OverlaySettings {
  const source = isRecord(value) ? value : {};
  const monitorMax = Math.max(0, Math.floor(displayCount) - 1);

  return {
    cursorFillColor: readColor(
      source,
      "cursorFillColor",
      DEFAULT_OVERLAY_SETTINGS.cursorFillColor,
    ),
    cursorStrokeColor: readColor(
      source,
      "cursorStrokeColor",
      DEFAULT_OVERLAY_SETTINGS.cursorStrokeColor,
    ),
    cursorSize: readNumber(
      source,
      "cursorSize",
      DEFAULT_OVERLAY_SETTINGS.cursorSize,
      10,
      60,
    ),
    cursorStrokeSize: readNumber(
      source,
      "cursorStrokeSize",
      DEFAULT_OVERLAY_SETTINGS.cursorStrokeSize,
      0,
      30,
    ),
    showCursorHighlight: readBoolean(
      source,
      "showCursorHighlight",
      DEFAULT_OVERLAY_SETTINGS.showCursorHighlight,
    ),
    keyDisplayMonitor: readNumber(
      source,
      "keyDisplayMonitor",
      DEFAULT_OVERLAY_SETTINGS.keyDisplayMonitor,
      0,
      monitorMax,
      true,
    ),
    keyDisplayDuration: readNumber(
      source,
      "keyDisplayDuration",
      DEFAULT_OVERLAY_SETTINGS.keyDisplayDuration,
      500,
      5000,
      true,
    ),
    keyDisplayFontSize: readNumber(
      source,
      "keyDisplayFontSize",
      DEFAULT_OVERLAY_SETTINGS.keyDisplayFontSize,
      10,
      60,
      true,
    ),
    keyDisplayBackgroundColor: readColor(
      source,
      "keyDisplayBackgroundColor",
      DEFAULT_OVERLAY_SETTINGS.keyDisplayBackgroundColor,
    ),
    keyDisplayTextColor: readColor(
      source,
      "keyDisplayTextColor",
      DEFAULT_OVERLAY_SETTINGS.keyDisplayTextColor,
    ),
    keyDisplayPosition: readPosition(source),
    showKeyDisplay: readBoolean(
      source,
      "showKeyDisplay",
      DEFAULT_OVERLAY_SETTINGS.showKeyDisplay,
    ),
    annotationPenColor: readColor(
      source,
      "annotationPenColor",
      DEFAULT_OVERLAY_SETTINGS.annotationPenColor,
    ),
    annotationHighlighterColor: readColor(
      source,
      "annotationHighlighterColor",
      DEFAULT_OVERLAY_SETTINGS.annotationHighlighterColor,
    ),
    annotationPenWidth: readNumber(
      source,
      "annotationPenWidth",
      DEFAULT_OVERLAY_SETTINGS.annotationPenWidth,
      1,
      24,
    ),
    annotationHighlighterWidth: readNumber(
      source,
      "annotationHighlighterWidth",
      DEFAULT_OVERLAY_SETTINGS.annotationHighlighterWidth,
      4,
      64,
    ),
    annotationEraserWidth: readNumber(
      source,
      "annotationEraserWidth",
      DEFAULT_OVERLAY_SETTINGS.annotationEraserWidth,
      8,
      80,
    ),
  };
}

export function overlaySettingsEqual(
  value: unknown,
  expected: OverlaySettings,
) {
  if (!isRecord(value)) return false;
  return SETTING_KEYS.every((key) => value[key] === expected[key]);
}
