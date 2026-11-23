/**
 * Page boot and the wiring that spans modules.
 *
 * The renderer is patinae, reached only through `renderer.ts`; everything else here is
 * DOM. The Rust side is authoritative for presets, figure framing and markup, so the page
 * asks it for the look list and for every generated string instead of duplicating those
 * rules here. Each panel owns its own wiring: lookup, view, output and looks are modules.
 */

import init, { colorSchemesJson, looksJson } from "../pkg/wikimolgen2_wasm.js";
import { appliedLook, bindAppearance, renderSchemeOptions, syncAppearance } from "./appearance.js";
import {
  cloneLook,
  describe,
  dom,
  setStatus,
  setTypedName,
  showStageError,
  state,
  withTimeout,
  type ColorSchemeInfo,
  type Look,
} from "./context.js";
import {
  bindDepictionControls,
  loadDepictionSettings,
  saveDepictionSettings,
  syncDepictionControls,
} from "./depiction.js";
import { DEFAULT_DEPICTION_SETTINGS } from "./depiction-settings.js";
import { renderLooks } from "./looks.js";
import { loadFromInput } from "./lookup.js";
import { refreshOutput, renderLicenseOptions, resetCommonsLicence } from "./output.js";
import {
  applyOrientation,
  bindOrientation,
  loadOrientation,
  resetOrientation,
} from "./orientation.js";
import {
  DEFAULT_PROTEIN_OPTIONS,
  loadProteinOptions,
  saveProteinOptions,
} from "./protein-options.js";
import { Renderer, RendererUnavailable } from "./renderer.js";
import { applyMode, queueDepiction, setMode, showEmptyStage, zoomScene } from "./view.js";
import { bindBatch } from "./batch.js";
import { bindExport, exportFigure } from "./figure.js";
import { bindFullscreen } from "./fullscreen.js";
import { bindKeyboard } from "./keyboard.js";
import { bindSections } from "./panel.js";
import { bindSuggestions } from "./suggest.js";
import { bindTheme, stageTint } from "./theme.js";
import { bindThemeDialog } from "./theme-dialog.js";
import "./styles.css";
import "./stage.css";

// The stored orientation must be in place before the first load frames the scene.
state.orientation = loadOrientation();
// The 2D drawing options are independent of the 3D look and survive a reload.
state.depictionSettings = loadDepictionSettings();
// The protein switches are a renderer preference, like the drawing options.
state.proteinOptions = loadProteinOptions();

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
    applyMode();
    return;
  }

  state.looks = JSON.parse(looksJson()) as Look[];
  // The licence list is Rust data, so the picker cannot drift from the block it feeds.
  renderLicenseOptions();
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
    applyMode();
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

/** Copy the protein switches into the panel. */
function syncProteinControls(): void {
  const options = state.proteinOptions;
  dom.proteinLigand.checked = options.ligand;
  dom.proteinWater.checked = options.water;
  dom.proteinLabels.checked = options.residueLabels;
  dom.proteinFancyHelices.checked = options.fancyHelices;
  dom.proteinFlatSheets.checked = options.flatSheets;
}

/** Push the protein switches to the viewer, when a protein owns the stage. */
function applyProteinOptions(): void {
  if (state.protein === null || state.viewer === null) return;
  void state.viewer
    .setProteinOptions(state.proteinOptions)
    .catch((error) => setStatus(`Could not update the protein view: ${describe(error)}`, true));
}

function readProteinControls(): void {
  state.proteinOptions = {
    ligand: dom.proteinLigand.checked,
    water: dom.proteinWater.checked,
    residueLabels: dom.proteinLabels.checked,
    fancyHelices: dom.proteinFancyHelices.checked,
    flatSheets: dom.proteinFlatSheets.checked,
  };
  saveProteinOptions(state.proteinOptions);
  applyProteinOptions();
}

for (const input of [
  dom.proteinLigand,
  dom.proteinWater,
  dom.proteinLabels,
  dom.proteinFancyHelices,
  dom.proteinFlatSheets,
]) {
  input.addEventListener("change", readProteinControls);
}
syncProteinControls();

/** Put every control back to what a first visit shows, keeping the loaded figure. */
function resetAllSettings(): void {
  state.depictionSettings = { ...DEFAULT_DEPICTION_SETTINGS };
  saveDepictionSettings(state.depictionSettings);
  syncDepictionControls();
  resetOrientation();

  dom.exportWidth.value = "1600";
  dom.exportQuality.value = "4";
  dom.exportMargin.value = "6";
  dom.exportMarginValue.textContent = "6%";
  dom.exportTransparent.checked = true;
  dom.exportLabels.checked = false;
  dom.exportScaleBar.checked = false;
  dom.background.value = "#ffffff";
  dom.gradient.value = "none";
  dom.gradientBottom.value = "#dfe7f2";

  resetCommonsLicence();

  setTypedName("");
  state.proteinOptions = { ...DEFAULT_PROTEIN_OPTIONS };
  saveProteinOptions(state.proteinOptions);
  syncProteinControls();
  applyProteinOptions();
  const look = state.looks[0];
  state.look = look === undefined ? null : cloneLook(look);
  renderLooks();
  syncAppearance();
  dom.settingsPreset.value = "custom";
  dom.settingsPresetNote.textContent = "All settings reset.";
  dom.resetAllConfirm.hidden = true;
  refreshOutput();
  applyMode();
  if (state.viewer !== null && state.compound !== null && state.look !== null) {
    void state.viewer
      .applyLook(appliedLook() ?? state.look)
      .then(() => (state.viewer === null ? undefined : applyOrientation(state.viewer)))
      .catch((error) => setStatus(`Could not reset the figure: ${describe(error)}`, true));
  }
}

dom.resetAllOpen.addEventListener("click", () => {
  dom.resetAllConfirm.hidden = false;
});
dom.resetAllCancel.addEventListener("click", () => {
  dom.resetAllConfirm.hidden = true;
});
dom.resetAllYes.addEventListener("click", resetAllSettings);

bindTheme();
bindThemeDialog();
bindSections();
bindSuggestions();
bindDepictionControls(queueDepiction);
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
/** Coalesce rapid theme previews into one stage message per frame. */
let stageTintScheduled = false;
document.addEventListener("themechange", () => {
  if (stageTintScheduled) return;
  stageTintScheduled = true;
  requestAnimationFrame(() => {
    stageTintScheduled = false;
    state.viewer?.setStageTint(stageTint());
  });
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

/** Register the offline shell in the built site only. */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const start = (): void => {
    const url = new URL("sw.js", document.baseURI).href;
    void navigator.serviceWorker.register(url).catch(() => undefined);
  };
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

registerServiceWorker();
void boot();
