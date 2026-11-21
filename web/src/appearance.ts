/**
 * The appearance panel: sliders, toggles and per-element colours.
 *
 * A change updates `state.look.appearance` and re-applies only the appearance, so a
 * slider drag does not rebuild the representation or move the camera.
 */

import { elementColor } from "../pkg/molplate_wasm.js";
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

/**
 * The look with overrides reduced to elements the structure has.
 *
 * An override for an absent element makes patinae log "0 atoms colored", so a look that
 * names common elements is filtered to the current molecule first.
 */
export function appliedLook(): Look | null {
  const look = state.look;
  if (look === null) return null;
  const present = new Set(elementsOf(state.compound));
  if (present.size === 0) return look;
  return {
    ...look,
    appearance: {
      ...look.appearance,
      element_colors: look.appearance.element_colors.filter((entry) => present.has(entry.element)),
    },
  };
}

/** Re-apply the current appearance on the next frame. */
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

/** Copy the current look into the controls. */
export function syncAppearance(): void {
  const look = state.look;
  if (look === null) return;
  const appearance = look.appearance;
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

/** Read every control into the current look. */
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

/** Parse the heavy elements out of a molecular formula, in formula order. */
function elementsOf(compound: Compound | null): string[] {
  const formula = compound?.molecular_formula ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of formula.matchAll(/([A-Z][a-z]?)/g)) {
    const symbol = match[1] ?? "";
    if (symbol === "H" || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out.slice(0, 10);
}

/** One chip per heavy element, showing the override or the default element colour. */
function renderElementColors(): void {
  const look = state.look;
  if (look === null) {
    dom.elementColors.replaceChildren();
    return;
  }
  const elements = elementsOf(state.compound);
  dom.elementColors.replaceChildren(
    ...elements.map((element) => {
      const override = look.appearance.element_colors.find((entry) => entry.element === element);
      const input = document.createElement("input");
      input.type = "color";
      input.value = override?.color ?? elementColor(element);
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
  scheduleApply();
}

/** Wire the panel once, after the document exists. */
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

  dom.resetColors.addEventListener("click", () => {
    if (state.look === null) return;
    state.look.appearance.element_colors = [];
    renderElementColors();
    scheduleApply();
  });
}
