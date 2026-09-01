interface ParsedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

export interface EditorColor {
  color: string;
  opacity: number;
}

const HEX_COLOR = /^#([\da-f]{3,8})$/i;
const RGB_COLOR =
  /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i;

function byte(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 255) return null;
  return Math.round(parsed);
}

function unit(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function parseHexColor(value: string): ParsedColor | null {
  const match = HEX_COLOR.exec(value);
  if (!match) return null;

  const digits = match[1];
  if (![3, 4, 6, 8].includes(digits.length)) return null;
  const expanded =
    digits.length <= 4
      ? [...digits].map((digit) => `${digit}${digit}`).join("")
      : digits;
  const alpha =
    expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
    alpha,
  };
}

function parseRgbColor(value: string): ParsedColor | null {
  const match = RGB_COLOR.exec(value);
  if (!match) return null;

  const red = byte(match[1]);
  const green = byte(match[2]);
  const blue = byte(match[3]);
  const alpha = match[4] === undefined ? 1 : unit(match[4]);
  if (red === null || green === null || blue === null || alpha === null) {
    return null;
  }

  return { red, green, blue, alpha };
}

export function parseCssColor(value: unknown): ParsedColor | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return parseHexColor(normalized) ?? parseRgbColor(normalized);
}

function requireFallback(value: string) {
  const parsed = parseCssColor(value);
  if (!parsed) throw new Error(`Invalid fallback color: ${value}`);
  return parsed;
}

function hexByte(value: number) {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function alphaText(value: number) {
  return String(Number(value.toFixed(4)));
}

export function normalizeRgbaColor(value: unknown, fallback: string) {
  const parsed = parseCssColor(value) ?? requireFallback(fallback);
  return `rgba(${parsed.red}, ${parsed.green}, ${parsed.blue}, ${alphaText(parsed.alpha)})`;
}

export function normalizeHexColor(value: unknown, fallback: string) {
  const parsed = parseCssColor(value) ?? requireFallback(fallback);
  return `#${hexByte(parsed.red)}${hexByte(parsed.green)}${hexByte(parsed.blue)}`;
}

export function colorForEditor(value: unknown, fallback: string): EditorColor {
  const parsed = parseCssColor(value) ?? requireFallback(fallback);
  return {
    color: `#${hexByte(parsed.red)}${hexByte(parsed.green)}${hexByte(parsed.blue)}`,
    opacity: 1 - parsed.alpha,
  };
}

export function rgbaFromEditor(color: string, opacity: number) {
  const parsed = parseCssColor(color) ?? requireFallback("#000000");
  const transparency = Math.min(1, Math.max(0, opacity));
  return `rgba(${parsed.red}, ${parsed.green}, ${parsed.blue}, ${alphaText(
    1 - transparency,
  )})`;
}
