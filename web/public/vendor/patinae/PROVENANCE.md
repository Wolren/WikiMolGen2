# Vendored: patinae web viewer 0.5.4

These files are a **build output**, copied here verbatim from the build described below.
Nothing in this directory is edited by hand — to change it, rebuild from source and copy
again.

The build is upstream's, **with one local patch** (see [Local patch](#local-patch)). That
is the one place this directory is not a pure upstream artifact.

| | |
| --- | --- |
| Upstream | <https://github.com/zmactep/pymol-rs> (formerly PyMOL-RS; "patinae") |
| Commit | `a52a315618bb1476fb250c2f4e1f26d5a759ab6c` |
| Version | 0.5.4 (`web/package.json`) |
| Licence | BSD-3-Clause — see `LICENSE` in this directory |
| Built | 2026-11-19 |

## Local patch

**What.** A `renderScale` option that multiplies the canvas backing store on top of
`window.devicePixelRatio`. molplate passes `max(1, 2 / devicePixelRatio)`, so the live
canvas is always drawn at about twice its CSS size and the browser downsamples it — a 2×
display keeps `renderScale: 1`, because it antialiases when it downsamples anyway.

**Why.** The web build renders with `sample_count: 1` everywhere and antialiases with FXAA
only: `antialias` merely gates FXAA (2 and 4 render identically), `antialias_shader` is
declared but not registered as a setting, and `offscreen_rendering_multiplier` is declared
and unused. Measured on the live canvas, FXAA gives a 0.23 px edge ramp while the
silhouette still steps a full pixel between rows — visibly worse than the MSAA the previous
renderer got for free. Supersampling the canvas is the same fix the export already uses.

**Where.** Three files in `web/ts/src/core/`:

* `viewer.ts` — a `renderScale` constructor argument (clamped to 1…4), a `pixelRatio()`
  helper, and three `window.devicePixelRatio` readers replaced by it: `bindEvents`,
  `resizeViewport` and `syncCanvasSize`.
* `api.ts` — passes `options.renderScale ?? 1` into `ViewerCore`.
* `types.ts` — documents `renderScale` on `ViewerOptions`.

Input is unaffected: the same factor reaches the wasm side through
`configure_interaction(macos, dpr)` and through every `offsetX * this.dpr` conversion, so
picking and dragging stay aligned with what is drawn. `renderScale: 1` reproduces
upstream behaviour exactly.

**Cost.** 4× the pixels in the live viewport. For a small molecule that is a fraction of a
millisecond; for a large assembly it is the first thing to lower.

**Upgrading.** Re-apply the three edits after a rebase. If upstream gains MSAA or a real
resolution option, drop the patch instead — it exists only to compensate for their absence.


## Why vendored instead of a dependency

patinae's `web/` crate declares its own `[workspace]` and depends on the rest of patinae
by **path** (`../crates/patinae-render`, …). That means:

* it cannot be consumed as a `cargo` git dependency — cargo resolves a git dependency
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
relative path — keep it alongside.

## What the vendored build does not include

* No native plugins (`plugins/raytracer` is a native cdylib) — so no ray tracing here.
* `wasm-pack build --no-opt` is what `npm run build` runs, so the wasm is **not**
  wasm-opt'd. A production deploy would add that pass for a smaller payload.
