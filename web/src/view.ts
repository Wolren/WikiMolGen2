/**
 * The stage: the 3D viewer against the inline 2D drawing, and the camera controls.
 */

import { appliedLook, setColourAvailable } from "./appearance.js";
import {
  describe,
  dom,
  isRendererFailed,
  setBusy,
  setStatus,
  state,
  type ViewMode,
} from "./context.js";
import {
  buildDepiction,
  clearDepiction,
  setDepictionAvailable,
  showDepiction,
} from "./depiction.js";
import { applyOrientation } from "./orientation.js";
import { refreshOutput } from "./output.js";

/** Say what to do with an empty stage; the overlay is also the busy and error surface. */
export function showEmptyStage(): void {
  if (isRendererFailed() || state.compound !== null) return;
  dom.stageMessage.classList.remove("busy", "error");
  dom.stageMessage.classList.add("empty");
  dom.stageText.textContent = "Load a compound, or paste a PDB ID, to draw a figure.";
  dom.stageMessage.hidden = false;
}

/** The 2D engine has been loaded once; later drawings skip the download message. */
let engineLoaded = false;

/** Rebuild an open 2D view after a drawing control changed, once per quiet spell. */
let depictionTimer = 0;

export function queueDepiction(): void {
  if (state.depictionSource === null) return;
  if (state.mode !== "2d") {
    // The next switch to 2D rebuilds with the new options.
    state.depiction = null;
    return;
  }
  window.clearTimeout(depictionTimer);
  depictionTimer = window.setTimeout(() => {
    void rebuildDepiction();
  }, 120);
}

async function rebuildDepiction(): Promise<void> {
  if (state.depictionSource === null) return;
  const previous = state.depiction;
  const inks = appliedLook()?.appearance.element_colors ?? [];
  const name = state.compound?.name ?? state.depictionSource.name;
  const built = await buildDepiction(
    name,
    state.depictionSource.bytes,
    inks,
    state.depictionSettings,
  );
  if (built.depiction === null) {
    setStatus(`The 2D drawing failed: ${built.error}`, true);
    state.depiction = previous;
    return;
  }
  state.depiction = built.depiction;
  if (state.mode === "2d") applyMode();
}

/**
 * Switch the stage. The first 2D open loads RDKit, so this is asynchronous.
 *
 * The build runs under the stage overlay. A failed engine falls back to the Rust parser
 * inside `buildDepiction`, so this returns without a drawing only when both fail.
 */
export async function showMode(mode: ViewMode): Promise<void> {
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
        const inks = appliedLook()?.appearance.element_colors ?? [];
        const name = state.compound?.name ?? state.depictionSource.name;
        const built = await buildDepiction(
          name,
          state.depictionSource.bytes,
          inks,
          state.depictionSettings,
        );
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
export function setMode(mode: ViewMode): void {
  if (mode === "2d" && dom.mode2d.disabled) return;
  void showMode(mode);
}

/** Swap the stage between the 3D viewer and the inline drawing. */
export function applyMode(): void {
  // A protein has no flat record, so the drawing mode is not offered.
  if (state.protein !== null) state.mode = "3d";
  const isProtein = state.protein !== null;
  dom.proteinLabel.hidden = !isProtein;
  dom.proteinControls.hidden = !isProtein;
  const twoDimensional = state.mode === "2d";
  dom.mode3d.setAttribute("aria-selected", String(!twoDimensional));
  dom.mode2d.setAttribute("aria-selected", String(twoDimensional));
  dom.mode2d.disabled = state.depictionSource === null || state.protein !== null;
  dom.viewerHost.hidden = twoDimensional;
  dom.depiction.hidden = !twoDimensional;
  dom.viewerHost.setAttribute("role", "img");
  dom.viewerHost.setAttribute(
    "aria-label",
    state.protein !== null
      ? `${state.protein.id} protein cartoon`
      : state.compound !== null
        ? `${state.compound.name ?? "Compound"} 3D model`
        : "3D molecular model",
  );
  // The view and appearance controls only act on a running 3D viewer.
  const threeDimensional = !twoDimensional && !isRendererFailed();
  setColourAvailable(threeDimensional);
  setDepictionAvailable(twoDimensional);
  dom.appearanceSection.hidden = !threeDimensional;
  dom.viewSection.hidden = !threeDimensional;

  if (twoDimensional) {
    if (state.depiction !== null) {
      const label = `${state.compound?.name ?? "Molecule"} skeletal structure`;
      showDepiction(dom.depiction, state.depiction.svg, label);
      const ink = state.depictionSettings.monochrome ? ", black and white" : "";
      dom.stageNote.textContent =
        state.depiction.engine === "rdkit"
          ? `RDKit skeletal drawing${ink}`
          : `Vector skeletal drawing${ink}`;
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
    // The overlay is also the busy and error surface, so a running step owns its text.
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
export function zoomScene(notches: number): void {
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

// A plain wheel does nothing in the renderer, so zoom here; a dragging wheel stays its.
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
