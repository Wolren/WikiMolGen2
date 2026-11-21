/**
 * The colour and appearance panels: palette, colour mode, stick ink and per-element
 * overrides, then the sliders that carry the light and the surface finish.
 *
 * A change updates `state.look` and re-applies only the part it touched: the appearance
 * sliders never recolour, and a colour control never rebuilds the representation. That
 * keeps a slider drag to one message per frame.
 */

import { schemeColor } from "../pkg/molplate_wasm.js";
import {
  dom,
  setStatus,
  state,
  describe as describeError,
  type Look,
} from "./context.js";
import type { Compound } from "./pubchem.js";
import type { ElementColor } from "./renderer.js";

/** Apply appearance changes once per frame, not once per input event. */
let applyScheduled = false;
/** Apply colour changes once per frame. Kept separate: they are different commands. */
let recolorScheduled = false;
/** Scheme options already in the select, so a re-sync does not rebuild them. */
let schemesRendered = 0;

/**
 * The look with element inks resolved for the current structure.
 *
 * The scheme names up to 120 elements; sending all of them makes patinae report "0 atoms
 * colored" for the absent ones, so only the elements this formula has are sent. A user
 * override wins over the scheme, and a non-element mode sends no inks at all, because the
 * mode command has already painted the atoms.
 */
export function appliedLook(): Look | null {
  const look = state.look;
  if (look === null) return null;
  const present = inkElementsOf(state.compound);
  if (present.length === 0) return look;
  if (look.color_mode !== "element") {
    return { ...look, appearance: { ...look.appearance, element_colors: [] } };
  }
  const overrides = look.appearance.element_colors;
  const inks = present.map(
    (element) =>
      overrides.find((entry) => entry.element === element) ?? {
        element,
        color: schemeColor(look.appearance.scheme, element),
      },
  );
  return { ...look, appearance: { ...look.appearance, element_colors: inks } };
}

/** Re-apply the light, finish and background on the next frame. */
export function scheduleApply(): void {
  if (applyScheduled) return;
  applyScheduled = true;
  requestAnimationFrame(() => {
    applyScheduled = false;
    const look = appliedLook();
    if (state.viewer === null || state.compound === null || look === null) return;
    void state.viewer.applyAppearance(look).catch((error) => {
      setStatus(`Could not update the look: ${describeError(error)}`, true);
    });
  });
}

/** Re-colour the scene on the next frame. */
export function scheduleRecolor(): void {
  if (recolorScheduled) return;
  recolorScheduled = true;
  requestAnimationFrame(() => {
    recolorScheduled = false;
    const look = appliedLook();
    if (state.viewer === null || state.compound === null || look === null) return;
    void state.viewer.applyColoring(look).catch((error) => {
      setStatus(`Could not recolour the figure: ${describeError(error)}`, true);
    });
  });
}

/**
 * Show or hide the whole colour group.
 *
 * The 2D drawing is RDKit's SVG with RDKit's own element inks, so every control here is
 * inert in that mode. A note says so rather than leaving the panel looking broken.
 */
export function setColourAvailable(available: boolean): void {
  dom.colourControls.hidden = !available;
  dom.colourNote.hidden = available;
}

/**
 * Fill the palette picker from Rust's scheme list.
 *
 * Runs once per session: rebuilding the options would drop the current selection.
 */
export function renderSchemeOptions(): void {
  if (state.schemes.length === 0 || schemesRendered === state.schemes.length) return;
  dom.colorScheme.replaceChildren(
    ...state.schemes.map((scheme) => {
      const option = document.createElement("option");
      option.value = scheme.id;
      option.textContent = scheme.label;
      option.title = scheme.description;
      return option;
    }),
  );
  schemesRendered = state.schemes.length;
}

/** Copy the current look into every control. */
export function syncAppearance(): void {
  const look = state.look;
  if (look === null) return;
  const appearance = look.appearance;
  syncColour();
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
  dom.reflect.value = String(appearance.reflect);
  dom.shininess.value = String(appearance.shininess);
  dom.ambientOcclusion.checked = appearance.ambient_occlusion;
  dom.aoStrength.value = String(appearance.ao_strength);
  dom.shadows.checked = appearance.shadows;
  dom.silhouettes.checked = appearance.silhouettes;
  dom.outlineWidth.value = String(appearance.silhouette_width);
  dom.depthCue.checked = appearance.depth_cue;
  dom.fog.value = String(appearance.fog);
  syncOutputs();
}

/** Copy the colour controls into the panel, including which ones are active. */
function syncColour(): void {
  const look = state.look;
  if (look === null) return;
  const appearance = look.appearance;
  const byElement = look.color_mode === "element";
  // A protein has no element formula on the page and a cartoon carries the mode's inks.
  dom.moleculeColour.hidden = state.protein !== null;
  renderSchemeOptions();
  dom.colorMode.value = look.color_mode;
  dom.colorScheme.value = appearance.scheme;
  dom.colorScheme.disabled = !byElement;
  dom.solidColor.value = appearance.solid_color;
  dom.solidColorControl.hidden = look.color_mode !== "uniform";
  dom.helixColor.value = appearance.helix_color;
  dom.sheetColor.value = appearance.sheet_color;
  dom.loopColor.value = appearance.loop_color;
  dom.secstructColorControl.hidden = look.color_mode !== "sec_struct";
  const oneInk = appearance.stick_color !== null;
  dom.stickColorMode.value = oneInk ? "single" : "follow";
  dom.stickColor.value = appearance.stick_color ?? "#808080";
  dom.stickColorControl.hidden = !oneInk;
  const scheme = state.schemes.find((entry) => entry.id === appearance.scheme);
  dom.schemeNote.textContent = scheme?.description ?? "";
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
  dom.reflectValue.textContent = appearance.reflect.toFixed(2);
  dom.shininessValue.textContent = appearance.shininess.toFixed(0);
  dom.aoStrengthValue.textContent = appearance.ao_strength.toFixed(2);
  dom.outlineWidthValue.textContent = appearance.silhouette_width.toFixed(1);
  dom.fogValue.textContent = appearance.fog.toFixed(2);
  const transparency = Math.max(
    appearance.stick_transparency,
    appearance.sphere_transparency,
    appearance.cartoon_transparency,
  );
  dom.transparencyValue.textContent = `${Math.round(transparency * 100)}%`;
}

