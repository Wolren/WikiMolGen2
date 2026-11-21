/**
 * Page controller: look a compound up, render it, and turn it into Wikipedia or
 * Commons markup.
 *
 * The renderer is patinae, reached only through `renderer.ts`; everything else here is
 * DOM. The Rust side is authoritative for presets, figure framing and markup, so the page
 * asks it for the look list and for every generated string instead of duplicating those
 * rules here.
 */

import init, {
  chembox,
  commonsFileName,
  commonsInformation,
  commonsUploadUrl,
  defaultLicense,
  drugbox,
  elementColor,
  frameFigure,
  looksJson,
  resizePng,
} from "../pkg/molplate_wasm.js";
import {
  buildDepiction,
  clearDepiction,
  depictionBytes,
  downloadSvg,
  showDepiction,
  type Depiction,
} from "./depiction.js";
import { LookupError, loadCompound, type Compound } from "./pubchem.js";
import { Renderer, RendererUnavailable, type Appearance, type ElementColor } from "./renderer.js";
import "./styles.css";

/** Mirrors `molplate_core::style::Look`. */
interface Look {
  id: string;
  label: string;
  style: string;
  color_mode: string;
  material: string | null;
  line_width: number | null;
  appearance: Appearance;
}

type TabId = "drugbox" | "chembox" | "commons";
type StructureKindId = "two_d" | "three_d" | "protein";
type ViewMode = "3d" | "2d";

const AUTHOR = "molplate";
/** Margin around a figure, as a fraction of the molecule's longer side. */
const FIGURE_MARGIN = 0.06;
/**
 * Render this many times wider than the figure and scale down in Rust.
 *
 * patinae's browser build antialiases with FXAA and nothing else, no MSAA, and its
 * supersampling setting is declared but unused, so an atom silhouette is about one hard
 * pixel. Rendering at 2× widens the edge gradient about threefold; 3× adds nothing.
 */
const SUPERSAMPLE = 2;

const dom = {
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
  exportTransparent: required<HTMLInputElement>("export-transparent"),
  exportButton: required<HTMLButtonElement>("export"),
  exportStatus: required<HTMLParagraphElement>("export-status"),
  viewerHost: required<HTMLElement>("viewer"),
  depiction: required<HTMLDivElement>("depiction"),
  mode3d: required<HTMLButtonElement>("mode-3d"),
  mode2d: required<HTMLButtonElement>("mode-2d"),
  stageNote: required<HTMLElement>("stage-note"),
  stageMessage: required<HTMLDivElement>("stage-message"),
  engine: required<HTMLElement>("engine"),
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

const state: {
  viewer: Renderer | null;
  looks: Look[];
  compound: Compound | null;
  look: Look | null;
  tab: TabId;
  compoundJson: string;
  mode: ViewMode;
  depiction: Depiction | null;
} = {
  viewer: null,
  looks: [],
  compound: null,
  look: null,
  tab: "drugbox",
  compoundJson: "{}",
  mode: "3d",
  depiction: null,
};

/** The markup currently shown, for the copy button. */
let currentText = "";

function required<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`index.html is missing #${id}`);
  return node as T;
}

async function boot(): Promise<void> {
  // The module must be initialised before *any* export is called, including the
  // preset list, which is generated in Rust.
  try {
    await init();
  } catch (error) {
    showStageError("The WebAssembly module failed to load.", error);
    return;
  }

  state.looks = JSON.parse(looksJson()) as Look[];
  // Presets need no GPU, so they are shown even if the renderer cannot start.
  renderLooks();

  try {
    state.viewer = await withTimeout(
      Renderer.create(dom.viewerHost),
      30_000,
      "The renderer did not finish starting.",
    );
  } catch (error) {
    // RendererUnavailable already carries a sentence a user can act on; anything else
    // is a surprise and gets the generic line plus the detail.
    if (error instanceof RendererUnavailable) {
      showStageError(error.message);
    } else {
      showStageError("This app renders with WebGPU, and the renderer did not start.", error);
    }
    return;
  }

  dom.stageMessage.hidden = true;

  // `Renderer.create` already paints the stage white, which is what a figure wants.

  // patinae is WebGPU-only: there is no second backend to report. The badge says what
  // is in use, and the note explains what a figure needs, rather than implying a
  // fallback that does not exist.
  dom.engine.textContent = "WebGPU";
  applyMode();
}

