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
    const start = (): void => {
      const factory = window.initRDKitModule;
      if (typeof factory !== "function") {
        reject(new Error("The RDKit module did not define its loader."));
        return;
      }
      // `locateFile` keeps the wasm beside the script in dev and in a built site.
      factory({ locateFile: (file) => new URL(file, url).href }).then(resolve, reject);
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
      reject(new Error("The RDKit module failed to load."));
    });
    document.head.append(script);
  });
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
): Promise<string> {
  const rdkit = await loadRdkit();
  const text = new TextDecoder().decode(sdf);
  const mol = rdkit.get_mol(text);
  if (mol === null) throw new Error("RDKit could not read the 2D record.");
  try {
    if (!mol.is_valid()) throw new Error("RDKit rejected the 2D record.");
    // PubChem records carry explicit hydrogens; a skeletal drawing keeps them implicit.
    mol.remove_hs_in_place();
    mol.set_new_coords(true);
    // No white rectangle: the page tint shows through the drawing.
    const details: Record<string, unknown> = { width, height, clearBackground: false };
    const palette: Record<string, [number, number, number]> = {};
    for (const ink of inks) {
      const number = atomicNumber(ink.element);
      const rgb = rgbTriple(ink.color);
      if (number !== null && rgb !== null) palette[String(number)] = rgb;
    }
    if (Object.keys(palette).length > 0) details.atomColourPalette = palette;
    return mol.get_svg_with_highlights(JSON.stringify(details));
  } finally {
    mol.delete();
  }
}
