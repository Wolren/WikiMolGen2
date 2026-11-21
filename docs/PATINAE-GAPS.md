# patinae: problems and gaps

What WikiMolGen 2 hit while it built a molecule figure tool on patinae, the Rust molecular
renderer behind the WebGPU viewer. The aim is a list we can turn into a feature request.

| | |
| --- | --- |
| patinae version | 0.5.4 (`web/package.json` in the upstream repo) |
| Commit under test | `a52a315618bb1476fb250c2f4e1f26d5a759ab6c` |
| Build | `wasm-pack build --no-opt`, one local patch (live canvas supersampling) |
| How WikiMolGen 2 drives it | command strings through `PatinaeViewer.execute` and `loadData` |
| Date | 2026-11-21 |

Evidence is marked **measured** (seen in this project, with the command or run) or
**source** (read from the upstream Rust at the commit above). Claims about absence rest on
the settings registry in `crates/patinae-settings/src/groups/` and on string searches of
the built wasm.

## 1. Defects that cost work

### 1.1 A command can hang the page, and nothing times out

**measured.** A page load waited in `execute("show cartoon")` for more than 90 seconds on
the third WebGPU page in one browser process. The promise never settled. Every later load
awaited that warm-up and froze in the same place, with the overlay stuck on "Drawing…".
There is no deadline and no cancel on the JS side, so the only exit is a reload.

The workaround in `web/src/renderer.ts`: the warm-up probe is a named object, and a load
no longer waits for the warm-up to finish.

**Request.** `execute(command, { timeoutMs })`, rejecting with a typed timeout while the
command queue stays usable. Plus `abort()` for a warm-up or a long compile.

### 1.2 Shader compilation has no progress event and no precompile

**measured.** The first cartoon frame costs 3.1 to 3.5 s while pipelines compile
(`docs/UPGRADE-REPORT.md`). patinae reports nothing during the compile. WikiMolGen 2 hides the
cost by rendering a six-residue probe at startup, which is a hidden load with a fake user
operation behind it.

**Request.** `precompile(["cartoon", "sticks", "spheres", "surface"])` and
`onProgress({ phase, pipelines, done })`. A warm-up then needs no probe object at all.

### 1.3 The settings registry and the session document disagree

**measured.** `set two_sided_lighting, 0` fails with:

```
invalid argument 'name': Unknown setting: two_sided_lighting
```

The name exists in the wasm's session settings table but not in any settings group, so the
`set` command cannot reach it. The same holds for `stick_quality` and `sphere_quality`:
both strings are in the wasm, and neither appears in `groups/*.rs`. Two settings that
wikimolgen exposes for its renderer are therefore unreachable from the web command line.

**Request.** One registry that describes every settable field, including the quality and
lighting fields of the session document. A `get settings --json` would let a UI discover
it.

### 1.4 An empty selection is reported as an error

**measured.** `color ss_helix, all` on a small molecule prints `Color: 0 atoms colored
ss_helix` at error level for every molecule with no helix. WikiMolGen 2 counts the atoms first
and sends a command only for a non-empty selection, which is one round trip per secondary
structure type.

**Request.** A quiet flag, or a result object with `{ matched, colored }` and an event
level that a UI can ignore.

### 1.5 No colour read-back

**source and measured.** There is no `get_color` in the wasm exports. WikiMolGen 2 keeps its own
copy of every ink, resolves the element scheme in JavaScript and resends it after each
load. Any external change to a colour makes the page's state wrong.

**Request.** `get colors, <selection>` returning `[{ atom, color }]`, or
`get_color, <selection>` for one colour.

### 1.6 No alpha in the live surface

**source and measured.** The WebGPU surface is opaque (`docs/SPEC.md`). The page paints the
theme tint under the canvas instead. The export supports transparency because it composes
in Rust, so the live and exported views differ.

**Request.** An alpha surface, or a shareable clear colour with premultiplied alpha.

### 1.7 No gradient clear

**measured.** A vertical gradient is composited behind the exported PNG in Rust. The live
canvas can only take one colour (`background`), so the stage cannot preview the export.

**Request.** A clear pass that takes two colours, or a background texture.

### 1.8 No MSAA in the web build

**source.** `web/public/vendor/patinae/PROVENANCE.md`: every pipeline is `sample_count: 1`,
antialiasing is FXAA only, `antialias` merely gates FXAA (2 and 4 render identically), and
`antialias_shader` and `offscreen_rendering_multiplier` are declared but unused. WikiMolGen 2
patches `renderScale` to supersample the canvas 2x, which raised a silhouette edge ramp
from 0.23 px to 0.62 px.

**Request.** MSAA 4x on the main passes, or a documented offscreen render multiplier that
works.

### 1.9 The export edge cap is 8192 px

**measured.** A 4x export at 2000 px wide (8000x10884) did not complete; 3x
(6000x8163) did. The adapter reports a 16384 limit, so the cap is the app's own safety
margin (`docs/SPEC.md`). A tiled export is the useful next step.

### 1.10 A prefetch cannot load a hidden object

**measured.** `loadData` always inserts a visible object. The startup warm-up has to name
its probe, show a cartoon on it, and delete it. If the warm-up is abandoned, the object
stays in the scene until the next `delete all`.

**Request.** `loadData(data, name, format, { hidden: true })`, or the precompile API from
1.2.

### 1.11 Errors are strings with no code

**measured.** The command error above is a string from `CmdError::invalid_arg`. A UI cannot
tell "unknown setting" from "bad value" or "no such object" without parsing English.

**Request.** `{ code: "unknown_setting", setting: "two_sided_lighting" }` on the JS side.

### 1.12 The web API has no type definitions

