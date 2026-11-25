/**
 * Inline 2D depiction: RDKit first, the Rust V2000 parser as the fallback.
 *
 * RDKit gives the canonical depiction, stereo wedges and a layout for records without
 * coordinates. It costs a 7.39 MB wasm download on first use. If that module cannot load,
 * the Rust parser still draws the PubChem record.
 */

import { depictSvg } from "../pkg/wikimolgen2_wasm.js";
import { dom, state } from "./context.js";
import {
  DEFAULT_DEPICTION_SETTINGS,
  MAX_BOND_WIDTH,
  MAX_LABEL_SIZE,
  MAX_LEGEND,
  clampValue,
  normaliseDepictionSettings,
  type DepictionSettings,
} from "./depiction-settings.js";
import {
  BUILTIN_DEPICTION_PRESETS,
  captureDepiction,
  loadDepictionPresets,
  saveDepictionPresets,
  type DepictionPreset,
} from "./depiction-presets.js";
import { depictWithRdkit } from "./rdkit.js";
import { attachDepictionZoom, detachDepictionZoom } from "./depiction-zoom.js";
import { newId, uniqueName } from "./names.js";

/** Nominal canvas size. The drawing is vector, so this only sets the viewBox. */
const DEPICTION_WIDTH = 900;
const DEPICTION_HEIGHT = 700;
/** Empty border as a fraction of the width, for the Rust fallback. */
const DEPICTION_MARGIN = 0.06;
const STORAGE_KEY = "wikimolgen2.depiction";
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

/** The SVG last placed in the stage, so a redraw of the same file keeps its zoom. */
let shownSvg: string | null = null;

