# ADR 0001 — Architecture of the molplate web app

Status: accepted (2026-11-19)
Supersedes: nothing

## Context

The goal is a browser tool with the job WikiMolGen does on the desktop: take a compound
(PubChem name, CID or SMILES), produce a publication-quality structural image, and hand
back the Wikipedia/Commons markup that goes with it — without a server, an install, or a
Python environment.

Two constraints shape everything:

1. **All computation happens in the browser.** Structures are fetched straight from
   PubChem (it allows cross-origin requests) and rendered locally with WebAssembly.
2. **The renderer already exists.** [`molar_vis`](https://github.com/yesint/molar_vis) is a
   wgpu/egui molecular viewer that builds for `wasm32` and has a job-channel API for
   hosts. Re-implementing spheres, cylinders, cartoons, surfaces and a ray tracer is not
   part of this project.

## Decisions

### 1. The viewer is embedded, not forked

`molar_vis_core` is an eframe application. We depend on it from git (the published 0.3.0
lacks the panel-visibility API an embedded page needs) and start it on the page's
animation-frame loop with `eframe::WebRunner`, exactly as upstream's own JS bindings do.

We wrap it in a host app (`crates/molplate_wasm`) rather than depending on
`molar_vis_js`:

* the JS crate is a `cdylib` with no library target, so it cannot be composed;
* we need our own `eframe::App` implementation to get pixels out (see 2);
* its API surface is far wider than this app needs, and every upstream method we do not
  call is a compatibility risk on every upgrade.

The page's own chrome is HTML/CSS; only the 3D view is inside the canvas. Upstream's
sidebar and toolbar are hidden at startup (`set_ui_visibility(false, false)`), because a
generator wants its own controls, not a molecule browser.

### 2. Image export is a screenshot of a resized surface

Upstream can render an image to a file, but on wasm that path is menu-driven, raster-only,
and hands the PNG to a browser download — the bytes are dropped. There is no offscreen
render API a host can call, because `App`'s renderer, camera and scene are private.

We therefore capture through egui: `ViewportCommand::Screenshot` is part of the public
egui API, the answer arrives as an input event, and our host wrapper reads it, encodes a
PNG, and returns the bytes to JavaScript. Resolution comes from growing the canvas before
the capture, not from an offscreen target.

Consequences, accepted for v1:

* exports are raster (SSAO and shadows work on WebGPU; the ray tracer does not), so
  nothing here produces soft shadows or global illumination;
* the largest useful export is bounded by the GPU surface limit, and very large canvases
  cost memory;
* the image is the viewport as drawn, which is what a figure needs anyway.

The alternative — vendoring and patching `molar_vis_core` to expose a real offscreen
render entry point — buys ray-traced exports at the cost of carrying a fork of a 50k-line
crate. The audit of upstream puts that patch at roughly 100–150 lines across three files;
if ray-traced figures become a requirement, that is the change to make, and it should be
offered upstream first.

### 3. Chemistry is "whatever PubChem has"

Structures come from PubChem's 3D records (`record_type=3d`, falling back to `2d` with a
visible warning). PubChem already ships conformers, so the browser never needs a force
field, an ETKDG embedding, or RDKit.

That leaves a real gap: a SMILES that PubChem does not know cannot be turned into 3D
coordinates in this build. Closing it needs a conformer generator compiled to wasm
(RDKit's own wasm build is the obvious candidate). The 2D skeletal depiction has the same
dependency and is therefore deferred as one piece of work rather than two.

### 4. Markup is generated in Rust, and tested there

The wikitext is the part of the product that is *specification*, not presentation: field
names, section order, escaping rules and hazard-statement syntax all have to match what
MediaWiki expects. It lives in `molplate_core` with unit tests, compiles natively, and is
reached from TypeScript through small JSON-in/JSON-out functions. The TypeScript side
never formats wikitext.

Two upstream behaviours are deliberately not copied, both because the output is worse:
a numeric zero is kept (`charge = 0` is information, not an empty value), and a
`LogP` parameter is emitted once rather than twice.

### 5. Two crates and a Vite frontend

* `molplate_core` — presets, image post-processing, wikitext. No browser, no GPU. This is
  where behaviour is tested.
* `molplate_wasm` — `wasm32` only. Boots the viewer, queues jobs, captures images,
  exports the JSON functions.
* `web/` — Vite + TypeScript. DOM, state, PubChem requests, download.

No framework: the page has one canvas, two dozen controls and some text output. React or
Svelte would add a build dependency and a render loop for no benefit at this size.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Viewer UI in Rust/egui, one wasm binary | Fastest first build, but the page would look like the viewer; HTML gives typography, layout and accessibility for free, and the app is mostly text-with-a-viewport |
| Depend on `molar_vis_js` | Cannot be composed (cdylib, no lib target) and cannot get pixels out |
| Fork/patch `molar_vis_core` for offscreen export | Carries a 50k-line fork for one function; revisit if ray tracing is required |
| Client-side conformer generation with RDKit-wasm in v1 | Adds a ~10 MB wasm payload and a whole chemistry API before the pipeline is proven end to end |
| A server that renders with PyMOL | Defeats the point: no install, no upload, no GPU dependency beyond the browser's |

## Consequences

* Upgrading `molar_vis` means re-checking three things: that `App::ui` still delegates
  cleanly, that the job channel still accepts our closures, and that the screenshot
  command still arrives as an `Event::Screenshot`.
* Users with WebGL2 only (no WebGPU) get a correct image without ambient occlusion,
  shadows or transparency.
* Any compound without a 3D PubChem record produces a flat figure with a warning until
  conformer generation lands.