// --- Compound lookup ---------------------------------------------------------------

dom.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadFromInput();
});

async function loadFromInput(): Promise<void> {
  const identifier = dom.identifier.value.trim();
  if (identifier === "") {
    dom.identifier.focus();
    return;
  }

  setBusy(true, "Looking up…");
  try {
    const result = await loadCompound(identifier);
    state.compound = result.compound;
    state.compoundJson = JSON.stringify(result.compound);

    // The markup does not need a renderer: looking a compound up and generating wikitext
    // is the half of this app that works without a GPU, so a failed renderer must not
    // take it down with it.
    if (state.viewer !== null) {
      await state.viewer.loadStructure(result.structure.name, result.structure.bytes);
      state.look = state.looks[0] ?? null;
      if (state.look !== null) await state.viewer.applyLook(appliedLook() ?? state.look);
      await state.viewer.frameScene();
      dom.exportButton.disabled = false;
    }

    // The 2D drawing comes from the flat record, so it works even when there is no 3D
    // viewer. It is built once per load and then shown or hidden by the mode switch.
    state.depiction = null;
    if (result.depiction !== null) {
      const built = buildDepiction(result.compound.name ?? identifier, result.depiction.bytes);
      state.depiction = built.depiction;
      if (built.error !== null) result.warnings.push(`No 2D drawing: ${built.error}`);
    } else {
      result.warnings.push("PubChem has no flat record for this compound, so 2D is unavailable.");
    }
    dom.mode2d.disabled = state.depiction === null;
    if (state.mode === "2d" && state.depiction === null) state.mode = "3d";

    renderLooks();
    renderSummary(result.warnings);
    applyMode();
    syncAppearance();
    setStatus(result.warnings.join(" "));
  } catch (error) {
    if (error instanceof LookupError) {
      setStatus(error.message, true);
    } else {
      setStatus(`Could not load the compound: ${describe(error)}`, true);
    }
  } finally {
    setBusy(false);
  }
}

function renderSummary(warnings: string[]): void {
  const compound = state.compound;
  if (compound === null) return;

  const rows: [string, string | undefined][] = [
    ["Name", compound.name],
    ["PubChem CID", compound.cid === undefined ? undefined : String(compound.cid)],
    ["Formula", compound.molecular_formula],
    ["Mass", compound.molecular_weight === undefined ? undefined : `${compound.molecular_weight} g/mol`],
    ["SMILES", compound.smiles],
  ];

  dom.summary.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      if (value === undefined) return [];
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value;
      if (label === "SMILES") detail.style.wordBreak = "break-all";
      return [term, detail];
    }),
  );
  dom.summary.hidden = false;

  // A second lookup replaces the notes too; left in place they would pile up.
  for (const old of document.querySelectorAll(".summary-note")) old.remove();
  for (const warning of warnings) {
    const note = document.createElement("p");
    note.className = "hint summary-note";
    note.textContent = warning;
    dom.summary.after(note);
  }
}

// --- Style, appearance, camera ------------------------------------------------------

function renderLooks(): void {
  dom.looks.replaceChildren(
    ...state.looks.map((look) => {
      const label = document.createElement("label");
      label.className = "look";
      label.setAttribute("role", "radio");
      const checked = state.look?.id === look.id;
      label.setAttribute("aria-checked", String(checked));

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "look";
      input.value = look.id;
      input.checked = checked;
      input.addEventListener("change", () => void chooseLook(look));

      const text = document.createElement("span");
      text.textContent = look.label;

      label.append(input, text);
      return label;
    }),
  );
}

