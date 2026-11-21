/**
 * Shared page state and DOM handles.
 *
 * Every module reads the same `state` and the same element map from here, so a control in
 * one module can update a figure rendered by another without passing a dozen references.
 */

import { commonsFileName } from "../pkg/molplate_wasm.js";
import type { Depiction } from "./depiction.js";
import type { Compound } from "./pubchem.js";
import type { Appearance, Renderer } from "./renderer.js";
import type { SourceStatus } from "./sources.js";

/** Mirrors `molplate_core::style::Look`. */
export interface Look {
  id: string;
  label: string;
  style: string;
  color_mode: string;
  material: string | null;
  line_width: number | null;
  appearance: Appearance;
}

export type TabId = "drugbox" | "chembox" | "commons";
export type StructureKindId = "two_d" | "three_d" | "protein";
export type ViewMode = "3d" | "2d";

export const dom = {
  form: required<HTMLFormElement>("lookup"),
  identifier: required<HTMLInputElement>("identifier"),
  loadButton: required<HTMLButtonElement>("load"),
  summary: required<HTMLDListElement>("summary"),
  looks: required<HTMLDivElement>("looks"),
  background: required<HTMLInputElement>("background"),
  gradient: required<HTMLSelectElement>("gradient"),
  gradientBottom: required<HTMLInputElement>("gradient-bottom"),
  stickRadius: required<HTMLInputElement>("stick-radius"),
  stickRadiusValue: required<HTMLOutputElement>("stick-radius-value"),
  sphereScale: required<HTMLInputElement>("sphere-scale"),
  sphereScaleValue: required<HTMLOutputElement>("sphere-scale-value"),
  transparency: required<HTMLInputElement>("transparency"),
  transparencyValue: required<HTMLOutputElement>("transparency-value"),
  ambient: required<HTMLInputElement>("ambient"),
  ambientValue: required<HTMLOutputElement>("ambient-value"),
  direct: required<HTMLInputElement>("direct"),
  directValue: required<HTMLOutputElement>("direct-value"),
  specular: required<HTMLInputElement>("specular"),
  specularValue: required<HTMLOutputElement>("specular-value"),
  ambientOcclusion: required<HTMLInputElement>("ambient-occlusion"),
  silhouettes: required<HTMLInputElement>("silhouettes"),
  depthCue: required<HTMLInputElement>("depth-cue"),
  elementColors: required<HTMLDivElement>("element-colors"),
  resetColors: required<HTMLButtonElement>("reset-colors"),
  projection: required<HTMLSelectElement>("projection"),
  frame: required<HTMLButtonElement>("frame"),
  zoomIn: required<HTMLButtonElement>("zoom-in"),
  zoomOut: required<HTMLButtonElement>("zoom-out"),
  exportWidth: required<HTMLSelectElement>("export-width"),
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
  engine: required<HTMLElement>("engine"),
  shortcuts: required<HTMLDetailsElement>("shortcuts"),
  tabs: {
    drugbox: required<HTMLButtonElement>("tab-drugbox"),
    chembox: required<HTMLButtonElement>("tab-chembox"),
    commons: required<HTMLButtonElement>("tab-commons"),
  },
  fileName: required<HTMLElement>("file-name"),
  copy: required<HTMLButtonElement>("copy"),
  wikitext: required<HTMLElement>("wikitext"),
  upload: required<HTMLAnchorElement>("upload"),
};

export interface AppState {
  viewer: Renderer | null;
  looks: Look[];
  compound: Compound | null;
  look: Look | null;
  tab: TabId;
  compoundJson: string;
  mode: ViewMode;
  depiction: Depiction | null;
  protein: { id: string; atoms: number; residues: number; chains: number; seconds: number } | null;
  sources: SourceStatus[];
}

export const state: AppState = {
  viewer: null,
  looks: [],
  compound: null,
  look: null,
  tab: "drugbox",
  compoundJson: "{}",
  mode: "3d",
  depiction: null,
  protein: null,
  sources: [],
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
  dom.stageMessage.classList.remove("busy");
  dom.stageMessage.hidden = false;
  dom.stageMessage.classList.add("error");
  dom.stageText.textContent =
    detail === undefined ? message : `${message} (${describe(detail)})`;
  setStatus("The renderer is unavailable, so images cannot be produced. The markup tabs still work.", true);
  dom.exportButton.disabled = true;
}
