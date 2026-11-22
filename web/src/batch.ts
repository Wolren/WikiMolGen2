/**
 * Batch export: a list of identifiers, one figure each, packed into one ZIP.
 *
 * The run is sequential on the single viewer: resolve, load, style, frame, render. A row
 * that fails records its message and the next one continues. Metadata lookups are
 * skipped, because Wikidata, Wikipedia and openFDA only affect the markup.
 */

import { appliedLook } from "./appearance.js";
import { describe, dom, figureName, setStatus, state } from "./context.js";
import { readFigureSettings, renderFigure } from "./figure.js";
import { loadProtein, pdbIdOf } from "./protein.js";
import { applyOrientation } from "./orientation.js";
import { loadCompound } from "./pubchem.js";
import type { Renderer } from "./renderer.js";
import { ZipWriter } from "./zip.js";

/** What the page does around a batch, since the batch owns the viewer's state. */
export interface BatchCallbacks {
  /** Show the 3D view before the first render, so the figure aspect is the stage's. */
  beforeRun?: () => void;
  /** Refresh the panels after the run, which leaves the last item on the stage. */
  onFinished: () => void;
}

let running = false;

/** One identifier per line, duplicates removed, order kept. */
export function parseIdentifiers(text: string): string[] {
  const seen = new Set<string>();
  const identifiers: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const identifier = line.trim();
    if (identifier === "" || seen.has(identifier.toLowerCase())) continue;
    seen.add(identifier.toLowerCase());
    identifiers.push(identifier);
  }
  return identifiers;
}

/** Load one identifier into the viewer with the current look, and return the file name. */
async function loadIntoViewer(viewer: Renderer, identifier: string): Promise<string> {
  const pdb = pdbIdOf(identifier);
  if (pdb !== null) {
    const record = await loadProtein(pdb);
    await viewer.loadStructure(record.name, record.bytes);
    const sequence = viewer.sequenceSummary();
    state.protein = {
      id: pdb,
      atoms: viewer.count("all"),
      residues: sequence.residues,
      chains: sequence.chains,
      seconds: 0,
    };
    state.compound = { name: pdb, synonyms: [pdb] };
    state.compoundJson = JSON.stringify(state.compound);
    state.depictionSource = null;
    state.depiction = null;
    const proteinLook = appliedLook();
    if (proteinLook !== null) await viewer.applyLook(proteinLook);
    await applyOrientation(viewer);
    return figureName("protein");
  }

  const result = await loadCompound(identifier);
  await viewer.loadStructure(result.structure.name, result.structure.bytes);
  state.protein = null;
  state.compound = result.compound;
  state.compoundJson = JSON.stringify(result.compound);
  state.depictionSource = result.depiction;
  state.depiction = null;
  const compoundLook = appliedLook();
  if (compoundLook !== null) await viewer.applyLook(compoundLook);
  await applyOrientation(viewer);
  return figureName("three_d");
}

/** Keep archive names unique when two identifiers resolve to the same compound. */
function uniqueName(name: string, used: Set<string>): string {
  let candidate = name;
  let index = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = name.replace(/(\.[a-z0-9]+)$/i, `-${index}$1`);
    index += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/** Rows appear before the work starts, so a long run has a shape from the first second. */
function renderRows(identifiers: string[]): HTMLElement[] {
  dom.batchList.hidden = false;
  dom.batchList.replaceChildren();
  return identifiers.map((identifier, index) => {
    const row = document.createElement("li");
    row.className = "batch-row";
    row.dataset.state = "pending";

    const name = document.createElement("span");
    name.className = "batch-name";
    name.textContent = `${index + 1}. ${identifier}`;

    const stateText = document.createElement("span");
    stateText.className = "batch-state";
    stateText.textContent = "pending";

    row.append(name, stateText);
    dom.batchList.append(row);
    return row;
  });
}

function setRow(row: HTMLElement, state: string, note: string): void {
  row.dataset.state = state;
  const label = row.querySelector(".batch-state");
  if (label !== null) label.textContent = note;
}

/** Download the archive, the same way the single figure is saved. */
function downloadZip(bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wikimolgen2-figures.zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function runBatch(callbacks: BatchCallbacks): Promise<void> {
  const viewer = state.viewer;
  if (viewer === null) {
    setStatus("The renderer is not available, so a batch cannot run.", true);
    return;
  }
  if (running) return;

  const identifiers = parseIdentifiers(dom.batchInput.value);
  if (identifiers.length === 0) {
    setStatus("Add at least one compound name, CID, SMILES or PDB ID.", true);
    return;
  }

  if (state.look === null) state.look = state.looks[0] ?? null;
  running = true;
  dom.batchRun.disabled = true;
  dom.batchClose.disabled = true;
  callbacks.beforeRun?.();
  const settings = readFigureSettings();
  const zip = new ZipWriter();
  const rows = renderRows(identifiers);
  // A paint before the first render; rAF can pause in an occluded window.
  await new Promise((done) => setTimeout(done, 0));
  const used = new Set<string>();
  let rendered = 0;

  for (const [index, identifier] of identifiers.entries()) {
    setRow(rows[index], "rendering", "rendering…");
    try {
      const name = await loadIntoViewer(viewer, identifier);
      setRow(rows[index], "rendering", "drawing…");
      const figure = await renderFigure(viewer, settings, uniqueName(name, used));
      zip.add(figure.name, figure.bytes);
      setRow(rows[index], "done", `${figure.width}x${figure.height} px`);
      rendered += 1;
    } catch (error) {
      setRow(rows[index], "failed", describe(error));
    }
    // A short pause lets the offscreen readback settle before the next load.
    await new Promise((done) => setTimeout(done, 200));
  }

  if (zip.size > 0) {
    downloadZip(zip.finish());
    setStatus(`Batch finished: ${rendered} of ${identifiers.length} figures in wikimolgen2-figures.zip.`);
  } else {
    setStatus("Batch failed: no figures were produced.", true);
  }

  running = false;
  dom.batchRun.disabled = false;
  dom.batchClose.disabled = false;
  callbacks.onFinished();
}

/** Wire the dialog and its button once, after the document exists. */
export function bindBatch(callbacks: BatchCallbacks): void {
  dom.batchOpen.addEventListener("click", () => {
    if (dom.batchDialog.open) return;
    dom.batchDialog.showModal();
    dom.batchInput.focus();
  });
  dom.batchClose.addEventListener("click", () => dom.batchDialog.close());
  dom.batchRun.addEventListener("click", () => void runBatch(callbacks));
}
