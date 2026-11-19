/**
 * Page controller: look a compound up, render it, and turn it into Wikipedia or
 * Commons markup.
 *
 * The renderer is a wasm module that owns a `<canvas>`; everything else is this file.
 * The Rust side is authoritative for presets and markup, so the page asks it for the
 * look list and for every generated string instead of duplicating those rules here.
 */

import init, {
  chembox,
  commonsFileName,
  commonsInformation,
  commonsUploadUrl,
  drugbox,
  looksJson,
  start,
} from "../pkg/molplate_wasm.js";
import type { Viewer } from "../pkg/molplate_wasm.js";
import { LookupError, loadCompound, type Compound } from "./pubchem.js";
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

const dom = {
  form: required<HTMLFormElement>("lookup"),
  identifier: required<HTMLInputElement>("identifier"),
  loadButton: required<HTMLButtonElement>("load"),
  summary: required<HTMLDListElement>("summary"),
  looks: required<HTMLDivElement>("looks"),
  colorPreset: required<HTMLSelectElement>("color-preset"),
  background: required<HTMLInputElement>("background"),
  projection: required<HTMLSelectElement>("projection"),
  frame: required<HTMLButtonElement>("frame"),
  exportWidth: required<HTMLSelectElement>("export-width"),
  exportButton: required<HTMLButtonElement>("export"),
  exportStatus: required<HTMLParagraphElement>("export-status"),
  canvas: required<HTMLCanvasElement>("viewer"),
  stageMessage: required<HTMLDivElement>("stage-message"),
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
  viewer: Viewer | null;
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
  state.looks = JSON.parse(looksJson()) as Look[];

  try {
    await init();
    state.viewer = await start("viewer");
  } catch (error) {
    showStageError(
      "The renderer could not start. This needs a browser with WebGPU or WebGL2 enabled.",
      error,
    );
    return;
  }

  dom.stageMessage.hidden = true;
  // A figure for an article is drawn on white unless the user changes it.
  await state.viewer.setBackground(1, 1, 1);
  renderLooks();
}

// --- Compound lookup ---------------------------------------------------------------

dom.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadFromInput();
});

async function loadFromInput(): Promise<void> {
  if (state.viewer === null) return;
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

    await state.viewer.loadStructure(result.structure.name, result.structure.bytes);
    state.look = state.looks[0] ?? null;
    if (state.look !== null) await state.viewer.applyLook(JSON.stringify(state.look));
    await state.viewer.setColorPreset(dom.colorPreset.value);
    await state.viewer.frameScene();

    renderLooks();
    renderSummary(result.warnings);
    refreshOutput();
    dom.exportButton.disabled = false;
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
  await state.viewer?.applyLook(JSON.stringify(look));
  await state.viewer?.frameScene();
}

dom.colorPreset.addEventListener("change", () => {
  void state.viewer?.setColorPreset(dom.colorPreset.value);
});

dom.projection.addEventListener("change", () => {
  void state.viewer?.setProjection(dom.projection.value);
});

dom.background.addEventListener("change", () => {
  void state.viewer?.setBackground(...hexToRgb(dom.background.value));
});

dom.frame.addEventListener("click", () => {
  void state.viewer?.frameScene();
});

// --- Export ------------------------------------------------------------------------

dom.exportButton.addEventListener("click", () => {
  void exportPng();
});

/**
 * Resize the canvas to the wanted pixel size, capture it, put it back.
 *
 * The viewer has no offscreen render API, so the surface is the image: growing the
 * canvas is what makes a 1600 px export possible. `devicePixelRatio` is accounted for
 * because eframe sizes the drawing buffer from CSS pixels × DPR.
 */
async function exportPng(): Promise<void> {
  const viewer = state.viewer;
  if (viewer === null) return;

  const targetWidth = Number(dom.exportWidth.value);
  const rect = dom.canvas.getBoundingClientRect();
  const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1;
  const targetHeight = Math.round(targetWidth / aspect);
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

  const previousStyle = dom.canvas.getAttribute("style");
  setBusy(true, "Rendering…");
  dom.exportButton.disabled = true;

  try {
    dom.canvas.style.width = `${targetWidth / dpr}px`;
    dom.canvas.style.height = `${targetHeight / dpr}px`;

    // The surface resize lands on the next frame; the capture then needs the scene
    // redrawn at the new size, which is what the settle count covers.
    await nextAnimationFrames(3);
    viewer.requestCapture(2);
    const png = await takeCapture(viewer);

    const name = state.compound === null
      ? "molecule-3D.png"
      : commonsFileName(state.compoundJson, STRUCTURE_KIND);
    download(name, png);
    setStatus(`Saved ${name}.`);
    dom.fileName.textContent = name;
  } catch (error) {
    setStatus(`Export failed: ${describe(error)}`, true);
  } finally {
    if (previousStyle === null) {
      dom.canvas.removeAttribute("style");
    } else {
      dom.canvas.setAttribute("style", previousStyle);
    }
    dom.exportButton.disabled = false;
    setBusy(false);
  }
}

async function takeCapture(viewer: Viewer): Promise<Uint8Array> {
  const deadline = performance.now() + 8000;
  while (performance.now() < deadline) {
    const bytes = viewer.takeCapture();
    if (bytes !== undefined) return bytes;
    const status = viewer.captureStatus();
    if (status.startsWith("failed")) throw new Error(status);
    await delay(40);
  }
  throw new Error("the renderer did not return an image");
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
    dom.fileName.textContent = "—";
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

function setBusy(busy: boolean, message?: string): void {
  dom.loadButton.disabled = busy;
  if (busy && message !== undefined) {
    dom.stageMessage.hidden = false;
    dom.stageMessage.textContent = message;
  } else if (!busy && state.viewer !== null) {
    dom.stageMessage.hidden = true;
  }
}

function showStageError(message: string, error: unknown): void {
  dom.stageMessage.hidden = false;
  dom.stageMessage.classList.add("error");
  dom.stageMessage.textContent = `${message} (${describe(error)})`;
  setStatus("The renderer is unavailable, so images cannot be produced. The markup tabs still work.", true);
  dom.exportButton.disabled = true;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const int = Number.parseInt(value, 16);
  return [
    ((int >> 16) & 0xff) / 255,
    ((int >> 8) & 0xff) / 255,
    (int & 0xff) / 255,
  ];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const step = (): void => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

void boot();
