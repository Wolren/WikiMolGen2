# molplate — scope and contracts

What the app does, what it deliberately does not do yet, and the contracts between its
parts. Architecture rationale lives in [ADR-0001](ADR-0001-architecture.md).

## Product

A static web app that turns a compound into a figure and the text that frames it:

```
identifier ──► PubChem ──► structure (SDF) ──► renderer (wasm) ──► canvas ──► PNG
     │                          │
     └──────────────► properties ┘──────────────────────► wikitext (Rust)
```

Everything runs in the browser. Structures are fetched directly from PubChem, which
allows cross-origin requests; nothing is uploaded anywhere.

## In v1

| Capability | Detail |
| --- | --- |
| Lookup by name, CID or SMILES | Name and CID resolve directly; a SMILES is resolved through PubChem's structure search, so only compounds PubChem knows work |
| 3D structure | PubChem's 3D record; a compound without one falls back to its 2D record and says so |
| Styles | Ball and stick, space filling, licorice, stick — composed from patinae's sticks/spheres/lines, since it has no compound `ballstick` or `licorice` representation |
| Appearance | Solid background, perspective or orthographic camera. Element colours are the renderer's palette; the per-preset palettes the previous renderer exposed are gone |
| Navigation | Viewer's own mouse controls (drag to rotate, middle/right drag to pan, wheel to zoom) inside the canvas |
| Graphics | WebGPU only. There is no WebGL2 fallback, so a browser without an adapter gets an explanation instead of a lesser image |
| Export | PNG at a chosen width (1000–3200 px), rendered offscreen at 2× that size, scaled down to smooth silhouettes, cropped to the molecule and padded with an even margin; optional transparent background |
| `{{Infobox drug}}` | Field names, section order and escaping as the template expects |
| `{{Chembox}}` | Nested sections: identifiers, properties, pharmacology, hazards |
| Commons | File name, `{{Information}}` + licence block, pre-filled upload URL |
| Copy | The whole current tab to the clipboard |

## Not in v1

| Missing | Why | What it needs |
| --- | --- | --- |
| 2D skeletal depiction (SVG) | No pure-Rust depiction engine; RDKit-wasm is the candidate | A `wasm` chemistry dependency and its own styling layer |
| Conformer generation for unknown SMILES | Same | RDKit-wasm embedding + MMFF, or a server |
| Ray-traced export | patinae's ray tracer is a native cdylib plugin and is not in the wasm build | A wasm ray tracer, or a server-side render |
| Shadows and ambient occlusion | Available in patinae, not wired up: they cost frames and the capture path does not need them yet | Turning on `set_shadows` / `set_ambient_occlusion_mode` and re-checking export timing |
| Proteins (PDB cartoons) | Viewer supports cartoons; the app's lookup and markup do not | PDB fetch + protein-specific presets and boxes |
| Physicochemical/experimental data beyond PubChem properties | Wikidata, PUG-View, DailyMed all need CORS-checked endpoints | Extra fetch + merge layer |

## Contracts

### `Compound` (TypeScript → Rust)

`web/src/pubchem.ts` produces it, `molplate_core::wikitext::Compound` consumes it. All
fields optional; missing fields are omitted from the markup rather than rendered empty.
Field names are `snake_case` on both sides because serde maps them directly.

### `Look` (Rust → TypeScript)

`looksJson()` returns the preset list; the page renders it and hands a chosen preset to
`Renderer.applyLook(look)` unchanged. The object is `molplate_core::style::Look` — the same
type in both directions, so a renamed field breaks one test rather than two
implementations. The adapter, not the core, knows how a style becomes renderer commands.

### Export

`Renderer.exportPng({width, height, transparent})` renders offscreen at that size and
returns a `Blob` → `frameFigure(png, margin, r, g, b, a)` in Rust crops it to the molecule
and pads an even margin → the page downloads the result. The crop is what makes a viewport
render into a figure, so an export never depends on the browser window's size.

## Repository map

```
crates/molplate_core/   presets, image post-processing, wikitext  (native-tested)
crates/molplate_wasm/   figure cropping + JSON exports  (no renderer)
web/                    Vite + TypeScript page
web/src/renderer.ts     the only file that knows patinae's API
web/public/vendor/      the vendored patinae build (see its PROVENANCE.md)
web/pkg/                generated wasm + JS bindings (git-ignored)
docs/                   this file and the ADRs
scripts/dev-env.ps1     toolchain paths for this workstation
```

## Acceptance

* `cargo test -p molplate_core` passes natively.
* `cargo build --target wasm32-unknown-unknown -p molplate_wasm` produces the module.
* The page loads, accepts `aspirin`, shows a molecule, and every tab produces markup that
  parses as balanced templates.
* Export writes a PNG whose border is clean white and whose content is the molecule.
* A browser without WebGPU explains itself, disables export, and still generates markup.

`node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu hardware` checks
the browser-facing parts. The `--gpu hardware` flag matters: SwiftShader's flags remove the
adapter this renderer needs, so a software run would report a failure that is about the
flags rather than the app.
