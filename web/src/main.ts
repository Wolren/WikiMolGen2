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
  colorSchemesJson,
  commonsInformation,
  commonsUploadUrl,
  defaultLicense,
  drugbox,
  looksJson,
  proteinLooksJson,
} from "../pkg/wikimolgen2_wasm.js";
import {
  appliedLook,
  bindAppearance,
  renderSchemeOptions,
  setColourAvailable,
  syncAppearance,
} from "./appearance.js";
import {
  cloneLook,
  describe,
  dom,
  figureName,
  isRendererFailed,
  setBusy,
  setStatus,
  showStageError,
  state,
  structureKind,
  type ColorSchemeInfo,
  type Look,
    type ViewMode,
} from "./context.js";
import { buildDepiction, clearDepiction, showDepiction } from "./depiction.js";
import { bindSuggestions } from "./suggest.js";
import { bindBatch } from "./batch.js";
import { applyOrientation, bindOrientation, loadOrientation } from "./orientation.js";
import { bindExport, exportFigure } from "./figure.js";
import { bindFullscreen } from "./fullscreen.js";
import { bindKeyboard } from "./keyboard.js";
import { bindSections } from "./panel.js";
import { enrichCompound, LookupError, loadCompound } from "./pubchem.js";
import { ProteinError, loadProtein, pdbIdOf } from "./protein.js";
import { Renderer, RendererUnavailable } from "./renderer.js";
import { bindTheme, stageTint } from "./theme.js";
import "./styles.css";
import "./stage.css";

const AUTHOR = "WikiMolGen 2";

// The stored orientation must be in place before the first load frames the scene.
state.orientation = loadOrientation();

/** A later lookup cancels the metadata update of an earlier one. */
let enrichmentToken = 0;

/** Put the lookup in the URL, so a figure can be linked and reopened. */
function rememberQuery(identifier: string): void {
  try {
    const url = new URL(location.href);
    url.searchParams.set("q", identifier);
    history.replaceState(null, "", url);
  } catch {
    // A blocked history API only means the URL does not follow the lookup.
  }
}

// A development-only handle: the end-to-end harness reads state from it. The production
// build tree-shakes this branch because `import.meta.env.DEV` is false there.
if (import.meta.env.DEV) {
  (window as unknown as { __wikimolgen2?: unknown }).__wikimolgen2 = {
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
  // The palettes are Rust data: the page only sends an id back, never an element table.
  state.schemes = JSON.parse(colorSchemesJson()) as ColorSchemeInfo[];
  // Presets and palettes need no GPU, so they are shown even if the renderer cannot start.
  renderSchemeOptions();
  renderLooks();

  // A link carries its lookup; the render is a bonus if this browser cannot start one.
  const requested = new URLSearchParams(location.search).get("q") ?? "";

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
    if (requested.trim() !== "") {
      dom.identifier.value = requested;
      await loadFromInput();
    }
    return;
  }

  dom.stageMessage.hidden = true;

  // patinae is WebGPU-only: there is no second backend to report, so the page says
  // nothing about graphics. A browser without an adapter gets the error overlay.
  state.viewer.setStageTint(stageTint());
  applyMode();

  // Compile the cartoon pipelines in the background: the first protein pays the cost on
  // its own load, and the page is ready now rather than after three seconds of shaders.
  void state.viewer.startWarmup();
  showEmptyStage();
  // The end-to-end check waits on this rather than on the overlay, which now shows the
  // empty-state hint until the first load.
  document.documentElement.dataset.ready = "1";

  if (requested.trim() !== "") {
    dom.identifier.value = requested;
    await loadFromInput();
  }
}

/** Say what to do with an empty stage; the overlay is also the busy and error surface. */
function showEmptyStage(): void {
  if (isRendererFailed() || state.compound !== null) return;
  dom.stageMessage.classList.remove("busy", "error");
  dom.stageMessage.classList.add("empty");
  dom.stageText.textContent = "Load a compound, or paste a PDB ID, to draw a figure.";
  dom.stageMessage.hidden = false;
}