async function chooseLook(look: Look): Promise<void> {
  state.look = look;
  renderLooks();
  syncAppearance();
  // Nothing to re-style before a structure is loaded, and patinae treats a command
  // against an empty scene as an error rather than a no-op.
  if (state.viewer === null || state.compound === null) return;
  try {
    await state.viewer.applyLook(appliedLook() ?? look);
    await state.viewer.frameScene();
  } catch (error) {
    setStatus(`Could not apply “${look.label}”: ${describe(error)}`, true);
  }
}

// --- View mode ---------------------------------------------------------------------

/** Which image the markup describes: the flat drawing or the 3D render. */
function structureKind(): StructureKindId {
  return state.mode === "2d" ? "two_d" : "three_d";
}

/** The Commons file name for a kind. A 2D figure is vector, so it ends in `.svg`. */
function figureName(kind: StructureKindId): string {
  const png = commonsFileName(state.compoundJson, kind);
  return kind === "two_d" ? png.replace(/\.png$/, ".svg") : png;
}

/** Swap the stage between the 3D viewer and the inline drawing. */
function applyMode(): void {
  const twoDimensional = state.mode === "2d";
  dom.mode3d.setAttribute("aria-selected", String(!twoDimensional));
  dom.mode2d.setAttribute("aria-selected", String(twoDimensional));
  dom.viewerHost.hidden = twoDimensional;
  dom.depiction.hidden = !twoDimensional;

  if (twoDimensional) {
    if (state.depiction !== null) {
      showDepiction(dom.depiction, state.depiction.svg);
      dom.stageNote.textContent = "Vector skeletal drawing";
    } else {
      clearDepiction(dom.depiction);
      dom.depiction.textContent = "Load a compound to see its 2D drawing.";
      dom.stageNote.textContent = "";
    }
  } else {
    dom.stageNote.textContent = "";
  }

  dom.exportButton.textContent = twoDimensional ? "Download SVG" : "Download PNG";
  refreshOutput();
}

dom.mode3d.addEventListener("click", () => {
  state.mode = "3d";
  applyMode();
});

dom.mode2d.addEventListener("click", () => {
  if (dom.mode2d.disabled) return;
  state.mode = "2d";
  applyMode();
});

// --- Appearance controls ------------------------------------------------------------

/** Apply appearance changes once per frame, not once per input event. */
let applyScheduled = false;

/**
 * The look with overrides reduced to elements the structure has.
 *
 * An override for an absent element makes patinae log "0 atoms colored", so a look that
 * names common elements is filtered to the current molecule first.
 */
function appliedLook(): Look | null {
  const look = state.look;
  if (look === null) return null;
  const present = new Set(elementsOf(state.compound));
  if (present.size === 0) return look;
  return {
    ...look,
    appearance: {
      ...look.appearance,
      element_colors: look.appearance.element_colors.filter((entry) => present.has(entry.element)),
    },
  };
}

function scheduleApply(): void {
  if (applyScheduled) return;
  applyScheduled = true;
  requestAnimationFrame(() => {
    applyScheduled = false;
    const look = appliedLook();
    if (state.viewer === null || state.compound === null || look === null) return;
    void state.viewer.applyAppearance(look).catch((error) => {
      setStatus(`Could not update the look: ${describe(error)}`, true);
    });
  });
}

/** Copy the current look into the controls. */
function syncAppearance(): void {
  const look = state.look;
  if (look === null) return;
  const appearance = look.appearance;
  dom.background.value = appearance.background;
  dom.gradient.value = appearance.gradient === null ? "none" : "vertical";
  dom.gradientBottom.hidden = appearance.gradient === null;
  dom.gradientBottom.value = appearance.gradient?.[1] ?? "#dfe7f2";
  dom.stickRadius.value = String(appearance.stick_radius);
  dom.sphereScale.value = String(appearance.sphere_scale);
  const transparency = Math.max(
    appearance.stick_transparency,
    appearance.sphere_transparency,
    appearance.cartoon_transparency,
  );
  dom.transparency.value = String(transparency);
  dom.ambient.value = String(appearance.ambient);
  dom.direct.value = String(appearance.direct);
  dom.specular.value = String(appearance.specular);
  dom.ambientOcclusion.checked = appearance.ambient_occlusion;
  dom.silhouettes.checked = appearance.silhouettes;
  dom.depthCue.checked = appearance.depth_cue;
  syncOutputs();
  renderElementColors();
}

