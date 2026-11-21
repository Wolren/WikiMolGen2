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
  commonsInformation,
  commonsUploadUrl,
  defaultLicense,
  drugbox,
  looksJson,
  proteinLooksJson,
} from "../pkg/molplate_wasm.js";
import { appliedLook, bindAppearance, syncAppearance } from "./appearance.js";
import {
  describe,
  dom,
  figureName,
  isRendererFailed,
  setBusy,
  setStatus,
  showStageError,
  state,
  structureKind,
  type Look,
  type TabId,
  type ViewMode,
} from "./context.js";
import { buildDepiction, clearDepiction, showDepiction } from "./depiction.js";
import { bindExport, exportFigure } from "./figure.js";
import { bindKeyboard } from "./keyboard.js";
import { enrichCompound, LookupError, loadCompound } from "./pubchem.js";
import { ProteinError, loadProtein, pdbIdOf } from "./protein.js";
import { Renderer, RendererUnavailable } from "./renderer.js";
import { bindTheme, stageTint } from "./theme.js";
import "./styles.css";
import "./stage.css";

const AUTHOR = "molplate";

/** The markup currently shown, for the copy button. */
let currentText = "";

/** A later lookup cancels the metadata update of an earlier one. */
let enrichmentToken = 0;

// A development-only handle: the end-to-end harness reads state from it. The production
// build tree-shakes this branch because `import.meta.env.DEV` is false there.
if (import.meta.env.DEV) {
  (window as unknown as { __molplate?: unknown }).__molplate = {
    state,
    count: (selection: string) => state.viewer?.count(selection) ?? -1,
    camera: () => state.viewer?.cameraView() ?? null,
  };
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

  // patinae is WebGPU-only: there is no second backend to report. The badge says what
  // is in use, and the note explains what a figure needs, rather than implying a
  // fallback that does not exist.
  dom.engine.textContent = "WebGPU";
  state.viewer.setStageTint(stageTint());
  applyMode();

  // Compile the cartoon pipelines before the first request. The first cartoon frame
  // costs 3 s of pipeline compilation; paying it here keeps a protein load responsive.
  const viewer = state.viewer;
  if (viewer !== null) {
    dom.stageMessage.hidden = false;
    dom.stageMessage.classList.add("busy");
    dom.stageText.textContent = "Preparing the 3D view…";
    await viewer.startWarmup();
    dom.stageMessage.classList.remove("busy");
    dom.stageMessage.hidden = true;
  }
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

  const pdb = pdbIdOf(identifier);
  if (pdb !== null) {
    enrichmentToken += 1;
    await loadProteinInput(pdb);
    return;
  }

  const token = ++enrichmentToken;
  setBusy(true, "Looking up…");
  const started = performance.now();
  try {
    const result = await loadCompound(identifier);
    state.compound = result.compound;
    state.compoundJson = JSON.stringify(result.compound);
    state.sources = [];
    // A compound load leaves the protein mode: restore the small-molecule looks and tabs.
    if (state.protein !== null) {
      state.protein = null;
      state.looks = JSON.parse(looksJson()) as Look[];
    }

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

    // The flat record is kept for the 2D engine, which loads only when 2D first opens.
    // The 7.39 MB RDKit module would otherwise slow every compound load.
    state.depictionSource = result.depiction;
    state.depiction = null;
    dom.mode2d.disabled = result.depiction === null;
    if (result.depiction === null) {
      result.warnings.push("PubChem has no flat record for this compound, so 2D is unavailable.");
    }
    if (state.mode === "2d" && result.depiction === null) state.mode = "3d";

    renderLooks();
    renderSummary(result.warnings);
    syncAppearance();
    refreshOutput();
    const seconds = (performance.now() - started) / 1000;
    const loadedName = state.compound?.name ?? identifier;
    setStatus(`Loaded ${loadedName} in ${seconds.toFixed(2)} s.`);
    // The field is no longer the thing to type into; shortcuts should work now.
    dom.identifier.blur();

    // The figure is already on the stage; the other sources fill the summary after.
    void enrichCompound(result.compound)
      .then(({ compound, sources }) => {
        if (token !== enrichmentToken || state.protein !== null) return;
        state.compound = compound;
        state.compoundJson = JSON.stringify(compound);
        state.sources = sources;
        renderSummary(result.warnings);
        refreshOutput();
        const added = [
          compound.atc_prefix === undefined
            ? undefined
            : `ATC ${compound.atc_prefix}${compound.atc_suffix ?? ""}`,
          compound.routes_of_administration === undefined
            ? undefined
            : `routes ${compound.routes_of_administration}`,
        ].filter((entry): entry is string => entry !== undefined);
        setStatus(
          `Loaded ${loadedName} in ${seconds.toFixed(2)} s.` +
            (added.length === 0 ? "" : ` ${added.join(", ")}.`),
        );
      })
      .catch(() => {
        // Metadata is a bonus; a failed source must not mark the load as failed.
      });

    // A second 2D open after a new load rebuilds the drawing. The first open waits for
    // the engine, so the overlay stays until the SVG is ready.
    if (state.mode === "2d" && state.depictionSource !== null) {
      await showMode("2d");
    } else {
      applyMode();
    }
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

/** Resolve after `count` painted frames, so a timing claim includes the first image. */
function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const step = (): void => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Fetch a PDB entry and show it as a cartoon coloured by secondary structure.
 *
 * The timer covers the fetch, the parse, the first styled frame and one more frame. That
 * is the interval a user waits for an image, not just for a parse.
 */
async function loadProteinInput(id: string): Promise<void> {
  const viewer = state.viewer;
  if (viewer === null) {
    setStatus("The 3D viewer is not available, so a protein cartoon cannot be drawn.", true);
    return;
  }
  setBusy(true, `Fetching PDB ${id}…`);
  dom.exportButton.disabled = true;
  const started = performance.now();
  try {
    const record = await loadProtein(id);
    const fetched = performance.now();
    setBusy(true, `Building ${id}…`);
    const atoms = await viewer.loadStructure(record.name, record.bytes);
    const parsed = performance.now();
    state.looks = JSON.parse(proteinLooksJson()) as Look[];
    state.look = state.looks[0] ?? null;
    if (state.look !== null) await viewer.applyLook(state.look);
    const styled = performance.now();
    await viewer.frameScene();
    await nextFrames(2);
    const drawn = performance.now();
    const seconds = (drawn - started) / 1000;
    const sequence = viewer.sequenceSummary();

    state.protein = { id, atoms, residues: sequence.residues, chains: sequence.chains, seconds };
    state.compound = { name: id, synonyms: [id] };
    state.compoundJson = JSON.stringify(state.compound);
    state.sources = [];
    state.depictionSource = null;
    state.depiction = null;
    state.mode = "3d";
    state.tab = "commons";
    dom.mode2d.disabled = true;

    renderLooks();
    syncAppearance();
    renderProteinSummary();
    applyMode();
    dom.exportButton.disabled = false;
    dom.identifier.blur();
    setStatus(
      `Loaded ${id}: ${atoms} atoms, ${sequence.residues} residues in ${seconds.toFixed(2)} s ` +
        `(fetch ${((fetched - started) / 1000).toFixed(2)}, load ${((parsed - fetched) / 1000).toFixed(2)}, ` +
        `style ${((styled - parsed) / 1000).toFixed(2)}, draw ${((drawn - styled) / 1000).toFixed(2)}).`,
    );
  } catch (error) {
    if (error instanceof ProteinError) setStatus(error.message, true);
    else setStatus(`Could not load ${id}: ${describe(error)}`, true);
  } finally {
    setBusy(false);
  }
}

function renderProteinSummary(): void {
  const protein = state.protein;
  if (protein === null) return;
  const rows: [string, string][] = [
    ["Name", `PDB ${protein.id}`],
    ["Atoms", String(protein.atoms)],
    ["Residues", String(protein.residues)],
    ["Chains", String(protein.chains)],
    ["Load", `${protein.seconds.toFixed(2)} s`],
  ];
  dom.summary.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value;
      return [term, detail];
    }),
  );
  dom.summary.hidden = false;
  for (const old of document.querySelectorAll(".summary-note")) old.remove();
}

