/**
 * Colour scheme files: the palette id, the stick ink and the per-element overrides.
 *
 * A scheme file carries only colour fields, so importing one cannot change a shape or a
 * light. The palette id is checked against the page's list before it is applied.
 */

import type { ElementColor } from "./renderer.js";

const FILE_KIND = "wikimolgen2-colours";
const FILE_VERSION = 1;
const MAX_COLOURS = 118;
const HEX = /^#[0-9a-f]{6}$/i;

/** The colour fields a scheme file carries. */
export interface ColourScheme {
  scheme: string;
  stickColor: string | null;
  elementColors: ElementColor[];
}

export function colourFileText(colours: ColourScheme): string {
  return JSON.stringify(
    {
      kind: FILE_KIND,
      version: FILE_VERSION,
      scheme: colours.scheme,
      stick_color: colours.stickColor,
      element_colors: colours.elementColors,
    },
    null,
    2,
  );
}

/** Read a scheme file, dropping entries that are not colours. */
export function parseColourFile(
  text: string,
): { colours: ColourScheme } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file is not JSON." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { error: "That file does not hold colours." };
  }
  const record = parsed as {
    kind?: unknown;
    version?: unknown;
    scheme?: unknown;
    stick_color?: unknown;
    element_colors?: unknown;
  };
  if (record.kind !== FILE_KIND) return { error: "That file is not a WikiMolGen 2 colour file." };
  if (record.version !== FILE_VERSION) {
    return { error: `Colour files of version ${String(record.version)} are not supported.` };
  }
  const scheme = typeof record.scheme === "string" ? record.scheme.trim().slice(0, 40) : "";
  const stickColor =
    typeof record.stick_color === "string" && HEX.test(record.stick_color)
      ? record.stick_color.toLowerCase()
      : null;

  const byElement = new Map<string, string>();
  if (Array.isArray(record.element_colors)) {
    for (const entry of record.element_colors) {
      if (typeof entry !== "object" || entry === null) continue;
      const raw = entry as { element?: unknown; color?: unknown };
      if (typeof raw.element !== "string" || typeof raw.color !== "string") continue;
      const element = raw.element.trim();
      if (element === "" || element.length > 3) continue;
      if (!HEX.test(raw.color)) continue;
      byElement.set(element, raw.color.toLowerCase());
      if (byElement.size >= MAX_COLOURS) break;
    }
  }
  const elementColors: ElementColor[] = [...byElement].map(([element, color]) => ({
    element,
    color,
  }));
  if (scheme === "" && stickColor === null && elementColors.length === 0) {
    return { error: "That file holds no colours." };
  }
  return { colours: { scheme, stickColor, elementColors } };
}