**source.** WikiMolGen 2 declares its own `PatinaeViewer` type and learns command names from
the Rust source. The published facade has no `.d.ts` and no command catalog.

**Request.** A generated `patinae.d.ts` and a JSON list of commands with argument types, so
an editor can check a call before a figure is rendered.

### 1.13 Ray tracing is not in the wasm build

**source.** `plugins/raytracer` is a native cdylib and is not built for wasm
(`PROVENANCE.md`). WikiMolGen 2 therefore cannot offer ray-traced figures, which wikimolgen
gets from PyMOL.

**Request.** Either a wasm ray tracer (long term), or a documented scope statement with a
server-side path.

### 1.14 Secondary structure colouring is one colour per command

**measured.** `color ss, all` paints every secondary structure with one ink. A helix, sheet
and loop palette needs three commands with `ss H`, `ss S` and `not ss H and not ss S`
selections, each guarded against an empty selection (see 1.4).

**Request.** `color ss, all` accepting a three-colour value, or named inks per SS type.

## 2. Depth that wikimolgen has and this build cannot reach

| wikimolgen control | patinae 0.5.4 | Why |
| --- | --- | --- |
| Ray tracing mode 0 to 3 | absent | native plugin, not in wasm |
| Ray shadows | absent | same |
| Stick quality | session field, not in `set` | registry mismatch, 1.3 |
| Sphere quality | session field, not in `set` | registry mismatch, 1.3 |
| Two-sided lighting | session field, not in `set` | registry mismatch, 1.3 |
| Conformer generation | absent | a chemistry job, not a renderer job |
| Background alpha | absent | opaque surface, 1.6 |
| Background gradient | absent | opaque surface, 1.7 |
| MSAA levels | absent | FXAA only, 1.8 |

Everything else in wikimolgen's 3D panel has a patinae setting and is now in WikiMolGen 2's
Appearance panel: stick radius, sphere size, valence, the five light values, three
transparencies, transparency mode, ambient occlusion with strength and radius, soft shadows
with strength, outline, depth cue with fog and fog start, antialias, projection.

## 3. Capability that exists but WikiMolGen 2 does not expose

These are opportunities, not defects. Each has a setting group and a working command.

| Area | Settings and commands | Use for a figure tool |
| --- | --- | --- |
| Surface | `surface_mode`, `surface_quality`, `solvent_radius`, `surface_color_smoothing`, `surface_transparency` | a binding-site figure |
| Mesh | `mesh_quality`, `mesh_solvent`, `mesh_transparency` | an electron-density style figure |
| Cartoon | `cartoon_sampling`, `cartoon_oval_width`, `cartoon_rect_width`, `cartoon_arrow_tip_scale`, `cartoon_round_helices` | journal-quality protein cartoons |
| Ribbon | `ribbon_sampling`, `ribbon_radius` | a second protein style |
| Lights | `light_count`, `light2` to `light9`, `spec_direct` | studio lighting |
| Shadows | `shadow_map_size`, `shadow_bias`, `shadow_pcf` | softer or crisper shadows |
| Silhouette | `silhouette_depth_jump` | outlines that skip hidden depth jumps |
| Movie | `movie_loop`, `movie_fps` | animated figures |
| Measurement | `dash_*`, `angle_*`, `label_size` | annotated distances |
| Editor | `create`, `remove`, `alter`, `h_add` | fixing a record before the render |

## 4. Propositions for the feature request

Ordered by what unblocks the most work.

1. **Deadline and cancel on every command.** `execute(cmd, { timeoutMs })` plus `abort()`.
   One hung compile should not take the page down (1.1).
2. **Precompile and progress.** `precompile(reps)`, `onProgress(phase, done)`. Replaces the
   probe warm-up and makes the first protein honest (1.2, 1.10).
3. **One settings registry.** Every session field settable, including
   `two_sided_lighting`, `stick_quality`, `sphere_quality`, with a JSON listing (1.3).
4. **Typed JS API.** Generated `.d.ts`, typed errors with codes, a command catalog (1.11,
   1.12).
5. **Selection results, not console errors.** `{ matched, affected }`, quiet mode (1.4).
6. **Colour queries.** `get colors` and `get_color` (1.5).
7. **Live alpha and gradient.** A clear colour with alpha and a two-colour clear (1.6,
   1.7).
8. **MSAA 4x, or a working offscreen multiplier.** The supersampled canvas is a patch, not
   an API (1.8).
9. **Tiled export above 8192 px.** Or a documented cap with a clear error (1.9).
10. **Secondary-structure palette.** One command, three inks (1.14).
11. **Ray tracing in wasm, or a scope statement.** If it stays native, say so in the web
    README (1.13).
12. **wasm-opt in the release build.** The vendored wasm is 4.2 MB unoptimised
    (`PROVENANCE.md`).

## 5. How each claim was measured

- `set two_sided_lighting, 0` ran in the built page on 2026-11-21; the console showed the
  exact error in 1.3.
- The 90 s stall came from the end-to-end check (`scripts/verify.mjs`) on a page opened with
  `?q=aspirin`; the overlay text was "Drawing…" and the resource entries showed the
  PubChem requests had finished in 1 ms each.
- The settings inventory is the union of `name = "..."` entries in
  `crates/patinae-settings/src/groups/*.rs` at the commit above. The group files are the
  registry the `set` command resolves against.
- The wasm strings were read with an ASCII scan of
  `web/public/vendor/patinae/patinae_web_bg.wasm`; a name present there and absent from the
  group files is a session field, not a command setting.
- Compile times, the 0.23 px edge ramp, the 8192 px export failure and the missing MSAA all
  come from measurements already recorded in `docs/UPGRADE-REPORT.md`,
  `docs/SPEC.md` and `web/public/vendor/patinae/PROVENANCE.md`.
