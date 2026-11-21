/**
 * The adapter between molplate's page and patinae's web viewer.
 *
 * patinae owns the canvas, its own animation-frame loop and the command engine; this
 * file is the only place that knows either of those facts. Everything the page asks for
 * is expressed as a method here, so the rest of `src/` stays renderer-agnostic, the same
 * property `molplate_core` has on the Rust side.
 *
 * The viewer is loaded from `public/vendor/patinae` (see the PROVENANCE.md there) rather
 * than from `node_modules`, because it is a prebuilt ES module plus wasm from another
 * repository, not a package we install.
 */

/** One element colour override, mirrored from `molplate_core::style::ElementColor`. */
export interface ElementColor {
  element: string;
  color: string;
}

/** Everything about a look that is not geometry, mirrored from `Appearance`. */
export interface Appearance {
  background: string;
  gradient: [string, string] | null;
  stick_radius: number;
  sphere_scale: number;
  stick_transparency: number;
  sphere_transparency: number;
  cartoon_transparency: number;
  ambient: number;
  direct: number;
  reflect: number;
  specular: number;
  shininess: number;
  shadows: boolean;
  ambient_occlusion: boolean;
  ao_strength: number;
  silhouettes: boolean;
  silhouette_width: number;
  depth_cue: boolean;
  fog: number;
  element_colors: ElementColor[];
}

/** The subset of `molplate_core::style::Look` the renderer needs. */
export interface LookSpec {
  style: string;
  color_mode: string;
  line_width: number | null;
  appearance: Appearance;
}

/** The camera fields a scale bar needs, read back from `get_view`. */
export interface CameraView {
  /** Visible height in Ångström at the origin plane. */
  viewHeight: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Distance from the camera to the origin plane. */
  distance: number;
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
  getSequenceData(): { chain_id: string; residues: unknown[] }[];
  destroy(): void;
}

type PatinaeViewerConstructor = new (
  container: HTMLElement,
  options?: { renderScale?: number },
) => PatinaeViewer;

/** The renderer cannot run here, no WebGPU, or patinae refused to start. */
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
function representationCommands(look: LookSpec): string[] {
  const radius = look.appearance.stick_radius.toFixed(3);
  const sphere = look.appearance.sphere_scale.toFixed(3);
  switch (look.style) {
    case "vdw":
      return ["show spheres", `set sphere_scale, ${sphere}`];
    case "licorice":
      return ["show sticks", `set stick_radius, ${radius}`];
    case "lines":
      return ["show lines", `set line_width, ${(look.line_width ?? 2.5).toFixed(1)}`];
    case "cartoon":
      return ["show cartoon"];
    case "surface":
      return ["show surface"];
    case "ball_stick":
    case "ballstick":
    default:
      return [
        "show sticks",
        `set stick_radius, ${radius}`,
        "show spheres",
        `set sphere_scale, ${sphere}`,
      ];
  }
}

/**
 * molplate's colour modes → patinae's scheme names.
 *
 * `color ss` colours this scene uniformly, although the `ss` selection reports helix,
 * sheet and loop atoms correctly. The three named palette colours plus the `ss` selection
 * give the documented PyMOL cartoon look.
 */
function colourCommands(mode: string): string[] {
  switch (mode) {
    case "chain":
      return ["color chain"];
    case "residue":
    case "resid":
      return ["color residue"];
    case "index":
      return ["color index"];
    case "secstruct":
    case "sec_struct":
    case "ss":
      return ["color ss_loop, all", "color ss_helix, ss H", "color ss_sheet, ss S"];
    case "b_factor":
    case "bfactor":
    case "beta":
      return ["color b_factor"];
    case "element":
    default:
      return ["color atomic"];
  }
}

/** `#rrggbb` → three 0..255 channels. A malformed value falls back to mid grey. */
function rgbOf(hex: string): [number, number, number] {
  const value = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return [128, 128, 128];
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** Fixed-point form for a command argument, with a safe fallback. */
function decimal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0";
}

/** A four-atom backbone per residue, used for the cartoon pipeline warm-up. */
const PROBE_BACKBONE: [string, string, number, number][] = [
  [" N  ", " N", -0.6, 0.8],
  [" CA ", " C", 0.0, 0.0],
  [" C  ", " C", 0.6, 0.8],
  [" O  ", " O", 1.1, 1.6],
];

/**
 * Build a six-residue polyalanine probe.
 *
 * The first cartoon frame compiles the cartoon pipelines, which costs seconds in the
 * browser. A probe with the same representation pays that cost before the user asks for
 * a protein. Six residues are enough to build a cartoon trace.
 */
