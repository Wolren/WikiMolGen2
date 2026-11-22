/**
 * Inline 2D depiction: RDKit first, the Rust V2000 parser as the fallback.
 *
 * RDKit gives the canonical depiction, stereo wedges and a layout for records without
 * coordinates. It costs a 7.39 MB wasm download on first use. If that module cannot load,
 * the Rust parser still draws the PubChem record.
 */

import { depictSvg } from "../pkg/wikimolgen2_wasm.js";
import { dom, state, type DepictionSettings } from "./context.js";
import { depictWithRdkit } from "./rdkit.js";

/** Nominal canvas size. The drawing is vector, so this only sets the viewBox. */
const DEPICTION_WIDTH = 900;
const DEPICTION_HEIGHT = 700;
/** Empty border as a fraction of the width, for the Rust fallback. */
const DEPICTION_MARGIN = 0.06;
const STORAGE_KEY = "wikimolgen2.depiction";
const MAX_BOND_WIDTH = 8;
const MAX_LABEL_SIZE = 36;
const MAX_LEGEND = 200;

export const DEFAULT_DEPICTION_SETTINGS: DepictionSettings = {
  monochrome: false,
  bondWidth: 0,
  labelSize: 0,
  stereo: false,
  radicals: false,
  chiralFlag: false,
  atomTags: false,
  hideLabels: false,
  explicitMethyl: false,
  comic: false,
  legend: "",
  highlightAtoms: "",
  highlightBonds: "",
  highlightColor: "#ff8888",
  rotate: 0,
  bondLength: 0,
  padding: 0,
  labelPadding: 0,
  bondOffset: 0,
};

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

function clamp(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(min, Math.min(max, parsed));
}

/** Read the saved drawing options, ignoring anything that no longer has the right shape. */
export function loadDepictionSettings(): DepictionSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (typeof raw !== "object" || raw === null) return { ...DEFAULT_DEPICTION_SETTINGS };
    const record = raw as Record<string, unknown>;
    const on = (key: string): boolean => record[key] === true;
    return {
      monochrome: on("monochrome"),
      bondWidth: clamp(record.bondWidth, 0, MAX_BOND_WIDTH),
      labelSize: clamp(record.labelSize, 0, MAX_LABEL_SIZE),
      stereo: on("stereo"),
      radicals: on("radicals"),
      chiralFlag: on("chiralFlag"),
      atomTags: on("atomTags"),
      hideLabels: on("hideLabels"),
      explicitMethyl: on("explicitMethyl"),
      comic: on("comic"),
      legend: typeof record.legend === "string" ? record.legend.slice(0, MAX_LEGEND) : "",
      highlightAtoms: typeof record.highlightAtoms === "string" ? record.highlightAtoms : "",
      highlightBonds: typeof record.highlightBonds === "string" ? record.highlightBonds : "",
      highlightColor: typeof record.highlightColor === "string" ? record.highlightColor : "#ff8888",
      rotate: clamp(record.rotate, -180, 180),
      bondLength: clamp(record.bondLength, 0, 80),
      padding: clamp(record.padding, 0, 0.3),
      labelPadding: clamp(record.labelPadding, 0, 1),
      bondOffset: clamp(record.bondOffset, 0, 0.5),
    };
  } catch {
    // A blocked store or bad JSON only means the defaults for this visit.
    return { ...DEFAULT_DEPICTION_SETTINGS };
  }
}

export function saveDepictionSettings(settings: DepictionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The options then last for this visit only.
  }
}

