/**
 * The adapter between WikiMolGen 2's page and patinae's web viewer.
 *
 * patinae owns the canvas, its own animation-frame loop and the command engine; this
 * file is the only place that knows either of those facts. Everything the page asks for
 * is expressed as a method here, so the rest of `src/` stays renderer-agnostic, the same
 * property `wikimolgen2_core` has on the Rust side.
 *
 * The viewer is loaded from `public/vendor/patinae` (see the PROVENANCE.md there) rather
 * than from `node_modules`, because it is a prebuilt ES module plus wasm from another
 * repository, not a package we install.
 */

/** One element colour override, mirrored from `wikimolgen2_core::style::ElementColor`. */
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
  /** Distance where the fog starts, in Ångström. */
  fog_start: number;
  /** Draw the double-bond offset lines. */
  valence: boolean;
  /** Size of that offset. */
  stick_valence_scale: number;
  /** Ambient-occlusion radius, 0.1..2. */
  ao_radius: number;
  /** Shadow darkness, 0..1. */
  shadow_intensity: number;
  /** 0 off, 1 additive, 2 weighted average. */
  transparency_mode: number;
  /** Smooth polygon edges with FXAA. */
  antialias: boolean;
  /** Element scheme id, e.g. `"cpk"`. Resolved to inks by `appliedLook`. */
  scheme: string;
  /** Flat stick ink, or `null` for sticks that follow the atom colours. */
  stick_color: string | null;
  /** Ink for the `uniform` colour mode. */
  solid_color: string;
  /** Cartoon helix ink for the `sec_struct` mode. */
  helix_color: string;
  /** Cartoon sheet ink for the `sec_struct` mode. */
  sheet_color: string;
  /** Cartoon loop ink, the base of a `sec_struct` cartoon. */
  loop_color: string;
  element_colors: ElementColor[];
}

/** The subset of `wikimolgen2_core::style::Look` the renderer needs. */
export interface LookSpec {
  style: string;
  color_mode: string;
  line_width: number | null;
  appearance: Appearance;
}

