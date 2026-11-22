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

/** The kind and version a preset file carries, so a stray JSON is refused. */
const FILE_KIND = "wikimolgen2-presets";
const FILE_VERSION = 1;
/** The longest preset name the row accepts. */
const MAX_NAME = 40;

/** A preset read from a file, before it gets an id. */
export interface ImportedPreset {
  name: string;
  appearance: Partial<Appearance>;
  quality: number;
}

/** The saved presets as a file body. */
export function presetFileText(presets: SavedPreset[]): string {
  return JSON.stringify(
    {
      kind: FILE_KIND,
      version: FILE_VERSION,
      presets: presets.map((preset) => ({
        name: preset.name,
        appearance: preset.appearance,
        quality: preset.quality,
      })),
    },
    null,
    2,
  );
}

/**
 * Read a preset file.
 *
 * Only the fields a preset owns survive, so a file cannot smuggle a colour or a mode into
 * the appearance. A preset without a name is dropped, and an empty result is an error.
 */
export function parsePresetFile(
  text: string,
): { presets: ImportedPreset[] } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "That file is not JSON." };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { error: "That file does not hold presets." };
  }
  const record = parsed as { kind?: unknown; version?: unknown; presets?: unknown };
  if (record.kind !== FILE_KIND) return { error: "That file is not a WikiMolGen 2 preset file." };
  if (record.version !== FILE_VERSION) {
    return { error: `Preset files of version ${String(record.version)} are not supported.` };
  }
  if (!Array.isArray(record.presets)) return { error: "The preset list is missing." };
  const presets: ImportedPreset[] = [];
  for (const entry of record.presets) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME) : "";
    if (name === "") continue;
    const appearance: Record<string, unknown> = {};
    if (typeof raw.appearance === "object" && raw.appearance !== null) {
      const source = raw.appearance as Record<string, unknown>;
      for (const field of SETTING_FIELDS) {
        if (field in source) appearance[field] = source[field];
      }
    }
    const quality =
      typeof raw.quality === "number" && Number.isFinite(raw.quality)
        ? Math.round(raw.quality)
        : 4;
    presets.push({ name, appearance: appearance as Partial<Appearance>, quality });
  }
  if (presets.length === 0) return { error: "No preset in that file has a name." };
  return { presets };
}
