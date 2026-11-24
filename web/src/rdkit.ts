/**
 * RDKit's MinimalLib, loaded on first use.
 *
 * The vendored bundle is a classic script, so a script tag is the loader. The wasm sits
 * beside it under `public/vendor/rdkit`. The first 2D view pays the 7.39 MB download; the
 * browser caches it for later views.
 */

import { atomicNumber, rgbTriple } from "./elements.js";

/** The subset of RDKit's `Mol` this app uses. */
interface RdkitMol {
  is_valid(): boolean;
  /** 0 with no conformer, 2 for a 2D layout, 3 for 3D coordinates. */
  has_coords(): number;
  remove_hs_in_place(): boolean;
  set_new_coords(useCoordGen?: boolean): boolean;
  get_molblock(): string;
  get_svg_with_highlights(details: string): string;
  delete(): void;
}

/** The subset of the MinimalLib module this app uses. */
export interface RdkitModule {
  get_mol(input: string): RdkitMol | null;
}

type RdkitFactory = (options?: {
  locateFile?: (file: string) => string;
}) => Promise<RdkitModule>;

declare global {
  interface Window {
    initRDKitModule?: RdkitFactory;
  }
}

/** Where the script lives, relative to the served page. */
const SCRIPT_URL = "vendor/rdkit/RDKit_minimal.js";

let loadPromise: Promise<RdkitModule> | null = null;

/**
 * The parsed mol, reused while the same record is redrawn.
 *
 * `set_new_coords` runs CoordGen and costs most of a rebuild. The drawing options do not
 * change the layout, so a slider drag only redraws the SVG.
 */
let cachedMol: { key: string; mol: RdkitMol } | null = null;

