/**
 * Render settings presets: the original Wikipedia settings plus the user's saved ones.
 *
 * A preset owns the render knobs only. The colour scheme and the element inks belong to
 * the separate colour presets, so the two groups combine without overwriting each other.
 */

import type { Appearance } from "./renderer.js";

/** The fields a settings preset captures, in the order the panel shows them. */
export const SETTING_FIELDS = [
  "stick_radius",
  "sphere_scale",
  "stick_transparency",
  "sphere_transparency",
  "cartoon_transparency",
  "valence",
  "stick_valence_scale",
  "transparency_mode",
  "ambient",
  "direct",
  "specular",
  "reflect",
  "shininess",
  "shadows",
  "shadow_intensity",
  "ambient_occlusion",
  "ao_strength",
  "ao_radius",
  "silhouettes",
  "silhouette_width",
  "depth_cue",
  "fog",
  "fog_start",
  "antialias",
] as const;

export interface SettingsPreset {
  id: string;
  label: string;
  description: string;
  appearance: Partial<Appearance>;
  quality: number;
}

export interface SavedPreset extends SettingsPreset {
  name: string;
}

const STORAGE_KEY = "wikimolgen2.settings-presets";

/** The original WikiMolGen settings, which is the one built-in preset. */
export const BUILTIN_PRESETS: SettingsPreset[] = [
  {
    id: "wikipedia",
    label: "Wikipedia",
    description: "The original Wikipedia render settings.",
    appearance: {
      stick_radius: 0.2,
      sphere_scale: 0.3,
      ambient: 0.3,
      direct: 0.5,
      specular: 0.5,
      reflect: 0.3,
      shininess: 30,
      shadows: false,
      depth_cue: false,
      antialias: true,
    },
    quality: 2,
  },
];

/** A copy of the setting fields, ready to store or apply. */
export function captureSettings(appearance: Appearance): Partial<Appearance> {
  const patch: Record<string, unknown> = {};
  for (const field of SETTING_FIELDS) patch[field] = appearance[field];
  return patch as Partial<Appearance>;
}

/** Read the saved presets, ignoring anything that no longer has the right shape. */
export function loadSavedPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedPreset => {
      if (typeof entry !== "object" || entry === null) return false;
      const record = entry as Record<string, unknown>;
      return (
        typeof record.id === "string" &&
        typeof record.name === "string" &&
        typeof record.quality === "number" &&
        typeof record.appearance === "object" &&
        record.appearance !== null
      );
    });
  } catch {
    return [];
  }
}

export function saveSavedPresets(presets: SavedPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage can be full or blocked; the presets then last for this visit only.
  }
}
