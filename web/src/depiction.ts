/**
 * Inline 2D depiction: RDKit first, the Rust V2000 parser as the fallback.
 *
 * RDKit gives the canonical depiction, stereo wedges and a layout for records without
 * coordinates. It costs a 7.39 MB wasm download on first use. If that module cannot load,
 * the Rust parser still draws the PubChem record.
 */

import { depictSvg } from "../pkg/molplate_wasm.js";
import { depictWithRdkit } from "./rdkit.js";

/** Nominal canvas size. The drawing is vector, so this only sets the viewBox. */
const DEPICTION_WIDTH = 900;
const DEPICTION_HEIGHT = 700;
/** Empty border as a fraction of the width, for the Rust fallback. */
const DEPICTION_MARGIN = 0.06;

export type DepictionEngine = "rdkit" | "rust";

export interface Depiction {
  /** The SVG document, ready to inline or download. */
  svg: string;
  /** Which engine drew it, for the stage note and the report. */
  engine: DepictionEngine;
}

export interface DepictionResult {
  depiction: Depiction | null;
  error: string | null;
}

/** A failed RDKit load is not retried for every drawing in the session. */
let rdkitUnavailable = false;

/**
 * Build a skeletal SVG from a 2D record.
 *
 * Returns `null` when neither engine can draw, with a sentence for the status line.
 */
export async function buildDepiction(name: string, sdf: Uint8Array): Promise<DepictionResult> {
  let rdkitError = "RDKit was skipped after an earlier failure";
  if (!rdkitUnavailable) {
    try {
      const svg = await depictWithRdkit(sdf, DEPICTION_WIDTH, DEPICTION_HEIGHT);
      return { depiction: { svg, engine: "rdkit" }, error: null };
    } catch (error) {
      rdkitUnavailable = true;
      rdkitError = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const svg = depictSvg(sdf, DEPICTION_WIDTH, DEPICTION_MARGIN, false, false, name);
    return { depiction: { svg, engine: "rust" }, error: null };
  } catch (error) {
    const rustError = error instanceof Error ? error.message : String(error);
    return { depiction: null, error: `${rdkitError}; ${rustError}` };
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
