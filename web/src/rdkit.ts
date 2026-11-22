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
  has_coords(): number;
  remove_hs_in_place(): boolean;
  set_new_coords(useCoordGen?: boolean): boolean;
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
}

/**
 * Draw a mol block with RDKit and return its SVG.
 *
 * `set_new_coords` lays the molecule out with RDKit. It also gives a clean depiction for
 * a record whose coordinates are 3D or missing. If CoordGen is present, RDKit uses it.
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
    parsed.remove_hs_in_place();
    parsed.set_new_coords(true);
    cachedMol = { key: text, mol: parsed };
    mol = parsed;
  }
  // No white rectangle: the page tint shows through the drawing.
  const details: Record<string, unknown> = { width, height, clearBackground: false };
  const palette: Record<string, [number, number, number]> = {};
  if (options.monochrome === true) {
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
  if ((options.bondWidth ?? 0) > 0) details.bondLineWidth = options.bondWidth;
  if ((options.labelSize ?? 0) > 0) details.fixedFontSize = Math.round(options.labelSize ?? 0);
  return mol.get_svg_with_highlights(JSON.stringify(details));
}