/** Update the numeric readouts without rebuilding the element chips. */
function syncOutputs(): void {
  const look = state.look;
  if (look === null) return;
  const appearance = look.appearance;
  dom.stickRadiusValue.textContent = appearance.stick_radius.toFixed(2);
  dom.sphereScaleValue.textContent = appearance.sphere_scale.toFixed(2);
  dom.ambientValue.textContent = appearance.ambient.toFixed(2);
  dom.directValue.textContent = appearance.direct.toFixed(2);
  dom.specularValue.textContent = appearance.specular.toFixed(2);
  const transparency = Math.max(
    appearance.stick_transparency,
    appearance.sphere_transparency,
    appearance.cartoon_transparency,
  );
  dom.transparencyValue.textContent = `${Math.round(transparency * 100)}%`;
}

/** Read every control into the current look. */
function readAppearance(): void {
  const look = state.look;
  if (look === null) return;
  const appearance = look.appearance;
  appearance.background = dom.background.value;
  appearance.gradient =
    dom.gradient.value === "vertical" ? [appearance.background, dom.gradientBottom.value] : null;
  appearance.stick_radius = Number(dom.stickRadius.value);
  appearance.sphere_scale = Number(dom.sphereScale.value);
  const transparency = Number(dom.transparency.value);
  appearance.stick_transparency = transparency;
  appearance.sphere_transparency = transparency;
  appearance.cartoon_transparency = transparency;
  appearance.ambient = Number(dom.ambient.value);
  appearance.direct = Number(dom.direct.value);
  appearance.specular = Number(dom.specular.value);
  appearance.ambient_occlusion = dom.ambientOcclusion.checked;
  appearance.silhouettes = dom.silhouettes.checked;
  appearance.depth_cue = dom.depthCue.checked;
}

for (const input of [
  dom.stickRadius,
  dom.sphereScale,
  dom.transparency,
  dom.ambient,
  dom.direct,
  dom.specular,
]) {
  input.addEventListener("input", () => {
    readAppearance();
    syncOutputs();
    scheduleApply();
  });
}

dom.background.addEventListener("input", () => {
  readAppearance();
  scheduleApply();
});

dom.gradient.addEventListener("change", () => {
  dom.gradientBottom.hidden = dom.gradient.value !== "vertical";
  readAppearance();
  scheduleApply();
});

dom.gradientBottom.addEventListener("input", () => {
  readAppearance();
  scheduleApply();
});

for (const toggle of [dom.ambientOcclusion, dom.silhouettes, dom.depthCue]) {
  toggle.addEventListener("change", () => {
    readAppearance();
    // Depth cue is invisible at zero fog, so switching it on adds a light haze.
    if (state.look !== null && state.look.appearance.depth_cue && state.look.appearance.fog === 0) {
      state.look.appearance.fog = 0.25;
    }
    scheduleApply();
  });
}

