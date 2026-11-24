/**
 * The 2D drawing option set: its defaults and its stored form.
 *
 * Kept free of DOM and wasm imports so the panel, the presets and the tests share one
 * definition without loading the page.
 */

/** The 2D drawing options, kept apart from the 3D appearance. */
export interface DepictionSettings {
  /** Draw every atom in black, for a print or high-contrast figure. */
  monochrome: boolean;
  /** Bond line width in drawing units; 0 keeps RDKit's default. */
  bondWidth: number;
  /** Fixed atom label size in drawing units; 0 keeps RDKit's scaling. */
  labelSize: number;
  /** Show R/S labels beside the stereo centres. */
  stereo: boolean;
  /** Show unpaired-electron dots. */
  radicals: boolean;
  /** Show the chiral flag. */
  chiralFlag: boolean;
  /** Show atom map numbers. */
  atomTags: boolean;
  /** Hide every atom label, for a skeleton-only figure. */
  hideLabels: boolean;
  /** Draw the methyl carbon and its hydrogens explicitly. */
  explicitMethyl: boolean;
  /** RDKit's hand-drawn comic style. */
  comic: boolean;
  /** The ACS 1996 journal style: black, 14.4 px bonds, 10 px labels, 0.6 px lines. */
  acs1996: boolean;
  /** Redraw the deposited 2D coordinates with CoordGen. */
  relayout: boolean;
  /** A line of text under the drawing; empty for none. */
  legend: string;
  /** Atom indices to highlight, as typed; empty for none. */
  highlightAtoms: string;
  /** Bond indices to highlight, as typed; empty for none. */
  highlightBonds: string;
  /** The highlight ink, `#rrggbb`. */
  highlightColor: string;
  /** Turn the drawing, in degrees; 0 keeps RDKit's layout. */
  rotate: number;
  /** Fixed bond length in drawing units; 0 keeps RDKit's scaling. */
  bondLength: number;
  /** Page padding as a fraction; 0 keeps RDKit's default. */
  padding: number;
  /** Extra label padding as a fraction; 0 keeps RDKit's default. */
  labelPadding: number;
  /** Distance between multiple bond lines; 0 keeps RDKit's default. */
  bondOffset: number;
}

export const MAX_BOND_WIDTH = 8;
export const MAX_LABEL_SIZE = 36;
export const MAX_LEGEND = 200;

export const DEFAULT_DEPICTION_SETTINGS: DepictionSettings = {
  monochrome: false,
  bondWidth: 0,
  labelSize: 0,
  stereo: false,
  radicals: false,
  chiralFlag: false,
  atomTags: false,
  hideLabels: false,
  explicitMethyl: false,
  comic: false,
  acs1996: true,
  relayout: false,
  legend: "",
  highlightAtoms: "",
  highlightBonds: "",
  highlightColor: "#ff8888",
  rotate: 0,
  bondLength: 0,
  padding: 0,
  labelPadding: 0,
  bondOffset: 0,
};

export function clampValue(value: unknown, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(min, Math.min(max, parsed));
}

/** A full option set from a stored object, with the defaults for anything missing. */
export function normaliseDepictionSettings(raw: unknown): DepictionSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_DEPICTION_SETTINGS };
  const record = raw as Record<string, unknown>;
  const on = (key: string): boolean => record[key] === true;
  return {
    monochrome: on("monochrome"),
    bondWidth: clampValue(record.bondWidth, 0, MAX_BOND_WIDTH),
    labelSize: clampValue(record.labelSize, 0, MAX_LABEL_SIZE),
    stereo: on("stereo"),
    radicals: on("radicals"),
    chiralFlag: on("chiralFlag"),
    atomTags: on("atomTags"),
    hideLabels: on("hideLabels"),
    explicitMethyl: on("explicitMethyl"),
    comic: on("comic"),
    acs1996: on("acs1996"),
    relayout: on("relayout"),
    legend: typeof record.legend === "string" ? record.legend.slice(0, MAX_LEGEND) : "",
    highlightAtoms: typeof record.highlightAtoms === "string" ? record.highlightAtoms : "",
    highlightBonds: typeof record.highlightBonds === "string" ? record.highlightBonds : "",
    highlightColor: typeof record.highlightColor === "string" ? record.highlightColor : "#ff8888",
    rotate: clampValue(record.rotate, -180, 180),
    bondLength: clampValue(record.bondLength, 0, 80),
    padding: clampValue(record.padding, 0, 0.3),
    labelPadding: clampValue(record.labelPadding, 0, 1),
    bondOffset: clampValue(record.bondOffset, 0, 0.5),
  };
}
