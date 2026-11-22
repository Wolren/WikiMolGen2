/**
 * Shared page state and DOM handles.
 *
 * Every module reads the same `state` and the same element map from here, so a control in
 * one module can update a figure rendered by another without passing a dozen references.
 */

import { commonsFileName, figureFileName } from "../pkg/wikimolgen2_wasm.js";
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

/** The 2D drawing options, kept apart from the 3D appearance. */
export interface DepictionSettings {
  /** Draw every atom in black, for a print or high-contrast figure. */
  monochrome: boolean;
  /** Bond line width in drawing units; 0 keeps RDKit's default. */
  bondWidth: number;
  /** Fixed atom label size in drawing units; 0 keeps RDKit's scaling. */
  labelSize: number;
  /** Show R/S labels beside the stereo centres. */
  stereo: boolean;
  /** Show unpaired-electron dots. */
  radicals: boolean;
  /** Show the chiral flag. */
  chiralFlag: boolean;
  /** Show atom map numbers. */
  atomTags: boolean;
  /** Hide every atom label, for a skeleton-only figure. */
  hideLabels: boolean;
  /** Draw the methyl carbon and its hydrogens explicitly. */
  explicitMethyl: boolean;
  /** RDKit's hand-drawn comic style. */
  comic: boolean;
  /** A line of text under the drawing; empty for none. */
  legend: string;
  /** Atom indices to highlight, as typed; empty for none. */
  highlightAtoms: string;
  /** Bond indices to highlight, as typed; empty for none. */
  highlightBonds: string;
  /** The highlight ink, `#rrggbb`. */
  highlightColor: string;
  /** Turn the drawing, in degrees; 0 keeps RDKit's layout. */
  rotate: number;
  /** Fixed bond length in drawing units; 0 keeps RDKit's scaling. */
  bondLength: number;
  /** Page padding as a fraction; 0 keeps RDKit's default. */
  padding: number;
  /** Extra label padding as a fraction; 0 keeps RDKit's default. */
  labelPadding: number;
  /** Distance between multiple bond lines; 0 keeps RDKit's default. */
  bondOffset: number;
}

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
  appearanceSection: required<HTMLElement>("section-appearance"),
  viewSection: required<HTMLElement>("section-view"),
  settingsPreset: required<HTMLSelectElement>("settings-preset"),
  presetSave: required<HTMLButtonElement>("preset-save"),
  presetRename: required<HTMLButtonElement>("preset-rename"),
  presetNameRow: required<HTMLElement>("preset-name-row"),
  presetName: required<HTMLInputElement>("preset-name"),
  presetNameSave: required<HTMLButtonElement>("preset-name-save"),
  presetNameCancel: required<HTMLButtonElement>("preset-name-cancel"),
  appearanceResetOpen: required<HTMLButtonElement>("appearance-reset-open"),
  appearanceResetConfirm: required<HTMLElement>("appearance-reset-confirm"),
  appearanceResetQuestion: required<HTMLElement>("appearance-reset-question"),
  appearanceResetYes: required<HTMLButtonElement>("appearance-reset-yes"),
  appearanceResetCancel: required<HTMLButtonElement>("appearance-reset-cancel"),
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
  depictionControls: required<HTMLElement>("depiction-controls"),
  depictionMonochrome: required<HTMLInputElement>("depiction-monochrome"),
  depictionBondWidth: required<HTMLInputElement>("depiction-bond-width"),
  depictionBondWidthValue: required<HTMLOutputElement>("depiction-bond-width-value"),
  depictionLabelSize: required<HTMLInputElement>("depiction-label-size"),
  depictionLabelSizeValue: required<HTMLOutputElement>("depiction-label-size-value"),
  depictionStereo: required<HTMLInputElement>("depiction-stereo"),
  depictionRadicals: required<HTMLInputElement>("depiction-radicals"),
  depictionChiral: required<HTMLInputElement>("depiction-chiral"),
  depictionAtomTags: required<HTMLInputElement>("depiction-atom-tags"),
  depictionHideLabels: required<HTMLInputElement>("depiction-hide-labels"),
  depictionExplicitMethyl: required<HTMLInputElement>("depiction-explicit-methyl"),
  depictionComic: required<HTMLInputElement>("depiction-comic"),
  depictionLegend: required<HTMLInputElement>("depiction-legend"),
  depictionHighlightAtoms: required<HTMLInputElement>("depiction-highlight-atoms"),
  depictionHighlightBonds: required<HTMLInputElement>("depiction-highlight-bonds"),
  depictionHighlightColor: required<HTMLInputElement>("depiction-highlight-color"),
  depictionRotate: required<HTMLInputElement>("depiction-rotate"),
  depictionRotateValue: required<HTMLOutputElement>("depiction-rotate-value"),
  depictionBondLength: required<HTMLInputElement>("depiction-bond-length"),
  depictionBondLengthValue: required<HTMLOutputElement>("depiction-bond-length-value"),
  depictionPadding: required<HTMLInputElement>("depiction-padding"),
  depictionPaddingValue: required<HTMLOutputElement>("depiction-padding-value"),
  depictionLabelPadding: required<HTMLInputElement>("depiction-label-padding"),
  depictionLabelPaddingValue: required<HTMLOutputElement>("depiction-label-padding-value"),
  depictionBondOffset: required<HTMLInputElement>("depiction-bond-offset"),
  depictionBondOffsetValue: required<HTMLOutputElement>("depiction-bond-offset-value"),
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
  batchCancel: required<HTMLButtonElement>("batch-cancel"),
  batchClose: required<HTMLButtonElement>("batch-close"),
  batchProgressRow: required<HTMLElement>("batch-progress-row"),
  batchProgress: required<HTMLElement>("batch-progress"),
  batchProgressBar: required<HTMLProgressElement>("batch-progress-bar"),
  batchList: required<HTMLUListElement>("batch-list"),

  fileName: required<HTMLInputElement>("file-name"),
  fileNameReset: required<HTMLButtonElement>("file-name-reset"),
  commonsAuthor: required<HTMLInputElement>("commons-author"),
  commonsLicense: required<HTMLSelectElement>("commons-license"),
  commonsCustomField: required<HTMLElement>("commons-custom-field"),
  commonsLicenseCustom: required<HTMLInputElement>("commons-license-custom"),
  commonsLicenseNote: required<HTMLParagraphElement>("commons-license-note"),
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