/** Read the saved drawing options, ignoring anything that no longer has the right shape. */
export function loadDepictionSettings(): DepictionSettings {
  try {
    return normaliseDepictionSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
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
    bondWidth: clampValue(dom.depictionBondWidth.value, 0, MAX_BOND_WIDTH),
    labelSize: clampValue(dom.depictionLabelSize.value, 0, MAX_LABEL_SIZE),
    stereo: dom.depictionStereo.checked,
    radicals: dom.depictionRadicals.checked,
    chiralFlag: dom.depictionChiral.checked,
    atomTags: dom.depictionAtomTags.checked,
    hideLabels: dom.depictionHideLabels.checked,
    explicitMethyl: dom.depictionExplicitMethyl.checked,
    comic: dom.depictionComic.checked,
    acs1996: dom.depictionAcs.checked,
    relayout: dom.depictionRelayout.checked,
    legend: dom.depictionLegend.value.slice(0, MAX_LEGEND),
    highlightAtoms: dom.depictionHighlightAtoms.value,
    highlightBonds: dom.depictionHighlightBonds.value,
    highlightColor: dom.depictionHighlightColor.value,
    rotate: clampValue(dom.depictionRotate.value, -180, 180),
    bondLength: clampValue(dom.depictionBondLength.value, 0, 80),
    padding: clampValue(dom.depictionPadding.value, 0, 0.3),
    labelPadding: clampValue(dom.depictionLabelPadding.value, 0, 1),
    bondOffset: clampValue(dom.depictionBondOffset.value, 0, 0.5),
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
  lockAcsOverrides();
}

/** ACS 1996 owns these options, so the panel switches them off while it is on. */
function lockAcsOverrides(): void {
  const locked = state.depictionSettings.acs1996;
  for (const input of [
    dom.depictionMonochrome,
    dom.depictionBondWidth,
    dom.depictionLabelSize,
    dom.depictionStereo,
    dom.depictionRadicals,
    dom.depictionChiral,
    dom.depictionAtomTags,
    dom.depictionHideLabels,
    dom.depictionExplicitMethyl,
    dom.depictionComic,
    dom.depictionBondLength,
    dom.depictionPadding,
    dom.depictionLabelPadding,
    dom.depictionBondOffset,
  ]) {
    input.disabled = locked;
  }
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
  dom.depictionAcs.checked = settings.acs1996;
  dom.depictionRelayout.checked = settings.relayout;
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
  let savedPresets: DepictionPreset[] = loadDepictionPresets();

  /** The selected preset when it is one of the user's saved entries. */
  const selectedSaved = (): DepictionPreset | undefined =>
    savedPresets.find((preset) => preset.id === dom.depictionPreset.value);

  const updateButtons = (): void => {
    dom.depictionPresetDelete.disabled = selectedSaved() === undefined;
  };

  const renderPresets = (): void => {
    const selected = dom.depictionPreset.value;
    dom.depictionPreset.replaceChildren(
      new Option("Custom", "custom"),
      ...BUILTIN_DEPICTION_PRESETS.map((preset) => new Option(preset.name, preset.id)),
      ...savedPresets.map((preset) => new Option(preset.name, preset.id)),
    );
    const known = [...dom.depictionPreset.options].some((option) => option.value === selected);
    dom.depictionPreset.value = known ? selected : "custom";
    updateButtons();
  };

  /** Adopt a preset's whole option set, and redraw an open 2D view. */
  const applyPreset = (id: string): void => {
    const preset = [...BUILTIN_DEPICTION_PRESETS, ...savedPresets].find(
      (entry) => entry.id === id,
    );
    if (preset === undefined) return;
    state.depictionSettings = { ...preset.settings };
    saveDepictionSettings(state.depictionSettings);
    syncDepictionControls();
    onChange();
  };

  const apply = (): void => {
    state.depictionSettings = readControls();
    saveDepictionSettings(state.depictionSettings);
    syncOutputs();
    if (dom.depictionPreset.value !== "custom") dom.depictionPreset.value = "custom";
    updateButtons();
    onChange();
  };

  dom.depictionPreset.addEventListener("change", () => {
    if (dom.depictionPreset.value === "custom") {
      updateButtons();
      return;
    }
    applyPreset(dom.depictionPreset.value);
    updateButtons();
  });
  dom.depictionPresetSave.addEventListener("click", () => {
    dom.depictionPresetNameRow.hidden = false;
    dom.depictionPresetName.value = "";
    dom.depictionPresetName.focus();
  });
  dom.depictionPresetNameSave.addEventListener("click", () => {
    const name = uniqueName(dom.depictionPresetName.value, [
      ...BUILTIN_DEPICTION_PRESETS.map((preset) => preset.name),
      ...savedPresets.map((preset) => preset.name),
    ]);
    if (name === "") return;
    const preset: DepictionPreset = {
      id: newId("saved"),
      name,
      settings: captureDepiction(state.depictionSettings),
    };
    savedPresets = [...savedPresets, preset];
    saveDepictionPresets(savedPresets);
    renderPresets();
    dom.depictionPreset.value = preset.id;
    dom.depictionPresetNameRow.hidden = true;
    updateButtons();
  });
  dom.depictionPresetNameCancel.addEventListener("click", () => {
    dom.depictionPresetNameRow.hidden = true;
  });
  dom.depictionPresetDelete.addEventListener("click", () => {
    savedPresets = savedPresets.filter((preset) => preset.id !== dom.depictionPreset.value);
    saveDepictionPresets(savedPresets);
    renderPresets();
    dom.depictionPreset.value = "custom";
    updateButtons();
  });

  renderPresets();
  dom.depictionMonochrome.addEventListener("change", apply);
  dom.depictionAcs.addEventListener("change", apply);
  dom.depictionRelayout.addEventListener("change", apply);
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
function withTitle(
  svg: string,
  title: string,
  fitTo?: { width: number; height: number },
): string {
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
  // RDKit's auto-sized ACS drawing carries its own viewBox; the canvas sets its display size.
  if (fitTo !== undefined) {
    const viewBox = root.getAttribute("viewBox");
    if (viewBox === null) {
      const naturalWidth = Number.parseFloat(root.getAttribute("width") ?? "");
      const naturalHeight = Number.parseFloat(root.getAttribute("height") ?? "");
      if (naturalWidth > 0 && naturalHeight > 0) {
        root.setAttribute("viewBox", `0 0 ${naturalWidth} ${naturalHeight}`);
      }
    }
    if (root.getAttribute("viewBox") !== null) {
      root.setAttribute("width", `${fitTo.width}px`);
      root.setAttribute("height", `${fitTo.height}px`);
    }
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
  const canvas = { width: DEPICTION_WIDTH, height: DEPICTION_HEIGHT };
  const fitTo = settings.acs1996 ? canvas : undefined;
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
        acs1996: settings.acs1996,
        relayout: settings.relayout,
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
      return { depiction: { svg: withTitle(svg, title, fitTo), engine: "rdkit" }, error: null };
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
  const changed = shownSvg !== svg;
  shownSvg = svg;
  attachDepictionZoom(host, changed);
}

export function clearDepiction(host: HTMLElement): void {
  shownSvg = null;
  detachDepictionZoom();
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