/** Parse the heavy elements out of a molecular formula, in formula order. */
function elementsOf(compound: Compound | null): string[] {
  const formula = compound?.molecular_formula ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of formula.matchAll(/([A-Z][a-z]?)/g)) {
    const symbol = match[1] ?? "";
    if (symbol === "H" || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out.slice(0, 10);
}

/** One chip per heavy element, showing the override or the default element colour. */
function renderElementColors(): void {
  const look = state.look;
  if (look === null) {
    dom.elementColors.replaceChildren();
    return;
  }
  const elements = elementsOf(state.compound);
  dom.elementColors.replaceChildren(
    ...elements.map((element) => {
      const override = look.appearance.element_colors.find((entry) => entry.element === element);
      const input = document.createElement("input");
      input.type = "color";
      input.value = override?.color ?? elementColor(element);
      input.setAttribute("aria-label", `${element} colour`);
      input.addEventListener("input", () => setElementColor(element, input.value));

      const label = document.createElement("label");
      label.className = "element-color";
      const symbol = document.createElement("span");
      symbol.textContent = element;
      label.append(symbol, input);
      return label;
    }),
  );
}

function setElementColor(element: string, color: string): void {
  const look = state.look;
  if (look === null) return;
  look.appearance.element_colors = look.appearance.element_colors.filter(
    (entry) => entry.element !== element,
  );
  look.appearance.element_colors.push({ element, color } satisfies ElementColor);
  scheduleApply();
}

dom.resetColors.addEventListener("click", () => {
  if (state.look === null) return;
  state.look.appearance.element_colors = [];
  renderElementColors();
  scheduleApply();
});

dom.projection.addEventListener("change", () => {
  void state.viewer?.setProjection(dom.projection.value);
});

dom.frame.addEventListener("click", () => {
  if (state.compound === null) return;
  void state.viewer?.frameScene();
});

/** Zoom around the current framing; a no-op with nothing loaded. */
function zoomScene(notches: number): void {
  if (state.viewer === null || state.compound === null) return;
  void state.viewer
    .zoomBy(notches)
    .catch((error) => setStatus(`Zoom failed: ${describe(error)}`, true));
}

dom.zoomIn.addEventListener("click", () => zoomScene(1));
dom.zoomOut.addEventListener("click", () => zoomScene(-1));

// The renderer maps a released wheel to clipping-plane changes and only zooms while a
// button is held, so a plain wheel does nothing visible. A viewer is expected to zoom, so
// take that case in the capture phase, before the canvas sees it, and leave the
// wheel-while-dragging case to the renderer.
dom.viewerHost.addEventListener(
  "wheel",
  (event) => {
    if (event.buttons !== 0) return;
    if (state.viewer === null || state.compound === null) return;
    event.preventDefault();
    event.stopPropagation();
    zoomScene(event.deltaY < 0 ? 1 : -1);
  },
  { passive: false, capture: true },
);

// --- Export ------------------------------------------------------------------------

dom.exportButton.addEventListener("click", () => {
  void exportFigure();
});

/** Download what the stage shows: the vector drawing in 2D mode, a PNG in 3D mode. */
async function exportFigure(): Promise<void> {
  if (state.mode === "2d") {
    exportSvg();
    return;
  }
  await exportPng();
}

/** Save the inline SVG. It is already the full document, so no work is needed here. */
function exportSvg(): void {
  if (state.depiction === null) {
    setStatus("Load a compound before downloading a 2D drawing.", true);
    return;
  }
  const name = figureName("two_d");
  downloadSvg(name, state.depiction.svg);
  dom.fileName.textContent = name;
  setStatus(`Saved ${name} (${depictionBytes(state.depiction.svg)} bytes).`);
}

/**
 * Render at the wanted width, then crop to the molecule and pad an even margin.
 *
 * patinae renders offscreen at whatever size is asked for, so there is no canvas resize,
 * no device-pixel-ratio correction and no screenshot handshake to wait on. What remains
 * is the step that makes a viewport capture into a figure, the crop and the margin : 
 * and that stays in Rust where it is tested.
 */
async function exportPng(): Promise<void> {
  const viewer = state.viewer;
  if (viewer === null) return;

  const targetWidth = Number(dom.exportWidth.value);
  const rect = dom.viewerHost.getBoundingClientRect();
  const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
  const targetHeight = Math.max(1, Math.round(targetWidth / aspect));
  const transparent = dom.exportTransparent.checked;
  // The margin has to match the scene, or a dark figure gains a white border and a
  // transparent one stops being transparent as soon as it is cropped.
  const [red, green, blue] = transparent ? [0, 0, 0] : hexToBytes(dom.background.value);

  setBusy(true, "Rendering…");
  dom.exportButton.disabled = true;

  try {
    const blob = await viewer.exportPng({
      width: targetWidth * SUPERSAMPLE,
      height: targetHeight * SUPERSAMPLE,
      transparent,
    });
    const rendered = new Uint8Array(await blob.arrayBuffer());
    const scaled = resizePng(rendered, targetWidth, targetHeight);
    const framed = frameFigure(scaled, FIGURE_MARGIN, red, green, blue, transparent ? 0 : 255);

    const name = state.compound === null
      ? "molecule-3D.png"
      : figureName("three_d");
    download(name, framed);
    setStatus(`Saved ${name}${transparent ? " with a transparent background" : ""}.`);
    dom.fileName.textContent = name;
  } catch (error) {
    setStatus(`Export failed: ${describe(error)}`, true);
  } finally {
    dom.exportButton.disabled = false;
    setBusy(false);
  }
}

function download(name: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- Wikitext ----------------------------------------------------------------------

for (const tab of Object.keys(dom.tabs) as TabId[]) {
  dom.tabs[tab].addEventListener("click", () => {
    state.tab = tab;
    refreshOutput();
  });
}

function refreshOutput(): void {
  for (const tab of Object.keys(dom.tabs) as TabId[]) {
    dom.tabs[tab].setAttribute("aria-selected", String(tab === state.tab));
  }

  if (state.compound === null) {
    currentText = "";
    dom.wikitext.textContent = "Load a compound to generate markup.";
    dom.fileName.textContent = ": ";
    return;
  }

  const kind = structureKind();
  const fileName = figureName(kind);
  dom.fileName.textContent = fileName;

  switch (state.tab) {
    case "drugbox":
      currentText = drugbox(state.compoundJson, fileName);
      dom.upload.hidden = true;
      break;
    case "chembox":
      currentText = chembox(state.compoundJson, fileName);
      dom.upload.hidden = true;
      break;
    case "commons": {
      const today = new Date().toISOString().slice(0, 10);
      const license = defaultLicense(kind);
      currentText = commonsInformation(
        state.compoundJson,
        kind,
        AUTHOR,
        license,
        today,
      );
      dom.upload.href = commonsUploadUrl(fileName, currentText, license);
      dom.upload.hidden = false;
      break;
    }
  }

  dom.wikitext.textContent = currentText;
}

dom.copy.addEventListener("click", () => {
  if (currentText === "") return;
  void navigator.clipboard.writeText(currentText).then(
    () => setStatus("Copied to the clipboard."),
    () => setStatus("The clipboard is not available in this browser.", true),
  );
});

// --- Small helpers -----------------------------------------------------------------

function setStatus(message: string, isError = false): void {
  dom.exportStatus.textContent = message;
  dom.exportStatus.style.color = isError ? "#a3231b" : "";
}

/** The overlay currently says the renderer is unusable; nothing should overwrite it. */
let rendererFailed = false;

function setBusy(busy: boolean, message?: string): void {
  dom.loadButton.disabled = busy;
  if (busy && message !== undefined && !rendererFailed) {
    dom.stageMessage.hidden = false;
    dom.stageMessage.textContent = message;
  } else if (!busy && !rendererFailed && state.viewer !== null) {
    dom.stageMessage.hidden = true;
  }
}

/**
 * Say why there is no viewer and disable what needs one.
 *
 * `detail` is appended when there is a low-level message worth reading; a
 * [`RendererUnavailable`] already carries the sentence to show.
 */
function showStageError(message: string, detail?: unknown): void {
  rendererFailed = true;
  dom.stageMessage.hidden = false;
  dom.stageMessage.classList.add("error");
  dom.stageMessage.textContent =
    detail === undefined ? message : `${message} (${describe(detail)})`;
  setStatus("The renderer is unavailable, so images cannot be produced. The markup tabs still work.", true);
  dom.exportButton.disabled = true;
}

function hexToBytes(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reject if `promise` has not settled within `ms`, so a stuck backend is visible. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

void boot();
