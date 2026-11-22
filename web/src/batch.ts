/**
 * Batch export: a list of identifiers, one figure each, packed into one ZIP.
 *
 * The run is sequential on the single viewer: resolve, load, style, frame, render. A row
 * that fails records its message and the next one continues. A run can be cancelled
 * between rows, and a failed row can be retried on its own.
 */

import { looksJson, proteinLooksJson } from "../pkg/wikimolgen2_wasm.js";
import { appliedLook } from "./appearance.js";
import { cloneLook, describe, dom, figureName, setStatus, state, type Look } from "./context.js";
import { downloadFigure, readFigureSettings, renderFigure } from "./figure.js";
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

interface BatchLooks {
  compound: Look[];
  protein: Look[];
}

interface BatchRow {
  row: HTMLElement;
  retry: HTMLButtonElement;
  identifier: string;
}

let running = false;
let cancelled = false;

/** One identifier per line, duplicates removed, order kept. */
export function parseIdentifiers(text: string): string[] {
  const seen = new Set<string>();
  const identifiers: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const identifier = line.trim();
    if (identifier === "" || seen.has(identifier)) continue;
    seen.add(identifier);
    identifiers.push(identifier);
  }
  return identifiers;
}

function currentLooks(): BatchLooks {
  return {
    compound: JSON.parse(looksJson()) as Look[],
    protein: JSON.parse(proteinLooksJson()) as Look[],
  };
}

/** Keep the page's look when its kind matches, otherwise take that kind's first look. */
function useLook(looks: Look[]): void {
  if (state.look !== null && looks.some((look) => look.id === state.look?.id)) return;
  state.look = looks[0] === undefined ? null : cloneLook(looks[0]);
}

/**
 * Load one identifier into the viewer with its kind's look, and return the archive name.
 *
 * The name is the generated one, never the typed one: every row of a batch needs its own
 * entry, and a single typed name would collide across the archive.
 */
async function loadIntoViewer(
  viewer: Renderer,
  identifier: string,
  looks: BatchLooks,
): Promise<string> {
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
    state.looks = looks.protein;
    useLook(looks.protein);
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
  state.looks = looks.compound;
  useLook(looks.compound);
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
function renderRows(identifiers: string[], onRetry: (index: number) => void): BatchRow[] {
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

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "link-button batch-retry";
    retry.textContent = "Retry";
    retry.hidden = true;
    retry.addEventListener("click", () => onRetry(index));

    const end = document.createElement("span");
    end.className = "batch-end";
    end.append(stateText, retry);
    row.append(name, end);
    dom.batchList.append(row);
    return { row, retry, identifier };
  });
}

function setRow(row: HTMLElement, state: string, note: string): void {
  row.dataset.state = state;
  const label = row.querySelector(".batch-state");
  if (label !== null) label.textContent = note;
}

function setRetryButtons(enabled: boolean): void {
  for (const button of dom.batchList.querySelectorAll<HTMLButtonElement>(".batch-retry")) {
    button.disabled = !enabled;
  }
}

function showProgress(done: number, total: number, text: string): void {
  dom.batchProgressRow.hidden = false;
  dom.batchProgressBar.max = Math.max(1, total);
  dom.batchProgressBar.value = done;
  dom.batchProgress.textContent = text;
}

function beginRun(cancelable: boolean): void {
  running = true;
  cancelled = false;
  dom.batchRun.disabled = true;
  dom.batchRun.textContent = cancelable ? "Exporting…" : "Retrying…";
  dom.batchClose.disabled = true;
  dom.batchCancel.hidden = !cancelable;
  dom.batchCancel.disabled = false;
  dom.batchCancel.textContent = "Cancel";
  setRetryButtons(false);
}

function endRun(): void {
  running = false;
  dom.batchRun.disabled = false;
  dom.batchRun.textContent = "Export figures";
  dom.batchClose.disabled = false;
  dom.batchCancel.hidden = true;
  setRetryButtons(true);
}

