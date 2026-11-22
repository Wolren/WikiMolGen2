/**
 * Shared page state and DOM handles.
 *
 * Every module reads the same `state` and the same element map from here, so a control in
 * one module can update a figure rendered by another without passing a dozen references.
 */

import { commonsFileName } from "../pkg/wikimolgen2_wasm.js";
import type { Depiction } from "./depiction.js";
import type { Compound } from "./pubchem.js";
import type { Appearance, Renderer } from "./renderer.js";

/** Mirrors `wikimolgen2_core::style::Look`. */
export interface Look {
  id: string;
  label: string;
  style: string;
  color_mode: string;
  material: string | null;
  line_width: number | null;
  appearance: Appearance;
}

/** Mirrors `wikimolgen2_core::palette::SchemeInfo`: one entry in the palette picker. */
export interface ColorSchemeInfo {
  id: string;
  label: string;
  description: string;
  /** Flat stick ink the scheme expects, or `null` for sticks that follow the atoms. */
  stick_color: string | null;
}

/**
 * A copy of a preset for the live look.
 *
 * The panel edits the live look in place. Handing it the preset object would write every
 * slider back into the preset list, so switching away and back would never reset.
 */
export function cloneLook(look: Look): Look {
  return JSON.parse(JSON.stringify(look)) as Look;
}

export type StructureKindId = "two_d" | "three_d" | "protein";

/** The normalised camera presets, plus custom angles and the free camera. */
export type OrientationPreset = "free" | "wiki" | "front" | "side" | "top" | "custom";

/** A camera orientation: a preset name, or the angles a custom preset uses. */
export interface Orientation {
  preset: OrientationPreset;
  x: number;
  y: number;
  z: number;
}
export type ViewMode = "3d" | "2d";