function renderSummary(warnings: string[]): void {
  const compound = state.compound;
  if (compound === null) return;

  const atc = `${compound.atc_prefix ?? ""}${compound.atc_suffix ?? ""}`.trim();
  const label = [compound.dailymed_labeler, compound.dailymed_setid]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(", ");
  const rows: [string, string | undefined][] = [
    ["Name", compound.name],
    ["PubChem CID", compound.cid === undefined ? undefined : String(compound.cid)],
    ["Formula", compound.molecular_formula],
    ["Mass", compound.molecular_weight === undefined ? undefined : `${compound.molecular_weight} g/mol`],
    ["SMILES", compound.smiles],
    // Each of these comes from a source beside PubChem: ATC and the identifiers from
    // Wikidata, the clinical fields from the Wikipedia infobox, the label from DailyMed.
    ["ATC", atc === "" ? undefined : atc],
    ["Routes", compound.routes_of_administration],
    ["Legal status", compound.legal_status],
    ["Wikidata", compound.wikidata_qid],
    ["DrugBank", compound.drugbank_id],
    ["ChEMBL", compound.chembl_id],
    ["Label", label === "" ? undefined : label],
  ];

  dom.summary.replaceChildren(
    ...rows.flatMap(([labelText, value]) => {
      if (value === undefined) return [];
      const term = document.createElement("dt");
      term.textContent = labelText;
      const detail = document.createElement("dd");
      detail.textContent = value;
      if (labelText === "SMILES" || labelText === "Routes") detail.style.wordBreak = "break-word";
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
  if (state.sources.length > 0) {
    const note = document.createElement("p");
    note.className = "hint summary-note";
    note.textContent = `Sources: ${state.sources
      .map((source) => `${source.name} (${source.detail})`)
      .join(", ")}.`;
    dom.summary.after(note);
  }
}

// --- Style and camera ---------------------------------------------------------------

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

      const swatch = document.createElement("span");
      swatch.className = "look-swatch";
      swatch.dataset.style = look.style;
      swatch.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "look-label";
      text.textContent = look.label;

      label.append(input, swatch, text);
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

/** The 2D engine has been loaded once; later drawings skip the download message. */
let engineLoaded = false;

/**
 * Switch the stage. The first 2D open loads RDKit, so this is asynchronous.
 *
 * The build runs under the stage overlay. A failed engine falls back to the Rust parser
 * inside `buildDepiction`, so this returns without a drawing only when both fail.
 */
async function showMode(mode: ViewMode): Promise<void> {
  if (mode === "2d") {
    if (state.protein !== null || state.depictionSource === null) return;
    if (state.depiction === null) {
      setBusy(
        true,
        engineLoaded
          ? "Drawing the 2D view…"
          : "Loading the RDKit 2D engine (7.4 MB)…",
      );
      try {
        const built = await buildDepiction(state.depictionSource.name, state.depictionSource.bytes);
        if (built.depiction === null) {
          setStatus(`The 2D drawing failed: ${built.error}`, true);
          return;
        }
        state.depiction = built.depiction;
        engineLoaded = true;
      } finally {
        setBusy(false);
      }
    }
  }
  state.mode = mode;
  applyMode();
}

/** Switch the stage, and ignore 2D when the record has no flat coordinates. */
function setMode(mode: ViewMode): void {
  if (mode === "2d" && dom.mode2d.disabled) return;
  void showMode(mode);
}

/** Swap the stage between the 3D viewer and the inline drawing. */
function applyMode(): void {
  // A protein has no flat record, so the drawing mode is not offered.
  if (state.protein !== null) state.mode = "3d";
  const twoDimensional = state.mode === "2d";
  dom.mode3d.setAttribute("aria-selected", String(!twoDimensional));
  dom.mode2d.setAttribute("aria-selected", String(twoDimensional));
  dom.mode2d.disabled = state.depictionSource === null || state.protein !== null;
  dom.viewerHost.hidden = twoDimensional;
  dom.depiction.hidden = !twoDimensional;

  if (twoDimensional) {
    if (state.depiction !== null) {
      showDepiction(dom.depiction, state.depiction.svg);
      dom.stageNote.textContent =
        state.depiction.engine === "rdkit" ? "RDKit skeletal drawing" : "Vector skeletal drawing";
    } else {
      clearDepiction(dom.depiction);
      dom.depiction.textContent = "Load a compound to see its 2D drawing.";
      dom.stageNote.textContent = "";
    }
    // The drawing needs no GPU, so it can cover an error about the 3D viewer.
    dom.stageMessage.hidden = true;
  } else {
    dom.stageNote.textContent =
      state.protein === null
        ? ""
        : `${state.protein.id} cartoon, secondary structure colours`;
    if (isRendererFailed()) dom.stageMessage.hidden = false;
  }

  dom.exportButton.textContent = twoDimensional ? "Download SVG" : "Download PNG";
  dom.exportButton.disabled =
    state.compound === null ||
    (twoDimensional ? state.depiction === null : state.viewer === null);
  refreshOutput();
}

dom.mode3d.addEventListener("click", () => setMode("3d"));
dom.mode2d.addEventListener("click", () => setMode("2d"));

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

// --- Wikitext ----------------------------------------------------------------------

for (const tab of Object.keys(dom.tabs) as TabId[]) {
  dom.tabs[tab].addEventListener("click", () => {
    state.tab = tab;
    refreshOutput();
  });
}

function refreshOutput(): void {
  // A protein has no drug or chem box; its Commons description is the useful output.
  const protein = state.protein !== null;
  dom.tabs.drugbox.hidden = protein;
  dom.tabs.chembox.hidden = protein;
  if (protein) state.tab = "commons";

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

/** Reject if `promise` has not settled within `ms`, so a stuck backend is visible. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

bindTheme();
document.addEventListener("themechange", () => {
  state.viewer?.setStageTint(stageTint());
});
bindAppearance();
bindExport();
bindKeyboard({
  load: () => void loadFromInput(),
  setMode,
  exportFigure: () => void exportFigure(),
  frame: () => {
    if (state.compound !== null) void state.viewer?.frameScene();
  },
  zoom: zoomScene,
});

void boot();