function readControls(): DepictionSettings {
  return {
    monochrome: dom.depictionMonochrome.checked,
    bondWidth: clamp(dom.depictionBondWidth.value, 0, MAX_BOND_WIDTH),
    labelSize: clamp(dom.depictionLabelSize.value, 0, MAX_LABEL_SIZE),
    stereo: dom.depictionStereo.checked,
    radicals: dom.depictionRadicals.checked,
    chiralFlag: dom.depictionChiral.checked,
    atomTags: dom.depictionAtomTags.checked,
    hideLabels: dom.depictionHideLabels.checked,
    explicitMethyl: dom.depictionExplicitMethyl.checked,
    comic: dom.depictionComic.checked,
    legend: dom.depictionLegend.value.slice(0, MAX_LEGEND),
    highlightAtoms: dom.depictionHighlightAtoms.value,
    highlightBonds: dom.depictionHighlightBonds.value,
    highlightColor: dom.depictionHighlightColor.value,
    rotate: clamp(dom.depictionRotate.value, -180, 180),
    bondLength: clamp(dom.depictionBondLength.value, 0, 80),
    padding: clamp(dom.depictionPadding.value, 0, 0.3),
    labelPadding: clamp(dom.depictionLabelPadding.value, 0, 1),
    bondOffset: clamp(dom.depictionBondOffset.value, 0, 0.5),
  };
}

/** The value a slider reads out, with `Auto` at its off position. */
function autoLabel(value: number, digits = 0): string {
  return value === 0 ? "Auto" : value.toFixed(digits);
}

function syncOutputs(): void {
  dom.depictionBondWidthValue.textContent =
    state.depictionSettings.bondWidth === 0 ? "Auto" : String(state.depictionSettings.bondWidth);
  dom.depictionLabelSizeValue.textContent =
    state.depictionSettings.labelSize === 0 ? "Auto" : String(state.depictionSettings.labelSize);
  const settings = state.depictionSettings;
  dom.depictionRotateValue.textContent = settings.rotate === 0 ? "Off" : `${settings.rotate}°`;
  dom.depictionBondLengthValue.textContent = autoLabel(settings.bondLength);
  dom.depictionPaddingValue.textContent = autoLabel(settings.padding, 2);
  dom.depictionLabelPaddingValue.textContent = autoLabel(settings.labelPadding, 2);
  dom.depictionBondOffsetValue.textContent = autoLabel(settings.bondOffset, 2);
}

/** Copy the settings into the panel. */
export function syncDepictionControls(): void {
  const settings = state.depictionSettings;
  dom.depictionMonochrome.checked = settings.monochrome;
  dom.depictionBondWidth.value = String(settings.bondWidth);
  dom.depictionLabelSize.value = String(settings.labelSize);
  dom.depictionStereo.checked = settings.stereo;
  dom.depictionRadicals.checked = settings.radicals;
  dom.depictionChiral.checked = settings.chiralFlag;
  dom.depictionAtomTags.checked = settings.atomTags;
  dom.depictionHideLabels.checked = settings.hideLabels;
  dom.depictionExplicitMethyl.checked = settings.explicitMethyl;
  dom.depictionComic.checked = settings.comic;
  dom.depictionLegend.value = settings.legend;
  dom.depictionHighlightAtoms.value = settings.highlightAtoms;
  dom.depictionHighlightBonds.value = settings.highlightBonds;
  dom.depictionHighlightColor.value = settings.highlightColor;
  dom.depictionRotate.value = String(settings.rotate);
  dom.depictionBondLength.value = String(settings.bondLength);
  dom.depictionPadding.value = String(settings.padding);
  dom.depictionLabelPadding.value = String(settings.labelPadding);
  dom.depictionBondOffset.value = String(settings.bondOffset);
  syncOutputs();
}

/** Show the drawing switches only while the 2D view owns the stage. */
export function setDepictionAvailable(available: boolean): void {
  dom.depictionControls.hidden = !available;
}