export const dom = {
  form: required<HTMLFormElement>("lookup"),
  identifier: required<HTMLInputElement>("identifier"),
  loadButton: required<HTMLButtonElement>("load"),
  looks: required<HTMLDivElement>("looks"),
  colorMode: required<HTMLSelectElement>("color-mode"),
  colourControls: required<HTMLElement>("colour-controls"),
  colourNote: required<HTMLElement>("colour-note"),
  moleculeColour: required<HTMLElement>("molecule-colour"),
  colorScheme: required<HTMLSelectElement>("color-scheme"),
  schemeNote: required<HTMLParagraphElement>("scheme-note"),
  solidColor: required<HTMLInputElement>("solid-color"),
  solidColorControl: required<HTMLElement>("solid-color-control"),
  helixColor: required<HTMLInputElement>("helix-color"),
  sheetColor: required<HTMLInputElement>("sheet-color"),
  loopColor: required<HTMLInputElement>("loop-color"),
  secstructColorControl: required<HTMLElement>("secstruct-color-control"),
  stickColorMode: required<HTMLSelectElement>("stick-color-mode"),
  stickColor: required<HTMLInputElement>("stick-color"),
  stickColorControl: required<HTMLElement>("stick-color-control"),
  background: required<HTMLInputElement>("background"),
  gradient: required<HTMLSelectElement>("gradient"),
  gradientBottom: required<HTMLInputElement>("gradient-bottom"),
  stickRadius: required<HTMLInputElement>("stick-radius"),
  stickRadiusValue: required<HTMLOutputElement>("stick-radius-value"),
  sphereScale: required<HTMLInputElement>("sphere-scale"),
  sphereScaleValue: required<HTMLOutputElement>("sphere-scale-value"),
  valence: required<HTMLInputElement>("valence"),
  valenceScale: required<HTMLInputElement>("valence-scale"),
  valenceScaleValue: required<HTMLOutputElement>("valence-scale-value"),
  stickTransparency: required<HTMLInputElement>("stick-transparency"),
  stickTransparencyValue: required<HTMLOutputElement>("stick-transparency-value"),
  sphereTransparency: required<HTMLInputElement>("sphere-transparency"),
  sphereTransparencyValue: required<HTMLOutputElement>("sphere-transparency-value"),
  cartoonTransparency: required<HTMLInputElement>("cartoon-transparency"),
  cartoonTransparencyValue: required<HTMLOutputElement>("cartoon-transparency-value"),
  transparencyMode: required<HTMLSelectElement>("transparency-mode"),
  antialias: required<HTMLInputElement>("antialias"),
  ambient: required<HTMLInputElement>("ambient"),
  ambientValue: required<HTMLOutputElement>("ambient-value"),
  direct: required<HTMLInputElement>("direct"),
  directValue: required<HTMLOutputElement>("direct-value"),
  specular: required<HTMLInputElement>("specular"),
  specularValue: required<HTMLOutputElement>("specular-value"),
  reflect: required<HTMLInputElement>("reflect"),
  reflectValue: required<HTMLOutputElement>("reflect-value"),
  shininess: required<HTMLInputElement>("shininess"),
  shininessValue: required<HTMLOutputElement>("shininess-value"),
  ambientOcclusion: required<HTMLInputElement>("ambient-occlusion"),
  aoStrength: required<HTMLInputElement>("ao-strength"),
  aoStrengthValue: required<HTMLOutputElement>("ao-strength-value"),
  aoRadius: required<HTMLInputElement>("ao-radius"),
  aoRadiusValue: required<HTMLOutputElement>("ao-radius-value"),
  shadows: required<HTMLInputElement>("shadows"),
  shadowStrength: required<HTMLInputElement>("shadow-strength"),
  shadowStrengthValue: required<HTMLOutputElement>("shadow-strength-value"),
  silhouettes: required<HTMLInputElement>("silhouettes"),
  outlineWidth: required<HTMLInputElement>("outline-width"),
  outlineWidthValue: required<HTMLOutputElement>("outline-width-value"),
  depthCue: required<HTMLInputElement>("depth-cue"),
  fog: required<HTMLInputElement>("fog"),
  fogValue: required<HTMLOutputElement>("fog-value"),
  fogStart: required<HTMLInputElement>("fog-start"),
  fogStartValue: required<HTMLOutputElement>("fog-start-value"),
  elementColors: required<HTMLDivElement>("element-colors"),
  resetColors: required<HTMLButtonElement>("reset-colors"),
  projection: required<HTMLSelectElement>("projection"),
  frame: required<HTMLButtonElement>("frame"),
  settingsPreset: required<HTMLSelectElement>("settings-preset"),
  presetSave: required<HTMLButtonElement>("preset-save"),
  presetRename: required<HTMLButtonElement>("preset-rename"),
  presetNameRow: required<HTMLElement>("preset-name-row"),
  presetName: required<HTMLInputElement>("preset-name"),
  presetNameSave: required<HTMLButtonElement>("preset-name-save"),
  presetNameCancel: required<HTMLButtonElement>("preset-name-cancel"),
  presetDelete: required<HTMLButtonElement>("preset-delete"),
  settingsPresetNote: required<HTMLParagraphElement>("settings-preset-note"),
  orientation: required<HTMLSelectElement>("orientation"),
  orientationCustom: required<HTMLElement>("orientation-custom"),
  rotationX: required<HTMLInputElement>("rotation-x"),
  rotationY: required<HTMLInputElement>("rotation-y"),
  rotationZ: required<HTMLInputElement>("rotation-z"),
  zoomSelection: required<HTMLInputElement>("zoom-selection"),
  zoomSelectionGo: required<HTMLButtonElement>("zoom-selection-go"),
  zoomIn: required<HTMLButtonElement>("zoom-in"),
  zoomOut: required<HTMLButtonElement>("zoom-out"),
  exportWidth: required<HTMLInputElement>("export-width"),
  exportQuality: required<HTMLSelectElement>("export-quality"),
  exportMargin: required<HTMLInputElement>("export-margin"),
  exportMarginValue: required<HTMLOutputElement>("export-margin-value"),
  exportTransparent: required<HTMLInputElement>("export-transparent"),
  exportLabels: required<HTMLInputElement>("export-labels"),
  exportScaleBar: required<HTMLInputElement>("export-scalebar"),
  exportButton: required<HTMLButtonElement>("export"),
  exportStatus: required<HTMLParagraphElement>("export-status"),
  viewerHost: required<HTMLElement>("viewer"),
  depiction: required<HTMLDivElement>("depiction"),
  mode3d: required<HTMLButtonElement>("mode-3d"),
  mode2d: required<HTMLButtonElement>("mode-2d"),
  stageNote: required<HTMLElement>("stage-note"),
  stageMessage: required<HTMLDivElement>("stage-message"),
  stageText: required<HTMLParagraphElement>("stage-text"),
  fullscreen: required<HTMLButtonElement>("fullscreen"),
  shortcuts: required<HTMLDetailsElement>("shortcuts"),
  suggestions: required<HTMLDivElement>("suggestions"),
  lookupHint: required<HTMLParagraphElement>("lookup-hint"),
  batchOpen: required<HTMLButtonElement>("batch-open"),
  batchDialog: required<HTMLDialogElement>("batch"),
  batchInput: required<HTMLTextAreaElement>("batch-input"),
  batchRun: required<HTMLButtonElement>("batch-run"),
  batchClose: required<HTMLButtonElement>("batch-close"),
  batchList: required<HTMLUListElement>("batch-list"),

  fileName: required<HTMLElement>("file-name"),
  copyDrugbox: required<HTMLButtonElement>("copy-drugbox"),
  copyChembox: required<HTMLButtonElement>("copy-chembox"),
  copyCommons: required<HTMLButtonElement>("copy-commons"),
  outputDrugbox: required<HTMLElement>("wikitext-drugbox"),
  outputChembox: required<HTMLElement>("wikitext-chembox"),
  outputCommons: required<HTMLElement>("wikitext-commons"),
  blockDrugbox: required<HTMLElement>("block-drugbox"),
  blockChembox: required<HTMLElement>("block-chembox"),
  uploadCommons: required<HTMLAnchorElement>("upload-commons"),
};