function cancelRun(): void {
  if (!running) return;
  cancelled = true;
  dom.batchCancel.disabled = true;
  dom.batchCancel.textContent = "Cancelling…";
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

  beginRun(true);
  try {
    callbacks.beforeRun?.();
    const settings = readFigureSettings();
    const looks = currentLooks();
    const zip = new ZipWriter();
    let rows: BatchRow[] = [];
    rows = renderRows(identifiers, (index) => {
      const target = rows[index];
      if (target !== undefined) void retryRow(target, callbacks);
    });
    showProgress(0, identifiers.length, `0 of ${identifiers.length}`);
    // A paint before the first render; rAF can pause in an occluded window.
    await new Promise((done) => setTimeout(done, 0));
    const used = new Set<string>();
    let rendered = 0;
    let processed = 0;

    for (const [index, identifier] of identifiers.entries()) {
      if (cancelled) break;
      const target = rows[index];
      setRow(target.row, "rendering", "rendering…");
      showProgress(index, identifiers.length, `${index + 1} of ${identifiers.length}: ${identifier}`);
      try {
        const name = await loadIntoViewer(viewer, identifier, looks);
        if (cancelled) break;
        setRow(target.row, "rendering", "drawing…");
        const figure = await renderFigure(viewer, settings, uniqueName(name, used));
        zip.add(figure.name, figure.bytes);
        setRow(target.row, "done", `${figure.width}x${figure.height} px`);
        target.retry.hidden = true;
        rendered += 1;
      } catch (error) {
        setRow(target.row, "failed", describe(error));
        target.retry.hidden = false;
      }
      processed = index + 1;
      showProgress(processed, identifiers.length, `${processed} of ${identifiers.length}`);
      if (cancelled) break;
      // A short pause lets the offscreen readback settle before the next load.
      await new Promise((done) => setTimeout(done, 200));
    }

    if (cancelled) {
      for (const item of rows) {
        if (item.row.dataset.state === "rendering" || item.row.dataset.state === "pending") {
          setRow(item.row, "cancelled", "cancelled");
          item.retry.hidden = false;
        }
      }
      showProgress(processed, identifiers.length, `Cancelled after ${processed} of ${identifiers.length}`);
    }

    if (zip.size > 0) {
      downloadZip(zip.finish());
      setStatus(
        cancelled
          ? `Batch cancelled: ${rendered} of ${identifiers.length} figures in wikimolgen2-figures.zip.`
          : `Batch finished: ${rendered} of ${identifiers.length} figures in wikimolgen2-figures.zip.`,
      );
    } else if (cancelled) {
      setStatus("Batch cancelled before any figure was produced.");
    } else {
      setStatus("Batch failed: no figures were produced.", true);
    }
  } catch (error) {
    setStatus(`Batch failed: ${describe(error)}`, true);
  } finally {
    endRun();
  }
  callbacks.onFinished();
}

/** Render one failed row again and download that figure on its own. */
async function retryRow(target: BatchRow, callbacks: BatchCallbacks): Promise<void> {
  const viewer = state.viewer;
  if (running || viewer === null) return;
  beginRun(false);
  try {
    const settings = readFigureSettings();
    const looks = currentLooks();
    target.retry.hidden = true;
    setRow(target.row, "rendering", "rendering…");
    showProgress(0, 1, `Retrying ${target.identifier}`);
    try {
      const name = await loadIntoViewer(viewer, target.identifier, looks);
      setRow(target.row, "rendering", "drawing…");
      const figure = await renderFigure(viewer, settings, uniqueName(name, new Set()));
      downloadFigure(figure);
      setRow(target.row, "done", `${figure.width}x${figure.height} px`);
      showProgress(1, 1, `Retried ${target.identifier}`);
      setStatus(`Retried ${target.identifier}: ${figure.name}.`);
    } catch (error) {
      setRow(target.row, "failed", describe(error));
      target.retry.hidden = false;
      showProgress(1, 1, `Retry failed: ${target.identifier}`);
      setStatus(`Retry failed for ${target.identifier}: ${describe(error)}`, true);
    }
  } finally {
    endRun();
  }
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
  dom.batchCancel.addEventListener("click", cancelRun);
  // Escape must not hide the progress while the run owns the viewer.
  dom.batchDialog.addEventListener("cancel", (event) => {
    if (running) event.preventDefault();
  });
  dom.batchRun.addEventListener("click", () => void runBatch(callbacks));
}