/** Which secondary structures the scene has, so empty colour selections are skipped. */
interface Structure {
  helix: boolean;
  sheet: boolean;
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
  exportPng(options: {
    width?: number;
    height?: number;
    transparent?: boolean;
  }): Promise<Blob>;
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
 * Measured on aspirin: 1.5 Å drew the molecule at 46 percent of the stage height, 0.5 Å
 * draws it at 56 percent and still clears a carbon sphere (0.51 Å at scale 0.3).
 */
const FRAME_BUFFER_ANGSTROM = 0.5;

/**
 * Zoom changes the field of view, so the camera stays put and no atom is clipped.
 *
 * The camera has no JS handle, but `get_view` prints the 18-value PyMOL view and
 * `set_view` accepts it back; the field of view is the last value.
 */
const ZOOM_FACTOR = 0.88;
const MIN_FOV_DEG = 0.5;
const MAX_FOV_DEG = 60;

/**
 * WikiMolGen 2's look vocabulary → patinae commands.
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
 * WikiMolGen 2's colour modes → patinae's scheme names.
 *
 * `color ss` colours this scene uniformly, although the `ss` selection reports helix,
 * sheet and loop atoms correctly. The three named inks plus the `ss` selection give the
 * cartoon look wikimolgen renders. `uniform` is not a scheme: it paints every atom one
 * ink, which is the black-and-white figure wikimolgen calls `minimal_bw`.
 *
 * `structure` says which secondary structures the scene has: colouring an empty selection
 * is not an error in patinae, but it logs "0 atoms colored" as an error message.
 */
function colourCommands(look: LookSpec, structure: Structure): string[] {
  const appearance = look.appearance;
  switch (look.color_mode) {
    case "chain":
      return ["color chain"];
    case "residue":
    case "resid":
    case "residue_type":
      return ["color residue"];
    case "index":
    case "residue_index":
      return ["color index"];
    case "secstruct":
    case "sec_struct":
    case "ss":
      return [
        `color ${ink(appearance.loop_color)}, all`,
        ...(structure.helix ? [`color ${ink(appearance.helix_color)}, ss H`] : []),
        ...(structure.sheet ? [`color ${ink(appearance.sheet_color)}, ss S`] : []),
      ];
    case "b_factor":
    case "bfactor":
    case "beta":
      return ["color b_factor"];
    case "uniform":
    case "solid":
      return [`color ${ink(appearance.solid_color)}, all`];
    case "element":
    default:
      return ["color atomic"];
  }
}

/** `#rgb` or `#rrggbb` → three 0..255 channels. Anything else falls back to mid grey. */
function rgbOf(hex: string): [number, number, number] {
  let value = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    value = value
      .split("")
      .map((digit) => digit + digit)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return [128, 128, 128];
  const int = Number.parseInt(value, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

/** `#rrggbb` → the `0xrrggbb` literal patinae's colour parser accepts. */
function ink(hex: string): string {
  const [r, g, b] = rgbOf(hex);
  return `0x${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
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

/** Object name for the warm-up probe, so its commands never touch a real structure. */
const WARMUP_OBJECT = "wikimolgen2_warmup";

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
  /** In-flight pipeline warm-up, awaited before the first real structure load. */
  private warmup: Promise<void> | null = null;

  // Last command sent for each setting. A slider drag then costs one command per frame
  // instead of one per control, and the export can swap the background and restore it.
  private readonly sent = new Map<string, string>();

  /** Theme tint for the live stage; the export keeps its own background. */
  private stageTint: string | null = null;

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
    // A warm-up probe may still be in the scene, but it is its own object, so it cannot
    // interfere; the delete below removes it along with any previous structure.
    await this.runQuiet("delete all");
    const receipt = this.viewer.loadData(bytes, name, formatOf(name));
    if (receipt.result && "Err" in receipt.result) {
      throw new Error(`Could not parse ${name}: ${receipt.result.Err}`);
    }
    // Settings survive a load, but the new object starts uncoloured; resend every look.
    this.sent.clear();
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
    // The probe is its own object, so a warm-up that never finishes cannot touch a real
    // structure, and a load no longer has to wait for it.
    const probe = new TextEncoder().encode(warmupPdb());
    const receipt = this.viewer.loadData(probe, WARMUP_OBJECT, "pdb");
    if (receipt.result && "Err" in receipt.result) return;
    try {
      await this.run(`show cartoon, ${WARMUP_OBJECT}`);
      await this.run(`color ss, ${WARMUP_OBJECT}`);
      await frames(4);
    } finally {
      await this.runQuiet(`delete ${WARMUP_OBJECT}`);
    }
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

  /** Apply a look: geometry, its colouring, then the light and finish. */
  async applyLook(look: LookSpec): Promise<void> {
    await this.run("hide");
    for (const command of representationCommands(look)) await this.run(command);
    await this.applyColoring(look);
    await this.applyAppearance(look);
  }

  /**
   * Apply only the colouring: the mode, the element inks and the stick ink.
   *
   * A colour control calls this instead of {@link applyLook}, so choosing a palette does
   * not hide and re-show the representation. Sticks come last: `stick_color` is a setting
   * with a rebuild side effect, so it must not ride on an appearance slider.
   */
  async applyColoring(look: LookSpec): Promise<void> {
    const appearance = look.appearance;
    // Only the secondary-structure mode needs these selections, and each is a wasm call.
    const byStructure = look.color_mode === "sec_struct" || look.color_mode === "secstruct";
    const structure: Structure = byStructure
      ? { helix: this.count("ss H") > 0, sheet: this.count("ss S") > 0 }
      : { helix: false, sheet: false };
    for (const command of colourCommands(look, structure)) {
      await this.run(command);
    }
    await this.applyElementInks(appearance.element_colors);
    // `stick_color` rebuilds the stick buffers, so a chip drag must not resend it.
    const stickInk = appearance.stick_color === null ? "inherit" : ink(appearance.stick_color);
    await this.once("stick_color", `set stick_color, ${stickInk}`);
  }

  /**
   * Apply only the appearance: light, finish and background.
   *
   * A slider drag calls this instead of {@link applyLook}, so the representation is not
   * hidden and shown again on every input event. Each setting is sent only when its value
   * differs from the last one, so a frame costs one command, not twenty.
   */
  async applyAppearance(look: LookSpec): Promise<void> {
    const appearance = look.appearance;
    await this.once("bg_color", `bg_color ${ink(this.stageTint ?? appearance.background)}`);

    await this.once(
      "stick_transparency",
      `set stick_transparency, ${decimal(appearance.stick_transparency)}`,
    );
    await this.once(
      "sphere_transparency",
      `set sphere_transparency, ${decimal(appearance.sphere_transparency)}`,
    );
    await this.once(
      "cartoon_transparency",
      `set cartoon_transparency, ${decimal(appearance.cartoon_transparency)}`,
    );
    await this.once("stick_radius", `set stick_radius, ${decimal(appearance.stick_radius)}`);
    await this.once("sphere_scale", `set sphere_scale, ${decimal(appearance.sphere_scale)}`);
    await this.once("valence", `set valence, ${appearance.valence ? 1 : 0}`);
    await this.once(
      "stick_valence_scale",
      `set stick_valence_scale, ${decimal(appearance.stick_valence_scale)}`,
    );

    await this.once("ambient", `set ambient, ${decimal(appearance.ambient)}`);
    await this.once("direct", `set direct, ${decimal(appearance.direct)}`);
    await this.once("reflect", `set reflect, ${decimal(appearance.reflect)}`);
    await this.once("specular", `set specular, ${decimal(appearance.specular)}`);
    await this.once("shininess", `set shininess, ${decimal(appearance.shininess)}`);
    await this.once("transparency_mode", `set transparency_mode, ${appearance.transparency_mode}`);
    await this.once("fxaa_enabled", `set fxaa_enabled, ${appearance.antialias ? 1 : 0}`);

    // These switch a shader or a pipeline, so each one is only sent when it changes.
    await this.once(
      "shading_mode",
      `set shading_mode, ${appearance.shadows ? "full" : "classic"}`,
    );
    await this.once(
      "shadow_intensity",
      `set shadow_intensity, ${decimal(appearance.shadow_intensity)}`,
    );
    await this.once("ssao_enabled", `set ssao_enabled, ${appearance.ambient_occlusion ? 1 : 0}`);
    if (appearance.ambient_occlusion) {
      await this.once("ssao_intensity", `set ssao_intensity, ${decimal(appearance.ao_strength)}`);
      await this.once("ssao_radius", `set ssao_radius, ${decimal(appearance.ao_radius)}`);
    }
    await this.once("silhouettes", `set silhouettes, ${appearance.silhouettes ? 1 : 0}`);
    if (appearance.silhouettes) {
      await this.once(
        "silhouette_width",
        `set silhouette_width, ${decimal(appearance.silhouette_width)}`,
      );
      await this.once("silhouette_color", "set silhouette_color, 0x1a1a1a");
    }
    await this.once("depth_cue", `set depth_cue, ${appearance.depth_cue ? 1 : 0}`);
    await this.once("fog", `set fog, ${decimal(appearance.fog)}`);
    await this.once("fog_start", `set fog_start, ${decimal(appearance.fog_start)}`);
  }

  /**
   * Send a command unless it is the one already live for that setting.
   *
   * The export swaps the background and restores it, which works because the map holds
   * the last command rather than a set of everything ever sent.
   */
  private async once(key: string, command: string): Promise<void> {
    if (this.sent.get(key) === command) return;
    await this.run(command);
    this.sent.set(key, command);
  }

  /**
   * Paint one element's atoms, e.g. oxygen to a deeper red.
   *
   * The ink goes straight into the command: `color 0xrrggbb, elem O` needs no
   * `set_color` round trip and leaves the renderer's palette untouched.
   */
  private async applyElementInks(colors: ElementColor[]): Promise<void> {
    for (const { element, color } of colors) {
      await this.run(`color ${ink(color)}, elem ${element}`);
    }
  }

  /** `"perspective"` or `"orthographic"`. patinae spells the latter `orthoscopic`. */
  async setProjection(mode: string): Promise<void> {
    await this.run(`set orthoscopic, ${mode === "orthographic" ? 1 : 0}`);
  }

  /**
   * Set the live stage background to the active theme tint.
   *
   * The patinae surface is opaque, so the view cannot be alpha-transparent. This colour
   * matches the page behind the canvas, which gives the same visual result.
   */
  setStageTint(hex: string): void {
    if (this.stageTint === hex) return;
    this.stageTint = hex;
    void this.setBackgroundHex(hex).catch(() => undefined);
  }

  /** Set the background from a colour input value. */
  private async setBackgroundHex(hex: string): Promise<void> {
    await this.once("bg_color", `bg_color ${ink(hex)}`);
  }

  /**
   * Show element labels on every heavy atom, or remove them.
   *
   * The labels live in their own object so a toggle replaces them instead of stacking.
   * `name` is the atom name the SDF reader assigns, e.g. `O2`, not the element symbol.
   */
  async setLabels(enabled: boolean): Promise<void> {
    await this.runQuiet("delete wikimolgen2_labels");
    if (!enabled) return;
    await this.run("set label_size, 14");
    await this.run("label not elem C, name, object=wikimolgen2_labels");
    // The default label colour is a screen cyan; a figure needs ink that reads on white.
    await this.run("color black, wikimolgen2_labels");
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
   * Read the camera back as the 18-value view `get_view` prints.
   *
   * The 10th..12th values are the camera position, the 18th the vertical field of view.
   */
  private async readView(): Promise<number[] | null> {
    const receipt = await this.viewer.execute("get_view");
    if (!receipt || (receipt.result && "Err" in receipt.result)) return null;
    const text = receipt.messages.map((message) => message.text).join("\n");
    const numbers = text.match(/-?\d+\.\d+|-?\d+/g)?.map(Number) ?? [];
    return numbers.length >= 18 ? numbers.slice(0, 18) : null;
  }

  /** The scale-bar input: visible height in Ångström at the origin plane. */
  async cameraView(): Promise<CameraView | null> {
    const view = await this.readView();
    if (view === null) return null;
    const position = view.slice(9, 12);
    const fov = view[17] ?? 0;
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
    await this.run("reset");
    await this.run("orient");
    await this.run(`zoom all, buffer=${FRAME_BUFFER_ANGSTROM}`);
  }

  /** Turn the fitted camera by fixed angles, which is how a wiki preset normalises. */
  async turn(angles: { x: number; y: number; z: number }): Promise<void> {
    if (angles.x !== 0) await this.run(`turn x, ${angles.x}`);
    if (angles.y !== 0) await this.run(`turn y, ${angles.y}`);
    if (angles.z !== 0) await this.run(`turn z, ${angles.z}`);
  }

  /**
   * Zoom in (`notches > 0`) or out by changing the field of view.
   *
   * Returns whether anything changed, so a caller can stop at the ends of the range.
   */
  async zoomBy(notches: number): Promise<boolean> {
    const view = await this.readView();
    if (view === null) return false;
    const current = view[17] ?? 0;
    const next = Math.min(
      MAX_FOV_DEG,
      Math.max(MIN_FOV_DEG, current * Math.pow(ZOOM_FACTOR, notches)),
    );
    if (!Number.isFinite(next) || Math.abs(next - current) < 1e-3) return false;
    view[17] = next;
    await this.run(`set_view (${view.map((value) => value.toFixed(6)).join(", ")})`);
    return true;
  }

  /** Fit the camera to a selection, so a deep zoom can start from any part. */
  async zoomTo(selection: string): Promise<void> {
    await this.run(`zoom ${selection}, buffer=${FRAME_BUFFER_ANGSTROM}`);
  }

  /**
   * Render a PNG at the requested size.
   *
   * patinae's export is offscreen and independent of the visible canvas size, so unlike
   * the surface-screenshot path this replaces, the wanted width can be passed directly.
   * With only a width, its aspect follows the *live* canvas, so callers that care about
   * the shape pass both dimensions.
   */
  async exportPng(options: {
    width: number;
    height: number;
    transparent: boolean;
    background: string;
  }): Promise<Blob> {
    // The live stage is painted with the theme tint. The export uses the figure's own
    // background, so swap it in for the render and restore the tint afterwards.
    const stage = this.stageTint;
    await this.setBackgroundHex(options.transparent ? "#000000" : options.background);
    try {
      // A build task may still be finishing; a couple of frames is what makes the
      // difference between the new scene and the previous one in the image.
      await frames(SETTLE_FRAMES);
      return await this.viewer.exportPng({
        width: options.width,
        height: options.height,
        transparent: options.transparent,
      });
    } finally {
      if (stage !== null) {
        this.stageTint = null;
        this.setStageTint(stage);
      }
    }
  }

  destroy(): void {
    this.viewer.destroy();
  }
}
