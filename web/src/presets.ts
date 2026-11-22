/**
 * The classic WikiMolGen render presets, as appearance bundles.
 *
 * Each preset names the fields it owns; the rest come from the look's own baseline, so a
 * preset never inherits a stray slider value from an earlier edit. The colour scheme is
 * not part of these: it is the separate colour preset.
 */

import type { Appearance } from "./renderer.js";

export interface SettingsPreset {
  id: string;
  label: string;
  description: string;
  /** The fields this preset sets; the look's baseline supplies the others. */
  appearance: Partial<Appearance>;
  /** Export supersample matching the classic antialias level. */
  quality: number;
}

export const SETTINGS_PRESETS: SettingsPreset[] = [
  {
    id: "wikipedia-3d",
    label: "Wikipedia 3D",
    description: "The classic Wikipedia render: ball and stick, soft light, 2x.",
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
  {
    id: "high-quality-3d",
    label: "High quality 3D",
    description: "Smaller balls, soft shadows and a 4x supersample.",
    appearance: {
      stick_radius: 0.18,
      sphere_scale: 0.28,
      shadows: true,
      antialias: true,
    },
    quality: 4,
  },
  {
    id: "minimal-clean-3d",
    label: "Minimal clean 3D",
    description: "Thin sticks, small balls, flat light and a 2x supersample.",
    appearance: {
      stick_radius: 0.15,
      sphere_scale: 0.2,
      ambient: 0.4,
      direct: 0.4,
      specular: 0.5,
      reflect: 0.3,
      shininess: 20,
      shadows: false,
      depth_cue: false,
      antialias: true,
    },
    quality: 2,
  },
];