/** Wire the drawing controls; `onChange` schedules a redraw of an open 2D view. */
export function bindDepictionControls(onChange: () => void): void {
  syncDepictionControls();
  const apply = (): void => {
    state.depictionSettings = readControls();
    saveDepictionSettings(state.depictionSettings);
    syncOutputs();
    onChange();
  };
  dom.depictionMonochrome.addEventListener("change", apply);
  for (const input of [
    dom.depictionBondWidth,
    dom.depictionLabelSize,
    dom.depictionStereo,
    dom.depictionRadicals,
    dom.depictionChiral,
    dom.depictionAtomTags,
    dom.depictionHideLabels,
    dom.depictionExplicitMethyl,
    dom.depictionComic,
    dom.depictionLegend,
    dom.depictionHighlightAtoms,
    dom.depictionHighlightBonds,
    dom.depictionHighlightColor,
    dom.depictionRotate,
    dom.depictionBondLength,
    dom.depictionPadding,
    dom.depictionLabelPadding,
    dom.depictionBondOffset,
  ]) {
    input.addEventListener("input", apply);
  }
}

/** Give the SVG a document title, so a screen reader and a downloaded file both name it. */
function withTitle(svg: string, title: string): string {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  if (parsed.querySelector("parsererror") !== null || root.localName !== "svg") return svg;
  const existing = root.querySelector("title");
  if (existing !== null) {
    existing.textContent = title;
  } else {
    const node = parsed.createElementNS("http://www.w3.org/2000/svg", "title");
    node.textContent = title;
    root.insertBefore(node, root.firstChild);
  }
  return new XMLSerializer().serializeToString(root);
}

/**
 * Build a skeletal SVG from a 2D record.
 *
 * Returns `null` when neither engine can draw, with a sentence for the status line.
 */
export async function buildDepiction(
  name: string,
  sdf: Uint8Array,
  inks: { element: string; color: string }[] = [],
  settings: DepictionSettings = DEFAULT_DEPICTION_SETTINGS,
): Promise<DepictionResult> {
  const title = `${name === "" ? "Molecule" : name} skeletal structure`;
  let rdkitError = "RDKit was skipped after an earlier failure";
  if (!rdkitUnavailable) {
    try {
      const svg = await depictWithRdkit(sdf, DEPICTION_WIDTH, DEPICTION_HEIGHT, inks, {
        monochrome: settings.monochrome,
        bondWidth: settings.bondWidth,
        labelSize: settings.labelSize,
        stereo: settings.stereo,
        radicals: settings.radicals,
        chiralFlag: settings.chiralFlag,
        atomTags: settings.atomTags,
        hideLabels: settings.hideLabels,
        explicitMethyl: settings.explicitMethyl,
        comic: settings.comic,
        legend: settings.legend,
        highlightAtoms: settings.highlightAtoms,
        highlightBonds: settings.highlightBonds,
        highlightColor: settings.highlightColor,
        rotate: settings.rotate,
        bondLength: settings.bondLength,
        padding: settings.padding,
        labelPadding: settings.labelPadding,
        bondOffset: settings.bondOffset,
      });
      return { depiction: { svg: withTitle(svg, title), engine: "rdkit" }, error: null };
    } catch (error) {
      rdkitUnavailable = true;
      rdkitError = error instanceof Error ? error.message : String(error);
    }
  }

  try {
    const svg = depictSvg(
      sdf,
      DEPICTION_WIDTH,
      DEPICTION_MARGIN,
      false,
      settings.monochrome,
      name,
    );
    return { depiction: { svg: withTitle(svg, title), engine: "rust" }, error: null };
  } catch (error) {
    const rustError = error instanceof Error ? error.message : String(error);
    return { depiction: null, error: `${rdkitError}; ${rustError}` };
  }
}

/** Replace the host contents with the inline SVG, named for assistive technology. */
export function showDepiction(host: HTMLElement, svg: string, label: string): void {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror") !== null) {
    host.textContent = "The 2D drawing could not be displayed.";
    return;
  }
  // The parsed root belongs to another document; import it so styles and events apply.
  const root = document.importNode(parsed.documentElement, true);
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", label);
  host.replaceChildren(root);
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
