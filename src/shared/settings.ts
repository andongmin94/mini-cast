import {
  normalizeHexColor,
  normalizeRgbaColor,
} from "./color.js";
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

function readRgbaColor(
  source: UnknownRecord,
  key: keyof OverlaySettings,
  fallback: string,
) {
  return normalizeRgbaColor(source[key], fallback);
}

function readHexColor(
  source: UnknownRecord,
  key: keyof OverlaySettings,
  fallback: string,
) {
  return normalizeHexColor(source[key], fallback);
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

function readDisplayId(source: UnknownRecord, displayIds: readonly number[]) {
  const fallback = displayIds[0] ?? DEFAULT_OVERLAY_SETTINGS.keyDisplayId;
  const value = source.keyDisplayId;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    displayIds.includes(value)
    ? value
    : fallback;
}

export function normalizeOverlaySettings(
  value: unknown,
  displayIds: readonly number[] = [DEFAULT_OVERLAY_SETTINGS.keyDisplayId],
): OverlaySettings {
  const source = isRecord(value) ? value : {};

  return {
    cursorFillColor: readRgbaColor(
      source,
      "cursorFillColor",
      DEFAULT_OVERLAY_SETTINGS.cursorFillColor,
    ),
    cursorStrokeColor: readRgbaColor(
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
    keyDisplayId: readDisplayId(source, displayIds),
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
    keyDisplayBackgroundColor: readRgbaColor(
      source,
      "keyDisplayBackgroundColor",
      DEFAULT_OVERLAY_SETTINGS.keyDisplayBackgroundColor,
    ),
    keyDisplayTextColor: readHexColor(
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
    annotationPenColor: readHexColor(
      source,
      "annotationPenColor",
      DEFAULT_OVERLAY_SETTINGS.annotationPenColor,
    ),
    annotationHighlighterColor: readHexColor(
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
