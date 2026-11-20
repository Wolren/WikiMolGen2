# Vendored: patinae web viewer 0.5.4

These files are a **build output**, copied here verbatim from the build described below.
Nothing in this directory is edited by hand — to change it, rebuild from source and copy
again.

The build is plain upstream: no local patch is applied. (One was tried and reverted; see
[Rejected patch](#rejected-patch-live-supersampling) — read it before re-attempting.)

| | |
| --- | --- |
| Upstream | <https://github.com/zmactep/pymol-rs> (formerly PyMOL-RS; "patinae") |
| Commit | `a52a315618bb1476fb250c2f4e1f26d5a759ab6c` |
| Version | 0.5.4 (`web/package.json`) |
| Licence | BSD-3-Clause — see `LICENSE` in this directory |
| Built | 2026-11-19 |

## Rejected patch: live supersampling

**What was tried.** A `renderScale` option that multiplies the canvas backing store on top
of `window.devicePixelRatio`, with molplate passing `max(1, 2 / devicePixelRatio)` so the
live canvas is drawn at about twice its CSS size and the browser downsamples it.

**Why it was wanted.** The web build renders with `sample_count: 1` everywhere and
antialiases with FXAA only: `antialias` merely gates FXAA (2 and 4 render identically),
`antialias_shader` is declared but not registered as a setting, and
`offscreen_rendering_multiplier` is declared and unused. On the live canvas FXAA gives a
0.23 px edge ramp while the silhouette still steps a full pixel between rows. The patch did
fix the picture — 0.23 px to 0.71 px — and is why exports and the live view would match.

**Why it was reverted.** It broke camera input. With the patch, dragging produced a
byte-identical render: middle-drag panning and left-drag rotation both moved **0 %** of
pixels, versus 10.2 % and 7.1 % without it. Bisecting the two changes it makes:

| configuration | pan moved |
| --- | --- |
| `display_scale` 1, backing 1200×1006 (upstream) | 10.0 % |
| `configure_interaction(…, 2)` alone | 7.2 % |
| backing 2400×2012 alone | 6.2 % |
| both together (what `renderScale: 2` does) | **0 %** |

Each half alone already *weakens* panning and together they kill it, so the cause is an
interaction between the `display_scale` hint and the viewport size, somewhere in the input
or camera path — not something to guess at. Frame timing was ruled out: p95 stayed 16.7 ms
and ~248 frames were drawn during the drag at both scales.

**If you re-attempt it.** Fix this first, and treat the table above as the regression test.
The likely culprit is `take_camera_deltas` short-circuiting on `manipulation_reserved()`, or
`configure_interaction` cancelling the pointer when `display_scale` changes. Prefer an
upstream change (MSAA, or a real render-resolution setting) over a local patch.

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
