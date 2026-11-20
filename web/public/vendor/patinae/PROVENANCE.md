# Vendored: patinae web viewer 0.5.4

These files are a **build output**, copied here verbatim from the build described below.
Nothing in this directory is edited by hand, to change it, rebuild from source and copy
again.

The build carries **one local patch**: the live canvas is supersampled. Everything else is
upstream as built. See [Local patch](#local-patch-live-supersampling) below.

| | |
| --- | --- |
| Upstream | <https://github.com/zmactep/pymol-rs> (formerly PyMOL-RS; "patinae") |
| Commit | `a52a315618bb1476fb250c2f4e1f26d5a759ab6c` |
| Version | 0.5.4 (`web/package.json`) |
| Licence | BSD-3-Clause, see `LICENSE` in this directory |
| Built | 2026-11-19 |

## Local patch: live supersampling

**What.** A `renderScale` option that multiplies the canvas backing store on top of
`window.devicePixelRatio`, in `web/ts/src/core/viewer.ts`: one line in `syncCanvasSize`,
plus the option plumbed through `api.ts` -> `ViewerCore` and documented in `types.ts`.
molplate passes `2`, so the canvas is drawn at twice its CSS size and the browser
downsamples it at present.

**Why.** The web build has no MSAA, every pipeline is `sample_count: 1`, and antialiases
with FXAA only: `antialias` merely gates FXAA (2 and 4 render identically), and
`antialias_shader` / `offscreen_rendering_multiplier` are declared but unused. Measured on
the live canvas, a silhouette had a 0.23 px edge ramp with visible stair-steps. With the
canvas supersampled: **0.62 px**, steps gone. Exports are unaffected, they supersample
again in Rust (`molplate_core::image_ops::resize`).

**What is deliberately not touched.** Pointer input. `devicePixelRatio` stays the value the
wasm sees through `configure_interaction` and every `offsetX * dpr` conversion, so panning
and rotation keep working: measured 15.08% / 10.94% of pixels moved per drag, unchanged in
kind from 1x. An earlier attempt scaled the input ratio too and killed camera input
entirely (0%), which is why `syncCanvasSize` is the only place the factor is applied.

**Cost.** 4x the pixels in the live viewport (574x825 CSS -> 1148x1651 backing in the app).
On a small molecule that is well under a frame; for a large assembly, lower `SUPERSAMPLE` in
`web/src/renderer.ts`.
## Why vendored instead of a dependency

patinae's `web/` crate declares its own `[workspace]` and depends on the rest of patinae
by **path** (`../crates/patinae-render`, …). That means:

* it cannot be consumed as a `cargo` git dependency, cargo resolves a git dependency
  through the manifest at the repository root, and this package is not a member of that
  workspace;
* depending on it by path would tie this repo to a checkout outside it;
* publishing it would mean copying ~200k lines into this repository.

So the page consumes the built ES module and its wasm directly. The cost is that
upgrading means re-running the build below, which is why the commit is recorded here.

## Rebuild

Requires the workspace toolchain (`scripts/dev-env.ps1`), `wasm32-unknown-unknown` and
Node 22+. Cargo's TLS is broken on this workstation, so the loopback crates mirror
(`D:\Projects\tools\crates-mirror\server.mjs`) must be running.

```powershell
git clone https://github.com/zmactep/pymol-rs.git <scratch>\patinae
cd <scratch>\patinae\web
npm ci
npm run build          # wasm-pack + vite, writes dist/ and pkg/
```

Then copy the three files below from `web/dist/` into this directory, plus the repository
`LICENSE`:

```
patinae-viewer.js       # the ES module facade (PatinaeViewer)
patinae_web_bg.wasm     # the renderer (WebGPU only)
patinae_web-<hash>.js   # wasm-bindgen glue; the hash changes between builds
```

`patinae-viewer.js` resolves `patinae_web_bg.wasm` relative to its own URL, so all three
files must stay together under the same path. The facade also imports its glue chunk by
relative path, keep it alongside.

## What the vendored build does not include

* No native plugins (`plugins/raytracer` is a native cdylib), so no ray tracing here.
* `wasm-pack build --no-opt` is what `npm run build` runs, so the wasm is **not**
  wasm-opt'd. A production deploy would add that pass for a smaller payload.
