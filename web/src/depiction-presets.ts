/**
 * 2D drawing presets: a whole option set under a name.
 *
 * The appearance presets own the 3D look, so these live apart: applying one never touches
 * the ball-and-stick settings, and the two groups combine freely.
 */

import {
  DEFAULT_DEPICTION_SETTINGS,
  normaliseDepictionSettings,
  type DepictionSettings,
} from "./depiction-settings.js";

const STORAGE_KEY = "wikimolgen2.depiction-presets";
const MAX_NAME = 40;

export interface DepictionPreset {
  id: string;
  name: string;
  settings: DepictionSettings;
}

/** The v1 drawing templates, as starting points for the RDKit engine. */
export const BUILTIN_DEPICTION_PRESETS: DepictionPreset[] = [
  {
    id: "acs-1996",
    name: "ACS 1996",
    settings: {
      ...DEFAULT_DEPICTION_SETTINGS,
      acs1996: true,
    },
  },
  {
    id: "wikipedia-2d",
    name: "Wikipedia 2D",
    settings: {
      ...DEFAULT_DEPICTION_SETTINGS,
      bondLength: 40,
      labelSize: 18,
      padding: 0.05,
    },
  },
  {
    id: "compact-2d",
    name: "Compact 2D",
    settings: {
      ...DEFAULT_DEPICTION_SETTINGS,
      bondLength: 30,
      labelSize: 14,
      padding: 0.03,
    },
  },
];

/** A copy of the current options, ready to store under a name. */
export function captureDepiction(settings: DepictionSettings): DepictionSettings {
  return { ...settings };
}

/** The user's saved drawing presets. */
export function loadDepictionPresets(): DepictionPreset[] {
  try {
    return parseDepictionPresets(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveDepictionPresets(presets: DepictionPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // A blocked store only means the presets last for this visit.
  }
}

/** Read a stored list, keeping entries with a name and normalising their options. */
export function parseDepictionPresets(raw: string | null): DepictionPreset[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const presets: DepictionPreset[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") continue;
    const name = record.name.trim().slice(0, MAX_NAME);
    if (name === "") continue;
    presets.push({ id: record.id, name, settings: normaliseDepictionSettings(record.settings) });
  }
  return presets;
}