/**
 * Bring the figure into view after a load on a stacked layout.
 *
 * In one column the controls come first, so the result is a screen below the button that
 * produced it. Only the narrow layout scrolls; on the two-column layout nothing moves.
 */
function revealFigure(): void {
  if (!window.matchMedia("(max-width: 1100px)").matches) return;
  // The stage holds both views, so the scroll works in the 2D mode as well.
  const stage = dom.viewerHost.closest(".stage");
  stage?.scrollIntoView({ block: "center" });
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
    // A compound load leaves the protein mode: restore the small-molecule looks and tabs.
    if (state.protein !== null) {
      state.protein = null;
      state.looks = JSON.parse(looksJson()) as Look[];
    }

    // The markup does not need a renderer: looking a compound up and generating wikitext
    // is the half of this app that works without a GPU, so a failed renderer must not
    // take it down with it. Each viewer step names itself, so a slow one is visible.
    if (state.viewer !== null) {
      setBusy(true, "Drawing…");
      await state.viewer.loadStructure(result.structure.name, result.structure.bytes);
      state.look = state.looks[0] === undefined ? null : cloneLook(state.looks[0]);
      setBusy(true, "Colouring…");
      if (state.look !== null) await state.viewer.applyLook(appliedLook() ?? state.look);
      setBusy(true, "Framing…");
      await applyOrientation(state.viewer);
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
    syncAppearance();
    refreshOutput();
    const seconds = (performance.now() - started) / 1000;
    const loadedName = state.compound?.name ?? identifier;
    // Warnings went to the summary card that used to sit under the lookup form. The
    // status line under the figure is the one place left that a user reads.
    const warnings = result.warnings.length === 0 ? "" : ` ${result.warnings.join(" ")}`;
    setStatus(`Loaded ${loadedName} in ${seconds.toFixed(2)} s.${warnings}`);
    rememberQuery(identifier);
    // The field is no longer the thing to type into; shortcuts should work now.
    dom.identifier.blur();

    // The figure is on the stage; the other sources only add markup fields after it.
    void enrichCompound(result.compound)
      .then(({ compound }) => {
        if (token !== enrichmentToken || state.protein !== null) return;
        state.compound = compound;
        state.compoundJson = JSON.stringify(compound);
        refreshOutput();
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
    revealFigure();
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
    state.look = state.looks[0] === undefined ? null : cloneLook(state.looks[0]);
    if (state.look !== null) await viewer.applyLook(state.look);
    const styled = performance.now();
    await applyOrientation(viewer);
    await nextFrames(2);
    const drawn = performance.now();
    const seconds = (drawn - started) / 1000;
    const sequence = viewer.sequenceSummary();

    state.protein = { id, atoms, residues: sequence.residues, chains: sequence.chains, seconds };
    state.compound = { name: id, synonyms: [id] };
    state.compoundJson = JSON.stringify(state.compound);
    state.depictionSource = null;
    state.depiction = null;
    state.mode = "3d";
      dom.mode2d.disabled = true;

    renderLooks();
    syncAppearance();
    applyMode();
    revealFigure();
    dom.exportButton.disabled = false;
    dom.identifier.blur();
    setStatus(
      `Loaded ${id}: ${atoms} atoms, ${sequence.residues} residues in ${seconds.toFixed(2)} s ` +
        `(fetch ${((fetched - started) / 1000).toFixed(2)}, load ${((parsed - fetched) / 1000).toFixed(2)}, ` +
        `style ${((styled - parsed) / 1000).toFixed(2)}, draw ${((drawn - styled) / 1000).toFixed(2)}).`,
    );
    rememberQuery(id);
  } catch (error) {
    if (error instanceof ProteinError) setStatus(error.message, true);
    else setStatus(`Could not load ${id}: ${describe(error)}`, true);
  } finally {
    setBusy(false);
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
  // A copy, so the panel's edits never write back into the preset list.
  state.look = cloneLook(look);
  renderLooks();
  syncAppearance();
  // Nothing to re-style before a structure is loaded, and patinae treats a command
  // against an empty scene as an error rather than a no-op.
  if (state.viewer === null || state.compound === null) return;
  try {
    await state.viewer.applyLook(appliedLook() ?? look);
    await applyOrientation(state.viewer);
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
  setColourAvailable(!twoDimensional);

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
    // The overlay doubles as the empty-stage hint and the error surface; a slow step
    // owns it while it runs, so its own text must not be replaced here.
    if (isRendererFailed()) dom.stageMessage.hidden = false;
    else if (state.compound === null && !dom.stageMessage.classList.contains("busy")) {
      showEmptyStage();
    }
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
  if (state.viewer !== null) void applyOrientation(state.viewer);
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

/** Fit the camera to a typed selection, then the zoom acts on that part. */
async function zoomToSelection(): Promise<void> {
  const selection = dom.zoomSelection.value.trim();
  if (selection === "" || state.viewer === null || state.compound === null) return;
  try {
    await state.viewer.zoomTo(selection);
    setStatus(`Zoomed to ${selection}.`);
  } catch (error) {
    setStatus(`Zoom failed: ${describe(error)}`, true);
  }
}

dom.zoomSelectionGo.addEventListener("click", () => void zoomToSelection());
dom.zoomSelection.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void zoomToSelection();
});

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

/** Copy one block, naming it in the status line. */
function copyBlock(node: HTMLElement, label: string): void {
  const text = node.textContent ?? "";
  if (text === "") return;
  void navigator.clipboard.writeText(text).then(
    () => setStatus(`Copied the ${label}.`),
    () => setStatus("The clipboard is not available in this browser.", true),
  );
}

dom.copyDrugbox.addEventListener("click", () => copyBlock(dom.outputDrugbox, "drug infobox"));
dom.copyChembox.addEventListener("click", () => copyBlock(dom.outputChembox, "chembox"));
dom.copyCommons.addEventListener("click", () => copyBlock(dom.outputCommons, "Commons description"));

function refreshOutput(): void {
  // A protein has no drug or chem box; its Commons description is the useful output.
  const protein = state.protein !== null;
  dom.blockDrugbox.hidden = protein;
  dom.blockChembox.hidden = protein;

  if (state.compound === null) {
    dom.outputDrugbox.textContent = "Load a compound to generate markup.";
    dom.outputChembox.textContent = "";
    dom.outputCommons.textContent = "";
    dom.fileName.textContent = "—";
    dom.uploadCommons.hidden = true;
    return;
  }

  const kind = structureKind();
  const fileName = figureName(kind);
  dom.fileName.textContent = fileName;

  // The two infoboxes and the upload description sit together: a figure needs the file
  // description before the article gets the box that cites it.
  dom.outputDrugbox.textContent = protein ? "" : drugbox(state.compoundJson, fileName);
  dom.outputChembox.textContent = protein ? "" : chembox(state.compoundJson, fileName);
  const today = new Date().toISOString().slice(0, 10);
  const license = defaultLicense(kind);
  const commons = commonsInformation(state.compoundJson, kind, AUTHOR, license, today);
  dom.outputCommons.textContent = commons;

  // The upload action belongs to the Commons description, under the text it sends.
  dom.uploadCommons.href = commonsUploadUrl(fileName, commons, license);
  dom.uploadCommons.hidden = false;
}

// --- Small helpers -----------------------------------------------------------------

/** Reject if `promise` has not settled within `ms`, so a stuck backend is visible. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

bindTheme();
bindSections();
bindSuggestions();
bindOrientation(() => {
  if (state.viewer === null || state.compound === null) return;
  void applyOrientation(state.viewer).catch((error) =>
    setStatus(`Orientation failed: ${describe(error)}`, true),
  );
});
bindBatch({
  beforeRun: () => {
    if (state.mode !== "2d") return;
    state.mode = "3d";
    applyMode();
  },
  onFinished: () => {
    dom.mode2d.disabled = state.depictionSource === null;
    renderLooks();
    syncAppearance();
    applyMode();
    refreshOutput();
    dom.exportButton.disabled = false;
  },
});
bindFullscreen();
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
    if (state.compound !== null && state.viewer !== null) void applyOrientation(state.viewer);
  },
  zoom: zoomScene,
});

void boot();