/** A name typed into the file-name field, with the generated name it replaced. */
export interface TypedName {
  generated: string;
  text: string;
}

export interface AppState {
  viewer: Renderer | null;
  looks: Look[];
  /** Element palettes for the colour picker, in the order Rust lists them. */
  schemes: ColorSchemeInfo[];
  compound: Compound | null;
  look: Look | null;
  compoundJson: string;
  mode: ViewMode;
  /** The typed Commons name, kept only while the figure it was typed for is on stage. */
  typedName: TypedName | null;
  /** The flat record waiting for the 2D engine. `null` for a protein or a missing record. */
  depictionSource: { name: string; bytes: Uint8Array } | null;
  depiction: Depiction | null;
  depictionSettings: DepictionSettings;
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
  typedName: null,
  depictionSource: null,
  depiction: null,
  depictionSettings: {
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
  },
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

/** Reject if `promise` has not settled within `ms`, so a stuck backend is visible. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
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

/** The generated Commons file name for a kind. A 2D figure is vector, so it ends in `.svg`. */
export function figureName(kind: StructureKindId): string {
  return commonsFileName(state.compoundJson, kind);
}

/**
 * The name the next download and the markup use.
 *
 * A typed name wins only while the figure it was typed for is still on the stage, so a new
 * load or a view switch goes back to the generated name without anyone clearing it.
 */
export function exportName(kind: StructureKindId): string {
  const generated = figureName(kind);
  const typed = state.typedName;
  if (typed === null || typed.generated !== generated) return generated;
  return figureFileName(state.compoundJson, kind, typed.text);
}

/** Remember what the file-name field holds. Empty text gives the generated name back. */
export function setTypedName(text: string): void {
  state.typedName = text.trim() === "" ? null : { generated: figureName(structureKind()), text };
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