export interface AppState {
  viewer: Renderer | null;
  looks: Look[];
  /** Element palettes for the colour picker, in the order Rust lists them. */
  schemes: ColorSchemeInfo[];
  compound: Compound | null;
  look: Look | null;
  compoundJson: string;
  mode: ViewMode;
  /** The flat record waiting for the 2D engine. `null` for a protein or a missing record. */
  depictionSource: { name: string; bytes: Uint8Array } | null;
  depiction: Depiction | null;
  protein: { id: string; atoms: number; residues: number; chains: number; seconds: number } | null;
  orientation: Orientation;
}

export const state: AppState = {
  viewer: null,
  looks: [],
  schemes: [],
  compound: null,
  look: null,
  compoundJson: "{}",
  mode: "3d",
  depictionSource: null,
  depiction: null,
  protein: null,
  orientation: { preset: "free", x: 10, y: 20, z: 0 },
};

export function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`index.html is missing #${id}`);
  return node as T;
}

export function setStatus(message: string, isError = false): void {
  dom.exportStatus.textContent = message;
  dom.exportStatus.style.color = isError ? "#a3231b" : "";
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hexToBytes(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** Which image the markup describes: the flat drawing, the 3D render or a protein. */
export function structureKind(): StructureKindId {
  if (state.protein !== null) return "protein";
  return state.mode === "2d" ? "two_d" : "three_d";
}

/** The Commons file name for a kind. A 2D figure is vector, so it ends in `.svg`. */
export function figureName(kind: StructureKindId): string {
  const png = commonsFileName(state.compoundJson, kind);
  return kind === "two_d" ? png.replace(/\.png$/, ".svg") : png;
}

/** The overlay says the renderer is unusable; nothing should overwrite it. */
let rendererFailed = false;

/** Whether the 3D viewer failed, so the page knows what still works. */
export function isRendererFailed(): boolean {
  return rendererFailed;
}

/** Show the stage overlay for a slow step, or clear it when the step ends. */
export function setBusy(busy: boolean, message?: string): void {
  dom.loadButton.disabled = busy;
  dom.stageMessage.classList.toggle("busy", busy);
  dom.stageMessage.classList.remove("empty");
  if (busy && message !== undefined && !rendererFailed) {
    dom.stageMessage.hidden = false;
    dom.stageText.textContent = message;
  } else if (!busy && !rendererFailed && state.viewer !== null) {
    dom.stageMessage.hidden = true;
  }
}

/**
 * Say why there is no viewer and disable what needs one.
 *
 * `detail` is appended when there is a low-level message worth reading; a
 * `RendererUnavailable` already carries the sentence to show.
 */
export function showStageError(message: string, detail?: unknown): void {
  rendererFailed = true;
  dom.stageMessage.classList.remove("busy", "empty");
  dom.stageMessage.hidden = false;
  dom.stageMessage.classList.add("error");
  dom.stageText.textContent =
    detail === undefined ? message : `${message} (${describe(detail)})`;
  setStatus("The renderer is unavailable, so images cannot be produced. The markup tabs still work.", true);
  dom.exportButton.disabled = true;
}
