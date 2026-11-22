/**
 * Colour maths for derived interface themes.
 *
 * Mixing happens in OKLab, so a shade made from two seeds keeps their hue instead of
 * drifting grey the way an sRGB blend does. Every function takes and returns `#rrggbb`,
 * except {@link withAlpha}, which returns a CSS `rgb()` with an alpha.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Read `#rgb`, `#rrggbb` or a CSS `rgb(...)` value. */
export function parseColour(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex !== null) {
    let digits = hex[1] ?? "";
    if (digits.length === 3) {
      digits = digits
        .split("")
        .map((digit) => digit + digit)
        .join("");
    }
    const int = Number.parseInt(digits, 16);
    return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
  }
  const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(text);
  if (rgb !== null) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

/** A clamped `#rrggbb` string. */
export function toHex(rgb: Rgb): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

function linearise(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encode(channel: number): number {
  const value = Math.max(0, Math.min(1, channel));
  return 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
}

interface Oklab {
  l: number;
  a: number;
  b: number;
}

function toOklab(hex: string): Oklab {
  const rgb = parseColour(hex) ?? { r: 0, g: 0, b: 0 };
  const r = linearise(rgb.r);
  const g = linearise(rgb.g);
  const b = linearise(rgb.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function fromOklab(lab: Oklab): string {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  return toHex({
    r: encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  });
}

/** Move from one ink toward another; `amount` 0 keeps `from`, 1 gives `to`. */
export function mixHex(from: string, to: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const start = toOklab(from);
  const end = toOklab(to);
  return fromOklab({
    l: start.l + (end.l - start.l) * t,
    a: start.a + (end.a - start.a) * t,
    b: start.b + (end.b - start.b) * t,
  });
}

/** A CSS colour at partial opacity, in the space syntax the stylesheets use. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseColour(hex) ?? { r: 0, g: 0, b: 0 };
  const percent = Math.round(Math.max(0, Math.min(1, alpha)) * 100);
  return `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)} / ${percent}%)`;
}

/** WCAG relative luminance, 0 for black and 1 for white. */
export function relativeLuminance(hex: string): number {
  const rgb = parseColour(hex) ?? { r: 0, g: 0, b: 0 };
  return 0.2126 * linearise(rgb.r) + 0.7152 * linearise(rgb.g) + 0.0722 * linearise(rgb.b);
}

/** WCAG contrast ratio, from 1:1 to 21:1. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const light = Math.max(first, second);
  const dark = Math.min(first, second);
  return (light + 0.05) / (dark + 0.05);
}

/** White or near-black, whichever reads better on `background`. */
export function readableInk(background: string): string {
  return contrastRatio("#ffffff", background) >= contrastRatio("#0b0f14", background)
    ? "#ffffff"
    : "#0b0f14";
}

/**
 * Push `colour` toward black or white until it clears `minimum` against `background`.
 *
 * A UI accent that fails the floor fades into the surface; the custom theme keeps the
 * user's hue but lifts or darkens it to the nearest legible step.
 */
export function ensureContrast(colour: string, background: string, minimum: number): string {
  if (contrastRatio(colour, background) >= minimum) return colour;
  const toward = relativeLuminance(background) > 0.5 ? "#000000" : "#ffffff";
  for (let amount = 0.08; amount <= 1.0001; amount += 0.04) {
    const candidate = mixHex(colour, toward, amount);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return toward;
}
