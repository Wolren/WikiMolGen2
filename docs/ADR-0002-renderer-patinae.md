# ADR 0002 — Replace molar_vis with patinae as the 3D renderer

Status: accepted (2026-11-19)
Supersedes: [ADR 0001](ADR-0001-architecture.md)

## Context

ADR 0001 embedded `molar_vis` (eframe/egui, wgpu 29) and got pixels out by resizing the
canvas and asking egui for a screenshot of the surface, then trimming the viewer's grey
frame and padding a margin. That worked, but it carried the whole egui stack into the
browser and the export path was a handshake with the UI thread.

`patinae` (formerly PyMOL-RS) is a WebGPU renderer with its own `web/` crate: canvas,
own animation-frame loop, no winit or egui, a typed TypeScript facade and
`exportPng({width, height, transparent})` that renders offscreen. It is smaller, exports
without a screenshot, and supports transparency.

It is also **WebGPU-only** — `instance_descriptor.backends = wgpu::Backends::BROWSER_WEBGPU`,
with no WebGL2 path anywhere in its web host. `molar_vis` had a WebGL2 fallback.

## Decision

Move to patinae, and accept losing the WebGL2 fallback.

The trade was decided on the exported figure, not on feature lists. On the aspirin case,
measured at a 1600 px request:

| | molar_vis (before) | patinae (after) |
| --- | --- | --- |
| figure | 1774×1548, content 89.3% of width, 5.4–6.1% margin | 1432×1244, content 89.2%, 5.4–6.2% margin |
| outermost atoms | **clipped flat** — a 108 px straight ink run at both crop edges | complete — longest run at the content edge is 19 px, i.e. a sphere's tangent |
| bundle (raw / gzip) | 17.78 MB / 5.47 MB | 4.96 MB / ~1.5 MB |
| transparent export | not reachable (opaque surface) | RGBA, corner alpha 0, compositing over white is pixel-identical to the opaque render |
| export at 1600 px | resize + 3 settle frames + screenshot poll (8 s ceiling) | 97–124 ms, offscreen |

The framing defect was the deciding factor on quality: the old path cropped to content
that the viewport had already cut, so the tight margin came at the cost of two severed
atoms. patinae leaves the scene intact and the same crop produces the same composition
without the clipping.

## Consequences

* **Support matrix narrows to WebGPU.** Browsers without an adapter cannot see a molecule.
  The page detects this before importing the viewer, says so in the stage overlay, disables
  export, and keeps the markup half working — that last part was previously promised by
  the error text but not true, because the lookup returned early with no renderer.
* **The renderer is vendored, not a dependency.** patinae's `web/` is its own cargo
  workspace with internal path dependencies, so cargo cannot resolve it as a git
  dependency, and path-depending on a checkout outside the repo is not reproducible. The
  built ES module and wasm live in `web/public/vendor/patinae` with
  [PROVENANCE.md](../web/public/vendor/patinae/PROVENANCE.md). Upgrading means re-running
  that build.
* **`molplate_wasm` no longer renders.** It is now ~500 KB of wasm (was 17.6 MB) doing the
  figure crop and the markup. The renderer is reached only through `web/src/renderer.ts`.
* **Two UI capabilities are lost.** The element-colour preset list (Default/VMD/PyMOL/…)
  has no patinae equivalent and the control was removed. `Licorice` is approximated by
  thick sticks, because patinae has no licorice representation.
* **Styling is command strings.** patinae's JS facade is typed for data and export calls,
  but styling goes through PyMOL-style commands (`show spheres`, `set stick_radius, 0.16`).
  The mapping from a `Look` to those commands lives in the adapter and is the main place a
  future upgrade will need attention.
* **Wheel zoom is ours.** patinae maps a released wheel to clipping-plane changes
  (`CameraDelta::SlabScale`) and only zooms while a button is held, so a plain wheel did
  nothing visible. The page takes the released-wheel case in the capture phase and drives
  `zoom all, buffer=<Å>` itself, and exposes +/− buttons; the wheel-while-dragging case is
  still the renderer's. Zoom is therefore expressed in Ångström of framing buffer, not as a
  camera handle — its range is clamped so a user cannot silently clip atoms.
* **Antialiasing is ours.** The web build antialiases with FXAA only: every pipeline is
  `sample_count: 1`, `antialias` merely gates FXAA on or off (2 and 4 render identically),
  `antialias_shader` is declared but not registered, and `offscreen_rendering_multiplier` is
  declared and unused. Measured on aspirin, a silhouette had a 0.26 px edge ramp. Exports are
  therefore rendered at 2× and scaled down in Rust (`image_ops::resize`, premultiplied so
  transparent edges do not darken), which triples the ramp to about 1 px; 3× adds nothing.
  The live view has no such pass and stays FXAA-soft at its own resolution.
* Ray tracing is not available: patinae's ray tracer is a native cdylib plugin and is not
  in the wasm build.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Stay on molar_vis | Its figures clip the outermost atoms, its bundle is 3.5× larger, and its export is a screenshot handshake |
| Add a WebGL2 fallback to patinae first | Upstream does not have one; writing it is not a port, it is a second renderer |
| Depend on patinae as a git dependency | Its web crate is a separate workspace with path dependencies; cargo cannot resolve the package from the repository root |
| Fork patinae's `web/` into this repo | ~200k lines of upstream code to maintain for one integration |