/** Read every appearance control into the current look. */
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
  appearance.reflect = Number(dom.reflect.value);
  appearance.shininess = Number(dom.shininess.value);
  appearance.ambient_occlusion = dom.ambientOcclusion.checked;
  appearance.ao_strength = Number(dom.aoStrength.value);
  appearance.shadows = dom.shadows.checked;
  appearance.silhouettes = dom.silhouettes.checked;
  appearance.silhouette_width = Number(dom.outlineWidth.value);
  appearance.depth_cue = dom.depthCue.checked;
  appearance.fog = Number(dom.fog.value);
}

/** Read the colour controls into the current look. */
function readColour(): void {
  const look = state.look;
  if (look === null) return;
  look.color_mode = dom.colorMode.value;
  look.appearance.scheme = dom.colorScheme.value;
  look.appearance.solid_color = dom.solidColor.value;
  look.appearance.helix_color = dom.helixColor.value;
  look.appearance.sheet_color = dom.sheetColor.value;
  look.appearance.loop_color = dom.loopColor.value;
  look.appearance.stick_color =
    dom.stickColorMode.value === "single" ? dom.stickColor.value : null;
}

/** Parse the heavy elements out of a molecular formula, in formula order. */
function elementsOf(compound: Compound | null): string[] {
  return formulaElements(compound, false);
}

/** Every element the scheme has to ink, hydrogens included, in formula order. */
function inkElementsOf(compound: Compound | null): string[] {
  return formulaElements(compound, true);
}

/**
 * Elements of the formula, in the order the formula writes them.
 *
 * Hydrogens are skipped for the chips: a skeletal figure hides them, and they would
 * crowd the picker. The 3D figure shows them, so the inks include them.
 */
function formulaElements(compound: Compound | null, includeHydrogen: boolean): string[] {
  const formula = compound?.molecular_formula ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of formula.matchAll(/([A-Z][a-z]?)/g)) {
    const symbol = match[1] ?? "";
    if (!includeHydrogen && symbol === "H") continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out.slice(0, includeHydrogen ? 24 : 10);
}

/** One chip per heavy element, showing the override or the scheme's ink. */
function renderElementColors(): void {
  const look = state.look;
  if (look === null) {
    dom.elementColors.replaceChildren();
    return;
  }
  const byElement = look.color_mode === "element";
  const elements = elementsOf(state.compound);
  dom.resetColors.disabled = !byElement;
  dom.elementColors.replaceChildren(
    ...elements.map((element) => {
      const override = look.appearance.element_colors.find((entry) => entry.element === element);
      const input = document.createElement("input");
      input.type = "color";
      input.value = override?.color ?? schemeColor(look.appearance.scheme, element);
      input.disabled = !byElement;
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

export function setElementColor(element: string, color: string): void {
  const look = state.look;
  if (look === null) return;
  look.appearance.element_colors = look.appearance.element_colors.filter(
    (entry) => entry.element !== element,
  );
  look.appearance.element_colors.push({ element, color } satisfies ElementColor);
  scheduleRecolor();
}

/** Wire the panels once, after the document exists. */
export function bindAppearance(): void {
  for (const input of [
    dom.stickRadius,
    dom.sphereScale,
    dom.transparency,
    dom.ambient,
    dom.direct,
    dom.specular,
    dom.reflect,
    dom.shininess,
    dom.aoStrength,
    dom.outlineWidth,
    dom.fog,
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
      syncOutputs();
      scheduleApply();
    });
  }

  dom.shadows.addEventListener("change", () => {
    readAppearance();
    scheduleApply();
  });

  dom.colorMode.addEventListener("change", () => {
    readColour();
    // The solid ink only exists for one mode; keep the picker in step before recolouring.
    syncColour();
    scheduleRecolor();
  });

  dom.colorScheme.addEventListener("change", () => {
    readColour();
    // The chips show the scheme's inks, so they are redrawn with the palette.
    renderElementColors();
    const scheme = state.schemes.find((entry) => entry.id === dom.colorScheme.value);
    dom.schemeNote.textContent = scheme?.description ?? "";
    scheduleRecolor();
  });

  dom.solidColor.addEventListener("input", () => {
    readColour();
    scheduleRecolor();
  });

  for (const input of [dom.helixColor, dom.sheetColor, dom.loopColor]) {
    input.addEventListener("input", () => {
      readColour();
      scheduleRecolor();
    });
  }

  dom.stickColorMode.addEventListener("change", () => {
    readColour();
    syncColour();
    scheduleRecolor();
  });

  dom.stickColor.addEventListener("input", () => {
    readColour();
    scheduleRecolor();
  });

  dom.resetColors.addEventListener("click", () => {
    if (state.look === null) return;
    state.look.appearance.element_colors = [];
    renderElementColors();
    scheduleRecolor();
  });
}