/** Load the module once. A failed load clears the cache so a retry can work. */
export function loadRdkit(): Promise<RdkitModule> {
  if (loadPromise === null) {
    loadPromise = loadScript().catch((error: unknown) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
}

function loadScript(): Promise<RdkitModule> {
  return new Promise((resolve, reject) => {
    const url = new URL(SCRIPT_URL, document.baseURI).href;
    // A stalled download must end in the Rust fallback, not a permanent overlay.
    const timer = window.setTimeout(() => {
      reject(new Error("The RDKit module did not load within 30 s."));
    }, 30_000);
    const done = (module: RdkitModule): void => {
      window.clearTimeout(timer);
      resolve(module);
    };
    const fail = (error: unknown): void => {
      window.clearTimeout(timer);
      reject(error);
    };
    const start = (): void => {
      const factory = window.initRDKitModule;
      if (typeof factory !== "function") {
        fail(new Error("The RDKit module did not define its loader."));
        return;
      }
      // `locateFile` keeps the wasm beside the script in dev and in a built site.
      factory({ locateFile: (file) => new URL(file, url).href }).then(done, fail);
    };

    if (typeof window.initRDKitModule === "function") {
      start();
      return;
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.addEventListener("load", start);
    script.addEventListener("error", () => {
      fail(new Error("The RDKit module failed to load."));
    });
    document.head.append(script);
  });
}

/** The drawing options this app sends to RDKit. Zero means RDKit's own default. */
export interface RdkitDrawOptions {
  monochrome?: boolean;
  bondWidth?: number;
  labelSize?: number;
  stereo?: boolean;
  radicals?: boolean;
  chiralFlag?: boolean;
  atomTags?: boolean;
  hideLabels?: boolean;
  explicitMethyl?: boolean;
  comic?: boolean;
  /** The ACS 1996 journal style, using the values RDKit's SetACS1996Mode applies. */
  acs1996?: boolean;
  /** Redraw the deposited 2D coordinates with CoordGen. */
  relayout?: boolean;
  legend?: string;
  highlightAtoms?: string;
  highlightBonds?: string;
  highlightColor?: string;
  rotate?: number;
  bondLength?: number;
  padding?: number;
  labelPadding?: number;
  bondOffset?: number;
}

/**
 * Draw a mol block with RDKit and return its SVG.
 *
 * `set_new_coords` lays the molecule out with CoordGen, but only for a record without a
 * 2D layout. PubChem's deposited layout is curated, and CoordGen knots C60.
 */
export async function depictWithRdkit(
  sdf: Uint8Array,
  width: number,
  height: number,
  inks: { element: string; color: string }[] = [],
  options: RdkitDrawOptions = {},
): Promise<string> {
  const rdkit = await loadRdkit();
  const text = new TextDecoder().decode(sdf);
  let mol: RdkitMol;
  if (cachedMol !== null && cachedMol.key === text) {
    mol = cachedMol.mol;
  } else {
    if (cachedMol !== null) cachedMol.mol.delete();
    const parsed = rdkit.get_mol(text);
    if (parsed === null) throw new Error("RDKit could not read the 2D record.");
    if (!parsed.is_valid()) {
      parsed.delete();
      throw new Error("RDKit rejected the 2D record.");
    }
    // PubChem records carry explicit hydrogens; a skeletal drawing keeps them implicit.
    try {
      parsed.remove_hs_in_place();
      // CoordGen knots C60 and spreads macrocycles; PubChem's 2D layout is curated.
      if (options.relayout === true || parsed.has_coords() !== 2) parsed.set_new_coords(true);
    } catch (error) {
      parsed.delete();
      throw error;
    }
    cachedMol = { key: text, mol: parsed };
    mol = parsed;
  }
  const acs = options.acs1996 === true;
  // No white rectangle: the page tint shows through the drawing.
  const details: Record<string, unknown> = { width, height, clearBackground: false };
  if (acs) {
    // RDKit's SetACS1996Mode: 14.4 px bonds, 10 px labels, 0.6 px lines, 18% offsets.
    details.width = -1;
    details.height = -1;
    details.fixedBondLength = 14.4 / meanBondLength(mol.get_molblock());
    details.fixedFontSize = 10;
    details.bondLineWidth = 0.6;
    details.multipleBondOffset = 0.18;
    details.additionalAtomLabelPadding = 0.066;
    details.padding = 0.05;
  }
  const palette: Record<string, [number, number, number]> = {};
  if (acs || options.monochrome === true) {
    // A black entry for every element beats the default CPK fallback for an unlisted one.
    for (let atomic = 1; atomic <= 118; atomic += 1) palette[String(atomic)] = [0, 0, 0];
  } else {
    for (const ink of inks) {
      const number = atomicNumber(ink.element);
      const rgb = rgbTriple(ink.color);
      if (number !== null && rgb !== null) palette[String(number)] = rgb;
    }
  }
  if (Object.keys(palette).length > 0) details.atomColourPalette = palette;
  const legend = (options.legend ?? "").trim();
  if (legend !== "") details.legend = legend;
  // MinimalLib takes the indices as arrays and one shared highlight ink, not colour maps.
  const atoms = parseIndices(options.highlightAtoms);
  const bonds = parseIndices(options.highlightBonds);
  const highlight = rgbTriple(options.highlightColor ?? "");
  if (highlight !== null && (atoms.length > 0 || bonds.length > 0)) {
    details.highlightColour = highlight;
    if (atoms.length > 0) details.atoms = atoms;
    if (bonds.length > 0) details.bonds = bonds;
  }
  if ((options.rotate ?? 0) !== 0) details.rotate = options.rotate;
  // ACS 1996 owns the layout and labels, so only rotation and highlights reach it.
  if (!acs) {
    if ((options.bondWidth ?? 0) > 0) details.bondLineWidth = options.bondWidth;
    if ((options.labelSize ?? 0) > 0) details.fixedFontSize = Math.round(options.labelSize ?? 0);
    if (options.stereo === true) details.addStereoAnnotation = true;
    if (options.radicals === true) details.includeRadicals = true;
    if (options.chiralFlag === true) details.includeChiralFlag = true;
    if (options.atomTags === true) details.includeAtomTags = true;
    if (options.hideLabels === true) details.noAtomLabels = true;
    if (options.explicitMethyl === true) details.explicitMethyl = true;
    if (options.comic === true) details.comicMode = true;
    // Each layout option at 0 keeps RDKit's own value, so an untouched panel draws as before.
    if ((options.bondLength ?? 0) > 0) details.fixedBondLength = options.bondLength;
    if ((options.padding ?? 0) > 0) details.padding = options.padding;
    if ((options.labelPadding ?? 0) > 0) details.additionalAtomLabelPadding = options.labelPadding;
    if ((options.bondOffset ?? 0) > 0) details.multipleBondOffset = options.bondOffset;
  }
  return mol.get_svg_with_highlights(JSON.stringify(details));
}

/** Mean bond length in the record's own coordinates, for the ACS scale. */
function meanBondLength(block: string): number {
  const lines = block.split(/\r?\n/);
  const counts = lines[3] ?? "";
  const atoms = Number.parseInt(counts.slice(0, 3), 10);
  const bonds = Number.parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(atoms) || !Number.isFinite(bonds) || atoms <= 0 || bonds <= 0) return 1;
  const points: [number, number][] = [];
  for (let index = 0; index < atoms; index += 1) {
    const line = lines[4 + index] ?? "";
    points.push([Number.parseFloat(line.slice(0, 10)), Number.parseFloat(line.slice(10, 20))]);
  }
  let total = 0;
  let counted = 0;
  for (let index = 0; index < bonds; index += 1) {
    const line = lines[4 + atoms + index] ?? "";
    const start = points[Number.parseInt(line.slice(0, 3), 10) - 1];
    const end = points[Number.parseInt(line.slice(3, 6), 10) - 1];
    if (start === undefined || end === undefined) continue;
    const length = Math.hypot(start[0] - end[0], start[1] - end[1]);
    if (length > 0) {
      total += length;
      counted += 1;
    }
  }
  return counted > 0 ? total / counted : 1;
}

/** Indices from a comma or space separated list; anything else is ignored. */
function parseIndices(text: string | undefined): number[] {
  if (text === undefined) return [];
  return text
    .split(/[\s,;]+/)
    .filter((part) => part !== "")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0);
}
