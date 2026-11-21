/** Inline 2D depiction: build the SVG in Rust, show it, and offer it as a file. */

import { depictSvg } from "../pkg/molplate_wasm.js";

/** Nominal canvas width. The drawing is vector, so this only sets the viewBox. */
const DEPICTION_WIDTH = 900;
/** Empty border as a fraction of the width, matching the 3D figure margin. */
const DEPICTION_MARGIN = 0.06;

export interface Depiction {
  /** The SVG document, ready to inline or download. */
  svg: string;
}

/**
 * Build a skeletal SVG from a V2000 record.
 *
 * Returns `null` when the record cannot be drawn, with a sentence for the stage note.
 */
export function buildDepiction(name: string, sdf: Uint8Array): { depiction: Depiction | null; error: string | null } {
  try {
    const svg = depictSvg(sdf, DEPICTION_WIDTH, DEPICTION_MARGIN, false, false, name);
    return { depiction: { svg }, error: null };
  } catch (error) {
    return { depiction: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Replace the host contents with the inline SVG, scoped to the page document. */
export function showDepiction(host: HTMLElement, svg: string): void {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror") !== null) {
    host.textContent = "The 2D drawing could not be displayed.";
    return;
  }
  // The parsed root belongs to another document; import it so styles and events apply.
  host.replaceChildren(document.importNode(parsed.documentElement, true));
}

export function clearDepiction(host: HTMLElement): void {
  host.replaceChildren();
}

/** Download the SVG as a file. The caller resolves the Commons-style name. */
export function downloadSvg(name: string, svg: string): void {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Bytes of the SVG document, for the size statement in the status line. */
export function depictionBytes(svg: string): number {
  return new TextEncoder().encode(svg).length;
}
