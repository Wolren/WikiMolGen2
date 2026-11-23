/**
 * Normalised camera orientations: a fixed turn after the fit, so wiki figures match.
 *
 * The classic tool turned 10° about x and 20° about y after `orient`; these presets keep
 * that house style, and the custom angles cover everything else.
 */

import type { Orientation, OrientationPreset } from "./context.js";
import { dom, state } from "./context.js";
import type { Renderer } from "./renderer.js";

/** The stored orientation survives a reload, like the theme. */
const STORAGE_KEY = "wikimolgen2.orientation";

/** Name, then the turn in degrees about x, y and z. */
const PRESETS: Record<"wiki" | "front" | "side" | "top", { x: number; y: number; z: number }> = {
  wiki: { x: 10, y: 20, z: 0 },
  front: { x: 0, y: 0, z: 0 },
  side: { x: 0, y: 90, z: 0 },
  top: { x: 90, y: 0, z: 0 },
};

const PRESET_NAMES: OrientationPreset[] = ["free", "wiki", "front", "side", "top", "custom"];

/** Read the stored orientation, falling back to the free camera. */
export function loadOrientation(): Orientation {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { preset: "free", x: 10, y: 20, z: 0 };
    const parsed = JSON.parse(raw) as Partial<Orientation>;
    const preset = PRESET_NAMES.includes(parsed.preset as OrientationPreset)
      ? (parsed.preset as OrientationPreset)
      : "free";
    return {
      preset,
      x: clampAngle(parsed.x),
      y: clampAngle(parsed.y),
      z: clampAngle(parsed.z),
    };
  } catch {
    return { preset: "free", x: 10, y: 20, z: 0 };
  }
}

function clampAngle(value: unknown): number {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return 0;
  return Math.min(360, Math.max(0, Math.round(angle)));
}

/** The angles a preset applies; `null` keeps the camera exactly as the user left it. */
export function orientationAngles(orientation: Orientation): { x: number; y: number; z: number } | null {
  if (orientation.preset === "free") return null;
  if (orientation.preset === "custom") {
    return { x: orientation.x, y: orientation.y, z: orientation.z };
  }
  return PRESETS[orientation.preset];
}

/** Re-frame the scene, then turn it to the stored orientation. */
export async function applyOrientation(viewer: Renderer): Promise<void> {
  const angles = orientationAngles(state.orientation);
  await viewer.frameScene();
  if (angles !== null) await viewer.turn(angles);
}

function saveOrientation(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.orientation));
  } catch {
    // Storage can be full or blocked; the orientation then lasts for this visit only.
  }
}

/** Put the free camera and the house tilt back, in the state, the store and the panel. */
export function resetOrientation(): void {
  state.orientation = { preset: "free", x: 10, y: 20, z: 0 };
  saveOrientation();
  syncOrientation();
}

/** Paint the select and the custom inputs from the state. */
function syncOrientation(): void {
  dom.orientation.value = state.orientation.preset;
  dom.orientationCustom.hidden = state.orientation.preset !== "custom";
  dom.rotationX.value = String(state.orientation.x);
  dom.rotationY.value = String(state.orientation.y);
  dom.rotationZ.value = String(state.orientation.z);
}

/** Wire the preset select and the custom angles once, after the document exists. */
export function bindOrientation(onChange: () => void): void {
  syncOrientation();

  dom.orientation.addEventListener("change", () => {
    state.orientation.preset = dom.orientation.value as OrientationPreset;
    syncOrientation();
    saveOrientation();
    onChange();
  });

  for (const input of [dom.rotationX, dom.rotationY, dom.rotationZ]) {
    input.addEventListener("change", () => {
      state.orientation.preset = "custom";
      state.orientation.x = clampAngle(dom.rotationX.value);
      state.orientation.y = clampAngle(dom.rotationY.value);
      state.orientation.z = clampAngle(dom.rotationZ.value);
      syncOrientation();
      saveOrientation();
      onChange();
    });
  }
}
