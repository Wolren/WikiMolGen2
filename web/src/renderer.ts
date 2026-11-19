/**
 * The adapter between molplate's page and patinae's web viewer.
 *
 * patinae owns the canvas, its own animation-frame loop and the command engine; this
 * file is the only place that knows either of those facts. Everything the page asks for
 * is expressed as a method here, so the rest of `src/` stays renderer-agnostic — the same
 * property `molplate_core` has on the Rust side.
 *
 * The viewer is loaded from `public/vendor/patinae` (see the PROVENANCE.md there) rather
 * than from `node_modules`, because it is a prebuilt ES module plus wasm from another
 * repository, not a package we install.
 */

/** The subset of `molplate_core::style::Look` the renderer needs. */
export interface LookSpec {
  style: string;
  color_mode: string;
  line_width: number | null;
}

/** A receipt from patinae's command engine. */
interface Receipt {
  result: { Ok: unknown } | { Err: string };
  messages: { kind: string; text: string }[];
  task_ids: string[];
}

/** The subset of patinae's `PatinaeViewer` this app uses. */
interface PatinaeViewer {
  init(): Promise<void>;
  loadData(data: Uint8Array, name: string, format: string): Receipt;
  execute(command: string): Promise<Receipt>;
  exportPng(options: { width?: number; height?: number; transparent?: boolean }): Promise<Blob>;
  countAtoms(selection?: string): number;
  destroy(): void;
}

type PatinaeViewerConstructor = new (
  container: HTMLElement,
  options?: { renderScale?: number },
) => PatinaeViewer;

/** The renderer cannot run here — no WebGPU, or patinae refused to start. */
export class RendererUnavailable extends Error {}

/** Where patinae's build lives, relative to the served page. */
const VENDOR_URL = "vendor/patinae/patinae-viewer.js";

/** Frames to let the scene settle before reading pixels out of it. */
const SETTLE_FRAMES = 3;

/**
 * How many Å of empty space "re-frame" leaves around the molecule.
 *
 * The exported figure is cropped to its content afterwards, so this only has to
 * guarantee no atom is clipped by the viewport; the visible margin comes from the crop.
 */
const FRAME_BUFFER_ANGSTROM = 1.5;

/**
 * Zoom is expressed as a change to that buffer, because the viewer exposes no camera
 * handle to JavaScript: its wheel handler moves the clipping planes, and only zooms when
 * a button is held. `zoom all, buffer=<Å>` is the one documented lever on apparent size.
 *
 * The range is on the fit's own scale. Above zero it only frames more loosely; below zero
 * it pushes past the fit, which is useful for looking closely but can clip atoms, so the
 * floor stays shallow and "re-frame" returns to the safe default.
 */
const ZOOM_STEP_ANGSTROM = 0.35;
const MIN_BUFFER_ANGSTROM = -1.5;
const MAX_BUFFER_ANGSTROM = 30;

/**
 * molplate's look vocabulary → patinae commands.
 *
 * patinae has no compound "ball and stick" representation and no `licorice`; both are
 * composed from sticks and spheres with their own radii, which is why the numbers below
 * are explicit rather than delegated. `lines` uses the line width from the look because
 * a 1 px line disappears at article size.
 */
function lookCommands(look: LookSpec): string[] {
  const common = ["hide"] as string[];
  switch (look.style) {
    case "vdw":
      return [...common, "show spheres", "set sphere_scale, 1.0"];
    case "licorice":
      return [...common, "show sticks", "set stick_radius, 0.30"];
    case "lines":
      return [
        ...common,
        "show lines",
        `set line_width, ${(look.line_width ?? 2.5).toFixed(1)}`,
      ];
    case "cartoon":
      return [...common, "show cartoon"];
    case "surface":
      return [...common, "show surface"];
    case "ball_stick":
    case "ballstick":
    default:
      return [
        ...common,
        "show sticks",
        "set stick_radius, 0.16",
        "show spheres",
        "set sphere_scale, 0.30",
      ];
  }
}

/**
 * molplate's colour modes → patinae's scheme names.
 *
 * `spectrum` is not a colour scheme here; patinae spells the N→C rainbow
 * `residue_index`, and maps `b_factor` from `beta`.
 */
function colorCommand(mode: string): string {
  switch (mode) {
    case "chain":
      return "color chain";
    case "residue":
    case "resid":
      return "color residue";
    case "index":
      return "color index";
    case "secstruct":
    case "ss":
      return "color ss";
    case "b_factor":
    case "bfactor":
    case "beta":
      return "color b_factor";
    case "element":
    default:
      return "color atomic";
  }
}

/** Extension of a structure name, which patinae's parser keys the format off. */
function formatOf(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return extension === "" ? "sdf" : extension;
}

/**
 * How many device pixels the viewer draws per CSS pixel.
 *
 * patinae's browser build has no MSAA — every pipeline is one sample — so FXAA alone
 * leaves a silhouette snapped to whole pixels (measured: 0.23 px of edge ramp, with the
 * silhouette still stepping one pixel between rows). Drawing the canvas at 2× and letting
 * the browser scale it down is the same supersampling the export does, and it is what
 * makes the live view match the saved figure.
 *
 * It is a multiple of the *CSS* pixel, not of `devicePixelRatio`: a 2× display already
 * antialiases when it downsamples, so multiplying that by two again would cost 16× the
 * pixels for no visible gain.
 */
