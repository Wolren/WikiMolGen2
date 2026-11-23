/**
 * What a protein cartoon shows beside the ribbon.
 *
 * The choices survive a reload. They are renderer commands, not markup: nothing here
 * reaches the wikitext.
 */

const STORAGE_KEY = "wikimolgen2.protein";

/** The switches a protein figure offers. */
export interface ProteinOptions {
  /** Show non-polymer organic molecules as sticks. */
  ligand: boolean;
  /** Show waters as sticks. */
  water: boolean;
  /** Label the ligand residues. */
  residueLabels: boolean;
  /** Draw helices as ribbons with their grooves. */
  fancyHelices: boolean;
  /** Draw sheets as flat arrows. */
  flatSheets: boolean;
}

/** The v1 defaults: a plain cartoon, with the shaped ribbon. */
export const DEFAULT_PROTEIN_OPTIONS: ProteinOptions = {
  ligand: false,
  water: false,
  residueLabels: false,
  fancyHelices: true,
  flatSheets: true,
};

export function loadProteinOptions(): ProteinOptions {
  try {
    return parseProteinOptions(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULT_PROTEIN_OPTIONS };
  }
}

export function saveProteinOptions(options: ProteinOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // A blocked store only means the next visit starts from the defaults.
  }
}

/** `null` and malformed payloads fall back to the defaults. */
export function parseProteinOptions(raw: string | null): ProteinOptions {
  if (raw === null) return { ...DEFAULT_PROTEIN_OPTIONS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PROTEIN_OPTIONS };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_PROTEIN_OPTIONS };
  const record = parsed as Record<string, unknown>;
  const on = (key: keyof ProteinOptions): boolean =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : DEFAULT_PROTEIN_OPTIONS[key];
  return {
    ligand: on("ligand"),
    water: on("water"),
    residueLabels: on("residueLabels"),
    fancyHelices: on("fancyHelices"),
    flatSheets: on("flatSheets"),
  };
}