function warmupPdb(): string {
  const lines: string[] = [];
  let serial = 1;
  for (let residue = 1; residue <= 6; residue += 1) {
    const base = (residue - 1) * 3.8;
    for (const [atom, element, dx, dy] of PROBE_BACKBONE) {
      const x = (base + dx).toFixed(3).padStart(8);
      const y = dy.toFixed(3).padStart(8);
      const z = (0).toFixed(3).padStart(8);
      const residueNumber = String(residue).padStart(4);
      lines.push(
        `ATOM  ${String(serial).padStart(5)} ${atom} ALA A${residueNumber}    ${x}${y}${z}  1.00 20.00           ${element}`,
      );
      serial += 1;
    }
  }
  lines.push("END");
  return lines.join("\n");
}

/** Extension of a structure name, which patinae's parser keys the format off. */
function formatOf(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return extension === "" ? "sdf" : extension;
}

/**
 * Draw the viewer canvas at this multiple of its CSS size; the browser downsamples it.
 *
 * patinae's browser build antialiases with FXAA only, no MSAA anywhere, and its
 * supersampling settings are declared but unused, so a silhouette is one hard pixel
 * (measured: 0.23 px edge ramp, visible stair-steps). Rendering the canvas at 2x and
 * letting the compositor scale it down is what makes the live view smooth: measured
 * 0.62 px ramp, roughly 2.7x wider, and the steps are gone. Exports are unaffected : 
 * they supersample again in Rust.
 */
