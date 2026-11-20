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
  drugbox,
  frameFigure,
  looksJson,
  resizePng,
} from "../pkg/molplate_wasm.js";
import { LookupError, loadCompound, type Compound } from "./pubchem.js";
import { Renderer, RendererUnavailable } from "./renderer.js";
import "./styles.css";

/** Mirrors `molplate_core::style::Look`. */
interface Look {
  id: string;
  label: string;
  style: string;
  color_mode: string;
  material: string | null;
  line_width: number | null;
}

type TabId = "drugbox" | "chembox" | "commons";

const AUTHOR = "molplate";
const LICENSE_3D = "cc-by-sa-4.0";
const STRUCTURE_KIND = "three_d";
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
  projection: required<HTMLSelectElement>("projection"),
  frame: required<HTMLButtonElement>("frame"),
  zoomIn: required<HTMLButtonElement>("zoom-in"),
  zoomOut: required<HTMLButtonElement>("zoom-out"),
  exportWidth: required<HTMLSelectElement>("export-width"),
  exportTransparent: required<HTMLInputElement>("export-transparent"),
  exportButton: required<HTMLButtonElement>("export"),
  exportStatus: required<HTMLParagraphElement>("export-status"),
  viewerHost: required<HTMLElement>("viewer"),
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
} = {
  viewer: null,
  looks: [],
  compound: null,
  look: null,
  tab: "drugbox",
  compoundJson: "{}",
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

  // A figure for an article is drawn on white unless the user changes it.
  await state.viewer.setBackground(1, 1, 1);

  // patinae is WebGPU-only: there is no second backend to report. The badge says what
  // is in use, and the note explains what a figure needs, rather than implying a
  // fallback that does not exist.
  dom.engine.textContent = "WebGPU";
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
      if (state.look !== null) await state.viewer.applyLook(state.look);
      await state.viewer.frameScene();
      dom.exportButton.disabled = false;
    }

    renderLooks();
    renderSummary(result.warnings);
    refreshOutput();
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

  for (const warning of warnings) {
    const note = document.createElement("p");
    note.className = "hint";
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
  // Nothing to re-style before a structure is loaded, and patinae treats a command
  // against an empty scene as an error rather than a no-op.
  if (state.viewer === null || state.compound === null) return;
  try {
    await state.viewer.applyLook(look);
    await state.viewer.frameScene();
  } catch (error) {
    setStatus(`Could not apply “${look.label}”: ${describe(error)}`, true);
  }
}

dom.projection.addEventListener("change", () => {
  void state.viewer?.setProjection(dom.projection.value);
});

dom.background.addEventListener("change", () => {
  const [r, g, b] = hexToBytes(dom.background.value);
  void state.viewer?.setBackground(r / 255, g / 255, b / 255);
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
  void exportPng();
});

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
      : commonsFileName(state.compoundJson, STRUCTURE_KIND);
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

  const fileName = commonsFileName(state.compoundJson, STRUCTURE_KIND);
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
      currentText = commonsInformation(
        state.compoundJson,
        STRUCTURE_KIND,
        AUTHOR,
        LICENSE_3D,
        today,
      );
      dom.upload.href = commonsUploadUrl(fileName, currentText, LICENSE_3D);
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