function renderScale(): number {
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return Math.max(1, 2 / dpr);
}

function frames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const step = (): void => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** A started viewer. One per page: patinae owns a rAF loop and a canvas per handle. */
export class Renderer {
  /** Current camera buffer in Å, tracked so zoom is relative rather than absolute. */
  private frameBuffer = FRAME_BUFFER_ANGSTROM;

  private constructor(private readonly viewer: PatinaeViewer) {}

  /** Start patinae on `container`, or explain why it could not. */
  static async create(container: HTMLElement): Promise<Renderer> {
    // Checked before importing so the common case (Safari, older Chrome, a blocked
    // adapter) gets a sentence rather than a wasm trap.
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
    if (gpu === undefined) {
      throw new RendererUnavailable(
        "This browser does not provide WebGPU, which this app renders with. " +
          "Chrome 113+, Edge 113+ or Safari 26 on a supported GPU will work.",
      );
    }

    let PatinaeViewerClass: PatinaeViewerConstructor;
    try {
      const module = (await import(/* @vite-ignore */ new URL(VENDOR_URL, document.baseURI).href)) as {
        PatinaeViewer: PatinaeViewerConstructor;
      };
      PatinaeViewerClass = module.PatinaeViewer;
    } catch (error) {
      throw new RendererUnavailable(`The 3D viewer failed to load (${String(error)}).`);
    }

    const viewer = new PatinaeViewerClass(container, { renderScale: renderScale() });
    try {
      await viewer.init();
    } catch (error) {
      throw new RendererUnavailable(`The 3D viewer did not start (${String(error)}).`);
    }

    const renderer = new Renderer(viewer);
    // House style for a Wikipedia figure: opaque white, element colours, perspective.
    await renderer.run("set opaque_background, 1");
    await renderer.run("bg_color white");
    await renderer.run("set orthoscopic, 0");
    await renderer.run("set antialias, 2");
    return renderer;
  }

  /** Run one command, surfacing a failure as an exception the page can show. */
  private async run(command: string): Promise<void> {
    const receipt = await this.viewer.execute(command);
    if (!receipt) return;
    if (receipt.result && "Err" in receipt.result) {
      throw new Error(`${command}: ${receipt.result.Err}`);
    }
  }

  /**
   * Replace the current scene with one structure.
   *
   * `loadData` parses synchronously, so this is not a promise of a painted frame —
   * callers that need pixels should rely on {@link exportPng}, which settles first.
   */
  async loadStructure(name: string, bytes: Uint8Array): Promise<number> {
    const receipt = this.viewer.loadData(bytes, name, formatOf(name));
    if (receipt.result && "Err" in receipt.result) {
      throw new Error(`Could not parse ${name}: ${receipt.result.Err}`);
    }
    return this.viewer.countAtoms("all");
  }

  /** Apply a look: geometry plus its colouring. */
  async applyLook(look: LookSpec): Promise<void> {
    for (const command of lookCommands(look)) await this.run(command);
    await this.run(colorCommand(look.color_mode));
  }

  /** `"perspective"` or `"orthographic"`. patinae spells the latter `orthoscopic`. */
  async setProjection(mode: string): Promise<void> {
    await this.run(`set orthoscopic, ${mode === "orthographic" ? 1 : 0}`);
  }

  /** Background colour as sRGB 0…1, which is what the page's colour input gives. */
  async setBackground(r: number, g: number, b: number): Promise<void> {
    const channel = (value: number): string =>
      Math.round(Math.min(1, Math.max(0, value)) * 255)
        .toString(16)
        .padStart(2, "0");
    await this.run(`bg_color 0x${channel(r)}${channel(g)}${channel(b)}`);
  }

  /** Point the camera at the whole scene, leaving air around it. */
  async frameScene(): Promise<void> {
    this.frameBuffer = FRAME_BUFFER_ANGSTROM;
    await this.run("reset");
    await this.run("orient");
    await this.run(`zoom all, buffer=${FRAME_BUFFER_ANGSTROM}`);
  }

  /**
   * Zoom in (`notches > 0`) or out, relative to where the camera already is.
   *
   * Returns whether anything changed, so a caller can stop at the ends of the range
   * without tracking it.
   */
  async zoomBy(notches: number): Promise<boolean> {
    const next = Math.min(
      MAX_BUFFER_ANGSTROM,
      Math.max(MIN_BUFFER_ANGSTROM, this.frameBuffer - notches * ZOOM_STEP_ANGSTROM),
    );
    if (Math.abs(next - this.frameBuffer) < 1e-4) return false;
    this.frameBuffer = next;
    await this.run(`zoom all, buffer=${next.toFixed(2)}`);
    return true;
  }

  /**
   * Render a PNG at the requested size.
   *
   * patinae's export is offscreen and independent of the visible canvas size, so unlike
   * the surface-screenshot path this replaces, the wanted width can be passed directly.
   * With only a width, its aspect follows the *live* canvas — so callers that care about
   * the shape pass both dimensions.
   */
  async exportPng(options: { width: number; height: number; transparent: boolean }): Promise<Blob> {
    // A build task may still be finishing; a couple of frames is what makes the
    // difference between the new scene and the previous one in the image.
    await frames(SETTLE_FRAMES);
    return this.viewer.exportPng(options);
  }

  destroy(): void {
    this.viewer.destroy();
  }
}
