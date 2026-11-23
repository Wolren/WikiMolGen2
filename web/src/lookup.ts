/**
 * Lookup: a compound from PubChem or a PDB entry from RCSB, loaded into the stage.
 *
 * The markup half works without a renderer, so a failed viewer must not take the lookup
 * down with it. The newest load owns the page, and an older answer must not overwrite it.
 */

import { looksJson, proteinLooksJson } from "../pkg/wikimolgen2_wasm.js";
import { appliedLook, syncAppearance } from "./appearance.js";
import { cloneLook, describe, dom, setBusy, setStatus, state, type Look } from "./context.js";
import { renderLooks } from "./looks.js";
import { applyOrientation } from "./orientation.js";
import { refreshOutput } from "./output.js";
import { enrichCompound, LookupError, loadCompound } from "./pubchem.js";
import { ProteinError, loadProtein, pdbIdOf } from "./protein.js";
import { addRecent, loadRecent, saveRecent, type RecentFigure } from "./recent.js";
import { applyMode, showMode } from "./view.js";

/** The newest load owns the page; an older answer must not overwrite it. */
let loadToken = 0;

/** The last few figures, newest first; the strip under the status line shows them. */
let recent: RecentFigure[] = loadRecent();

/** Draw the recent strip, or hide it when there is nothing to reopen. */
function renderRecent(): void {
  dom.recentFigures.hidden = recent.length === 0;
  dom.recentFigures.replaceChildren(
    ...recent.map((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.label;
      button.title = `Open ${entry.label}`;
      button.dataset.identifier = entry.identifier;
      return button;
    }),
  );
}

function rememberRecent(entry: RecentFigure): void {
  recent = addRecent(recent, entry);
  saveRecent(recent);
  renderRecent();
}

dom.recentFigures.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  const identifier = button?.dataset.identifier ?? "";
  if (identifier === "") return;
  dom.identifier.value = identifier;
  void loadFromInput();
});

renderRecent();

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

dom.form.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadFromInput();
});

export async function loadFromInput(): Promise<void> {
  const identifier = dom.identifier.value.trim();
  if (identifier === "") {
    dom.identifier.focus();
    return;
  }

  const token = ++loadToken;
  const pdb = pdbIdOf(identifier);
  if (pdb !== null) {
    await loadProteinInput(pdb, token);
    return;
  }

  setBusy(true, "Looking up…");
  const started = performance.now();
  try {
    const result = await loadCompound(identifier);
    if (token !== loadToken) return;

    const wasProtein = state.protein !== null;
    state.compound = result.compound;
    state.compoundJson = JSON.stringify(result.compound);
    // A compound load leaves the protein mode; a compound look the user chose stays.
    if (wasProtein) {
      state.protein = null;
      state.looks = JSON.parse(looksJson()) as Look[];
    }
    if (wasProtein || state.look === null || !state.looks.some((look) => look.id === state.look?.id)) {
      state.look = state.looks[0] === undefined ? null : cloneLook(state.looks[0]);
    }

    // The markup works without a GPU, so a failed renderer must not take the lookup down.
    if (state.viewer !== null) {
      setBusy(true, "Drawing…");
      await state.viewer.loadStructure(result.structure.name, result.structure.bytes);
      await state.viewer.setProteinOptions(null);
      if (token !== loadToken) return;
      setBusy(true, "Colouring…");
      if (state.look !== null) await state.viewer.applyLook(appliedLook() ?? state.look);
      if (token !== loadToken) return;
      setBusy(true, "Framing…");
      await applyOrientation(state.viewer);
      if (token !== loadToken) return;
      dom.exportButton.disabled = false;
    }

    // The 7.39 MB RDKit engine loads on the first 2D open, so the flat record waits here.
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
    rememberRecent({
      identifier,
      kind: state.mode === "2d" ? "two_d" : "three_d",
      label: loadedName,
    });
    // The status line under the figure is the one place a user reads.
    const warnings = result.warnings.length === 0 ? "" : ` ${result.warnings.join(" ")}`;
    setStatus(`Loaded ${loadedName} in ${seconds.toFixed(2)} s.${warnings}`);
    rememberQuery(identifier);
    // The field is no longer the thing to type into; shortcuts should work now.
    dom.identifier.blur();

    // The figure is on the stage; the other sources only add markup fields after it.
    void enrichCompound(result.compound)
      .then(({ compound }) => {
        if (token !== loadToken) return;
        state.compound = compound;
        state.compoundJson = JSON.stringify(compound);
        refreshOutput();
      })
      .catch(() => {
        // Metadata is a bonus; a failed source must not mark the load as failed.
      });

    // A 2D open after a load rebuilds; the first open keeps the overlay until the SVG exists.
    if (state.mode === "2d" && state.depictionSource !== null) {
      await showMode("2d");
    } else {
      applyMode();
    }
    revealFigure();
  } catch (error) {
    if (token !== loadToken) return;
    if (error instanceof LookupError) {
      setStatus(error.message, true);
    } else {
      setStatus(`Could not load the compound: ${describe(error)}`, true);
    }
  } finally {
    if (token === loadToken) setBusy(false);
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
async function loadProteinInput(id: string, token: number): Promise<void> {
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
    if (token !== loadToken) return;
    const fetched = performance.now();
    setBusy(true, `Building ${id}…`);
    const atoms = await viewer.loadStructure(record.name, record.bytes);
    await viewer.setProteinOptions(state.proteinOptions);
    if (token !== loadToken) return;
    const parsed = performance.now();
    state.looks = JSON.parse(proteinLooksJson()) as Look[];
    state.look = state.looks[0] === undefined ? null : cloneLook(state.looks[0]);
    if (state.look !== null) await viewer.applyLook(state.look);
    const styled = performance.now();
    await applyOrientation(viewer);
    await nextFrames(2);
    if (token !== loadToken) return;
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
    rememberRecent({ identifier: id, kind: "protein", label: id });

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
    if (token !== loadToken) return;
    if (error instanceof ProteinError) setStatus(error.message, true);
    else setStatus(`Could not load ${id}: ${describe(error)}`, true);
  } finally {
    if (token === loadToken) setBusy(false);
  }
}