const SUPERSAMPLE = 2;

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

  /** In-flight pipeline warm-up, awaited before the first real structure load. */
  private warmup: Promise<void> | null = null;

  // Last values of the settings whose change reloads a shader or a pipeline. They start
  // at the renderer's defaults, so the first look does not reload a shader for nothing.
  private lastBackground = "";
  private lastShading = "classic";
  private lastAo = false;
  private lastSilhouettes = false;
  private lastDepthCue = true;

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

    const viewer = new PatinaeViewerClass(container, { renderScale: SUPERSAMPLE });
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
   * `loadData` parses synchronously, so this is not a promise of a painted frame : 
   * callers that need pixels should rely on {@link exportPng}, which settles first.
   */
  async loadStructure(name: string, bytes: Uint8Array): Promise<number> {
    // A warm-up probe may still own the scene; let it finish before replacing it.
    const warming = this.warmup;
    if (warming !== null) await warming;
    // `loadData` inserts an object and keeps the scene, so a second lookup would stack
    // two molecules. Clearing first makes every load an independent figure.
    await this.runQuiet("delete all");
    const receipt = this.viewer.loadData(bytes, name, formatOf(name));
    if (receipt.result && "Err" in receipt.result) {
      throw new Error(`Could not parse ${name}: ${receipt.result.Err}`);
    }
    return this.viewer.countAtoms("all");
  }

  /**
   * Compile the cartoon pipelines on a probe, before a user asks for a protein.
   *
   * Measured on 1CRN: the first cartoon frame takes 3.1-3.5 s of pipeline compilation.
   * A six-residue probe at startup moves that cost off the load path. The caller hides
   * the canvas, so the probe is never visible.
   */
  startWarmup(): Promise<void> {
    if (this.warmup === null) {
      this.warmup = this.warmCartoon()
        .catch(() => {
          // A warm-up is an optimisation; a failure must not block a real load.
        })
        .finally(() => {
          this.warmup = null;
        });
    }
    return this.warmup;
  }

  private async warmCartoon(): Promise<void> {
    const probe = new TextEncoder().encode(warmupPdb());
    const receipt = this.viewer.loadData(probe, "warmup.pdb", "pdb");
    if (receipt.result && "Err" in receipt.result) return;
    await this.run("show cartoon");
    await this.run("color ss");
    await frames(4);
    await this.runQuiet("delete all");
  }

  /** Atoms in a selection, for summaries and for label targeting. */
  count(selection: string): number {
    return this.viewer.countAtoms(selection);
  }

  /** Chains and residues in the scene, for a protein summary. */
  sequenceSummary(): { chains: number; residues: number } {
    const chains = this.viewer.getSequenceData();
    return {
      chains: chains.length,
      residues: chains.reduce((total, chain) => total + chain.residues.length, 0),
    };
  }

  /** Apply a look: geometry plus its colouring, then the appearance. */
  async applyLook(look: LookSpec): Promise<void> {
    await this.run("hide");
    for (const command of representationCommands(look)) await this.run(command);
    for (const command of colourCommands(look.color_mode)) await this.run(command);
    await this.applyAppearance(look);
  }

  /**
   * Apply only the appearance: light, finish, background and element overrides.
   *
   * A slider drag calls this instead of {@link applyLook}, so the representation is not
   * hidden and shown again on every input event.
   */
  async applyAppearance(look: LookSpec): Promise<void> {
    const appearance = look.appearance;
    await this.setBackgroundHex(appearance.background);

    await this.run(`set stick_transparency, ${decimal(appearance.stick_transparency)}`);
    await this.run(`set sphere_transparency, ${decimal(appearance.sphere_transparency)}`);
    await this.run(`set cartoon_transparency, ${decimal(appearance.cartoon_transparency)}`);
    await this.run(`set stick_radius, ${decimal(appearance.stick_radius)}`);
    await this.run(`set sphere_scale, ${decimal(appearance.sphere_scale)}`);

    await this.run(`set ambient, ${decimal(appearance.ambient)}`);
    await this.run(`set direct, ${decimal(appearance.direct)}`);
    await this.run(`set reflect, ${decimal(appearance.reflect)}`);
    await this.run(`set specular, ${decimal(appearance.specular)}`);
    await this.run(`set shininess, ${decimal(appearance.shininess)}`);

    // These settings trigger a shader reload. Only send the command when it changes.
    const shading = appearance.shadows ? "full" : "classic";
    if (shading !== this.lastShading) {
      await this.run(`set shading_mode, ${shading}`);
      this.lastShading = shading;
    }
    if (appearance.ambient_occlusion !== this.lastAo) {
      await this.run(`set ssao_enabled, ${appearance.ambient_occlusion ? 1 : 0}`);
      this.lastAo = appearance.ambient_occlusion;
    }
    if (appearance.ambient_occlusion) {
      await this.run(`set ssao_intensity, ${decimal(appearance.ao_strength)}`);
      await this.run("set ssao_radius, 0.5");
    }
    if (appearance.silhouettes !== this.lastSilhouettes) {
      await this.run(`set silhouettes, ${appearance.silhouettes ? 1 : 0}`);
      this.lastSilhouettes = appearance.silhouettes;
    }
    if (appearance.silhouettes) {
      await this.run(`set silhouette_width, ${decimal(appearance.silhouette_width)}`);
      await this.run("set silhouette_color, 0x1a1a1a");
    }
    if (appearance.depth_cue !== this.lastDepthCue) {
      await this.run(`set depth_cue, ${appearance.depth_cue ? 1 : 0}`);
      this.lastDepthCue = appearance.depth_cue;
    }
    await this.run(`set fog, ${decimal(appearance.fog)}`);

    await this.applyElementColors(appearance.element_colors);
  }

  /** Override one element colour, e.g. oxygen to a brighter red. */
  private async applyElementColors(colors: ElementColor[]): Promise<void> {
    for (const { element, color } of colors) {
      const [r, g, b] = rgbOf(color);
      const name = `molplate_${element.toLowerCase()}`;
      await this.run(`set_color ${name}, [${r}, ${g}, ${b}]`);
      await this.run(`color ${name}, elem ${element}`);
    }
  }

  /** `"perspective"` or `"orthographic"`. patinae spells the latter `orthoscopic`. */
  async setProjection(mode: string): Promise<void> {
    await this.run(`set orthoscopic, ${mode === "orthographic" ? 1 : 0}`);
  }

  /** Set the background from a colour input value. */
  private async setBackgroundHex(hex: string): Promise<void> {
    if (hex === this.lastBackground) return;
    const [r, g, b] = rgbOf(hex);
    await this.run(`bg_color 0x${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    this.lastBackground = hex;
  }

  /**
   * Show element labels on every heavy atom, or remove them.
   *
   * The labels live in their own object so a toggle replaces them instead of stacking.
   * `name` is the atom name the SDF reader assigns, e.g. `O2`, not the element symbol.
   */
  async setLabels(enabled: boolean): Promise<void> {
    await this.runQuiet("delete molplate_labels");
    if (!enabled) return;
    await this.run("set label_size, 14");
    await this.run("label not elem C, name, object=molplate_labels");
    // The default label colour is a screen cyan; a figure needs ink that reads on white.
    await this.run("color black, molplate_labels");
  }

  /** Label height in render pixels. The export path scales this with the figure. */
  async setLabelSize(pixels: number): Promise<void> {
    await this.run(`set label_size, ${Math.max(6, Math.round(pixels))}`);
  }

  /** Run a command and ignore a failure, for cleanup that may find nothing. */
  private async runQuiet(command: string): Promise<void> {
    try {
      await this.run(command);
    } catch {
      // The object was already absent; nothing to clean up.
    }
  }

  /**
   * Read the camera back as the scale-bar input: visible height in Ångström.
   *
   * `get_view` prints the 18-value PyMOL view. The 10th..12th values are the camera
   * position, and the 18th is the vertical field of view in degrees.
   */
  async cameraView(): Promise<CameraView | null> {
    const receipt = await this.viewer.execute("get_view");
    if (!receipt || (receipt.result && "Err" in receipt.result)) return null;
    const text = receipt.messages.map((message) => message.text).join("\n");
    const numbers = text.match(/-?\d+\.\d+|-?\d+/g)?.map(Number) ?? [];
    if (numbers.length < 18) return null;
    const position = numbers.slice(9, 12);
    const fov = numbers[17] ?? 0;
    const distance = Math.abs(position[2] ?? 0) || Math.hypot(...position);
    if (!Number.isFinite(fov) || fov <= 0 || distance <= 0) return null;
    return {
      viewHeight: 2 * distance * Math.tan((fov * Math.PI) / 360),
      fov,
      distance,
    };
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
   * With only a width, its aspect follows the *live* canvas, so callers that care about
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
