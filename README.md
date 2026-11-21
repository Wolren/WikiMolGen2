# molplate

Molecule figures for Wikipedia, rendered in the browser.

Load a compound by name, PubChem CID or SMILES, or a protein by PDB ID. The structure is
fetched straight from PubChem or RCSB, drawn with [patinae](https://github.com/zmactep/pymol-rs)
in WebAssembly or as a 2D skeletal SVG, and handed back together with the `{{Infobox drug}}`,
`{{Chembox}}` and Wikimedia Commons markup that goes around it.

It is a static site: no server, no upload, no install.

What it offers:

* **2D and 3D.** RDKit's MinimalLib draws the skeletal SVG, with element colours and
  stereo. Ball-and-stick, space-filling, licorice, stick and protein cartoons cover 3D.
* **Named looks and controls.** Publication, Flat and Dark finishes, plus light, outline,
  ambient occlusion, depth cue, transparency and per-element colour overrides.
* **Figures, not screenshots.** PNG at exactly 1200, 1600 or 2000 px wide, with a 4 to 9
  percent margin, optional atom labels, a scale bar, transparency and a gradient.
* **Metadata beside PubChem.** Wikidata identifiers and ATC codes, Wikipedia clinical
  fields, and an openFDA drug label.

The 2D engine is RDKit.js, 7.39 MB, loaded only when the 2D view first opens. Until then
the page stays at about 624 KB of wasm. A Rust V2000 parser is the fallback if the RDKit
module cannot load.

![molplate rendering aspirin, with the Commons markup beside it](docs/screenshot.png)

An exported figure, aspirin, ball and stick, cropped and padded by the app itself:

![Exported ball-and-stick figure of aspirin](docs/example-ball-and-stick.png)

Rendering needs WebGPU. There is no WebGL2 fallback: the renderer is WebGPU-only, and the
page says so plainly instead of drawing something lesser. Chrome 113+, Edge 113+ and
Safari 26 on a supported GPU work; anything else gets an explanation, and the markup half
of the app keeps working.

## Build

Requirements: a Rust toolchain with the `wasm32-unknown-unknown` target,
`wasm-bindgen-cli` matching the version `Cargo.lock` pins, and Node 20+.

```powershell
# 1. The Rust half: figure post-processing and markup (release build)
cargo build --target wasm32-unknown-unknown --release -p molplate_wasm
wasm-bindgen --target web --out-dir web/pkg `
  target/wasm32-unknown-unknown/release/molplate_wasm.wasm

# 2. The page
cd web
npm install
npm run dev
```

On this workstation the toolchain lives outside the user profile; source
`scripts/dev-env.ps1` first and the commands above work unchanged.

Tests for everything that can be tested without a browser:

```powershell
cargo test -p molplate_core
```

End-to-end check in a real browser: it serves `web/dist`, loads a compound through the
page's own controls, asserts the markup and exports a PNG, then writes a screenshot.

```powershell
node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu hardware
```

## How it is put together

* `crates/molplate_core`, the 2D depiction, the figure composition, presets and the
  wikitext generators. No browser, no GPU, so it is unit-tested natively.
* `crates/molplate_wasm`, the Rust that has to run in the browser: writes the SVG,
  composes a rendered PNG into a figure, and generates the markup. It does not render.
* `web/src/`, Vite + TypeScript: lookups, metadata, controls, downloads, and the adapter
  that drives the renderer (`renderer.ts`).
* `web/public/vendor/`, the renderer (patinae) and the 2D engine (RDKit). Both are
  vendored builds with provenance notes beside them.

The renderer is patinae (formerly PyMOL-RS), not `molar_vis`. Why it was swapped, what the
swap cost, and what it gives up, notably a WebGL2 fallback, are in
[docs/ADR-0002-renderer-patinae.md](docs/ADR-0002-renderer-patinae.md); the earlier design
and its reasoning are kept in
[docs/ADR-0001-architecture.md](docs/ADR-0001-architecture.md), and what is in and out of
the current scope is in [docs/SPEC.md](docs/SPEC.md).

## Status

The 2D and 3D paths work end to end: look a compound up, pick a look, export a figure,
and paste the markup. A protein cartoon works from a PDB ID, and the metadata from
Wikidata, Wikipedia and openFDA fills the summary and the infobox fields.

Known gaps are listed in [docs/SPEC.md](docs/SPEC.md): conformer generation for a SMILES
that PubChem does not know, ray tracing, MSAA in the live view, a live background
gradient, and a direct DailyMed read (openFDA serves the same labels). The Rust 2D
fallback reads V2000 only; the RDKit path also reads V3000.

WebGPU is required for 3D and the path is exercised: `scripts/verify.mjs --gpu hardware`
reports the live backend, loads aspirin and exports a figure on real hardware. The 2D SVG
and the markup still work when the 3D viewer cannot start.

## Licence

MIT OR Apache-2.0. The renderer (patinae) is BSD-3-Clause; its build is vendored
unmodified under `web/public/vendor/patinae` with the licence beside it.
