<div align="center">

# WikiMolGen 2

Molecule figures for Wikipedia, rendered in the browser.

[![Rust](https://img.shields.io/badge/Rust-wasm32-000000?logo=rust&logoColor=white)](crates/wikimolgen2_core)
[![TypeScript](https://img.shields.io/badge/TypeScript-Vite-3178c6?logo=typescript&logoColor=white)](web)
[![WebGPU](https://img.shields.io/badge/WebGPU-required-0e6d68)](docs/ADR-0002-renderer-patinae.md)
[![Licence](https://img.shields.io/badge/licence-PolyForm%20Noncommercial%201.0.0-555)](LICENSE)

</div>

![WikiMolGen 2 showing aspirin, the export toolbar and the Commons markup below](docs/screenshot.png)

Type a compound name, a PubChem CID or a SMILES, or a PDB ID. The structure comes straight from PubChem or RCSB and is drawn by [patinae](https://github.com/zmactep/pymol-rs) in WebAssembly, or by RDKit as a skeletal SVG. The page also writes the `{{Infobox drug}}`, `{{Chembox}}` and Wikimedia Commons markup around the figure.

It is a static site: no server, no upload, no install.

## What it does

| Area | What it gives you |
| --- | --- |
| Lookup | 58 compounds and 13 proteins answer from the built-in catalogue. Live PubChem autocomplete and RCSB full-text search cover the rest. A CID, a SMILES or a PDB ID still works |
| 3D | Ball-and-stick, space filling, licorice, stick and protein cartoons, with seven element palettes and a colour mode for element, chain, residue, rainbow, secondary structure, B-factor or one ink |
| 2D | RDKit's MinimalLib draws the skeletal SVG with stereo and no background. Monochrome, bond width and label size apply to the drawing; a Rust V2000 parser is the fallback |
| Looks | Publication, Flat, Dark, Space filling, Licorice and Stick for small molecules, plus Rainbow, Trans, secondary-structure and chain cartoon looks for proteins |
| Appearance | Stick and sphere size, valence, light, transparency, depth cue, ambient occlusion, soft shadows, outline, smooth edges and projection. A two-step reset at the end restores the current look's slider values; the colour scheme stays |
| Presets | The original Wikipedia render settings, saved and renamed presets, orientation presets (wiki, front, side, top, custom) and the seven colour schemes |
| Theme | System plus six fixed palettes: Light, Paper, Contrast, Dark, Slate and Midnight. A custom theme starts from five colours, derives the rest with contrast floors, and is saved by name. Themes can be duplicated, shared as a link or a JSON file, and open tabs stay in step. The choice applies before the first paint |
| Export | PNG from 400 to 8192 px wide, 2x to 6x supersampling, 4 to 9 percent margin, optional labels and scale bar, transparent by default, or one ZIP for a batch. A batch can be cancelled between rows, a failed row can be retried on its own, and the run reports its progress |
| Markup | `{{Infobox drug}}`, `{{Chembox}}` and the Commons upload text, with metadata from Wikidata, Wikipedia and openFDA. The file name above the panel is editable: a typed name renames the download, the infoboxes and the upload link, and Reset brings the generated one back |
| Links | A lookup writes `?q=` to the address, and a `?theme=` link carries a theme. The theme and the open sections survive a reload |
| Offline | A service worker caches the shell, the app bundle and the 3D viewer after the first visit. A manifest names the site and sets its theme colour; the 2D engine is cached on first use |

## See it

| | |
| --- | --- |
| ![The stacked output panel](docs/output-panel.png) | ![The colour panel](docs/colour-panel.png) |
| The markup panel, each box with its own copy action | Colour by element, with per-element overrides |
| ![The appearance panel](docs/appearance-panel.png) | ![The stage in full screen](docs/fullscreen.png) |
| The shape, light and surface controls | Full screen gives the figure the whole display |
| ![The theme picker](docs/theme-picker.png) | ![The custom theme editor](docs/theme-editor.png) |
| Six fixed palettes, saved custom themes and the sharing tools | A custom theme previews live while its five colours are edited |

An exported figure, cropped and padded by the app itself:

![Exported ball-and-stick figure of aspirin](docs/example-ball-and-stick.png)

## Build

Requirements: a Rust toolchain with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` matching the version in `Cargo.lock`, and Node 20 or newer.

```powershell
cargo build --target wasm32-unknown-unknown --release -p wikimolgen2_wasm
wasm-bindgen --target web --out-dir web/pkg `
  target/wasm32-unknown-unknown/release/wikimolgen2_wasm.wasm

cd web
npm install
npm run dev
```

The tests that need no browser:

```powershell
cargo test -p wikimolgen2_core
cd web
npm test
```

CI runs the Rust tests, the unit tests, builds the wasm bundle and runs the Vite build on every push and pull request: [.github/workflows/ci.yml](.github/workflows/ci.yml). A push to `patinae-rewrite` also deploys the site to GitHub Pages at <https://wolren.github.io/WikiMolGen2/>.

The browser check serves `web/dist`, drives the page's own controls, asserts the markup and exports a PNG:

```powershell
node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu hardware
node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu hardware --smoke true
```

The smoke run skips the export, full screen, batch and deep-link checks. It is the fast
loop while a page change is in progress.

## How it works

```mermaid
graph LR
  A[Name, CID, SMILES or PDB ID] --> B[PubChem and RCSB]
  B --> C[Rust core: markup, figure, presets]
  B --> D[patinae WebGPU or RDKit]
  C --> E[Infobox, Chembox, Commons]
  D --> F[PNG or SVG]
```

* `crates/wikimolgen2_core` holds the chemistry, the figure composition, the presets, the element palettes and the wikitext generators. It runs without a browser, so it is unit tested natively.
* `crates/wikimolgen2_wasm` is the part that runs in the page: SVG, figure composition and markup. It does not render.
* `web/src/` is Vite and TypeScript: lookup, metadata, controls, downloads and the adapter that drives the renderer.
* `web/public/vendor/` holds the renderer and the 2D engine, with provenance notes beside both builds.
* `web/public/sw.js` keeps the shell, the app bundle and the 3D viewer for repeat and offline visits. The Vite build writes the hashed precache list.

The renderer choice and its cost, including the missing WebGL2 fallback, are in [docs/ADR-0002-renderer-patinae.md](docs/ADR-0002-renderer-patinae.md). The theme token model is in [docs/ADR-0003-theme-tokens.md](docs/ADR-0003-theme-tokens.md), the offline shell in [docs/ADR-0004-offline-shell.md](docs/ADR-0004-offline-shell.md). The earlier design is in [docs/ADR-0001-architecture.md](docs/ADR-0001-architecture.md), and the scope is in [docs/SPEC.md](docs/SPEC.md).

## Limits

* Rendering needs WebGPU. There is no WebGL2 fallback. Chrome 113+, Edge 113+ and Safari 26 on a supported GPU work; other browsers get an explanation and the markup half still works.
* The RDKit module is 7.39 MB and loads on the first 2D view. The Rust fallback reads V2000 only.
* Ray tracing and MSAA are not in the live view. FXAA and a 2x supersampled canvas are the substitutes.
* The renderer exports one view at a time. A figure that needs an edge above 8192 px needs tiling, which the renderer does not expose.
* The live surface is opaque, so a live background gradient and true alpha are export-only or unavailable.
* DailyMed sends no CORS header. openFDA serves the same labels.
* A SMILES that PubChem does not know needs a conformer generator, which the app does not have.
* The offline shell covers the app. PubChem, RCSB and the metadata services still need a connection.

## Licence

The source code is under the [PolyForm Noncommercial License 1.0.0](LICENSE), the same licence as the original [WikiMolGen](https://github.com/Wolren/WikiMolGen).

That licence covers the software only. Figures, SVGs and wikitext you generate are yours to licence as you see fit. The Commons template defaults to CC BY-SA 4.0 for a 3D figure and PD-chem for a 2D drawing.

The renderer, patinae, is BSD-3-Clause, Copyright (c) 2026, Pavel Yakovlev. RDKit is BSD-3-Clause, Copyright (c) 2006-2015, Rational Discovery LLC, Greg Landrum, and Julie Penzotti and others. The full texts are in [LICENSES](LICENSES/README.md) and beside each vendored build.
