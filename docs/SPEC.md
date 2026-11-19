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
| Styles | Ball and stick, space filling, licorice, stick |
| Appearance | Element-colour presets (Default/VMD/PyMOL/Discovery Studio/MOE/Mol\*), solid background, perspective or orthographic camera |
| Navigation | Viewer's own mouse controls (drag to rotate, wheel to zoom) inside the canvas |
| Graphics | WebGPU when available, WebGL2 otherwise; the live backend is shown in the header and the limits of the fallback are stated |
| Export | PNG at a chosen width (1000–3200 px), captured from a resized canvas, cropped to the molecule and padded with an even margin |
| `{{Infobox drug}}` | Field names, section order and escaping as the template expects |
| `{{Chembox}}` | Nested sections: identifiers, properties, pharmacology, hazards |
| Commons | File name, `{{Information}}` + licence block, pre-filled upload URL |
| Copy | The whole current tab to the clipboard |

## Not in v1

| Missing | Why | What it needs |
| --- | --- | --- |
| 2D skeletal depiction (SVG) | No pure-Rust depiction engine; RDKit-wasm is the candidate | A `wasm` chemistry dependency and its own styling layer |
| Conformer generation for unknown SMILES | Same | RDKit-wasm embedding + MMFF, or a server |
| Ray-traced export | Upstream's offscreen path is not reachable from a host, and it needs WebGPU compute | A small upstream patch (`App` export entry point) or a fork |
| Shadows and ambient occlusion on WebGL2 | The device has no compute | WebGPU, which the page asks for first |
| Proteins (PDB cartoons) | Viewer supports cartoons; the app's lookup and markup do not | PDB fetch + protein-specific presets and boxes |
| Physicochemical/experimental data beyond PubChem properties | Wikidata, PUG-View, DailyMed all need CORS-checked endpoints | Extra fetch + merge layer |
| Transparent background | The canvas has no alpha | Renderer support |

## Contracts

### `Compound` (TypeScript → Rust)

`web/src/pubchem.ts` produces it, `molplate_core::wikitext::Compound` consumes it. All
fields optional; missing fields are omitted from the markup rather than rendered empty.
Field names are `snake_case` on both sides because serde maps them directly.

### `Look` (Rust → TypeScript → Rust)

`looksJson()` returns the preset list; the page renders it and sends a chosen preset back
to `applyLook(json)` unchanged. The JSON is `molplate_core::style::Look` — the same type
in both directions, so a renamed field breaks one test rather than two implementations.

### Export

`requestCapture(settleFrames)` → the host sends egui's screenshot command after
`settleFrames` of repaints and encodes the reply as PNG → `takeCapture()` returns the
bytes (or `undefined` while pending) → `captureStatus()` reports
`idle | pending | ready | failed: …`.

## Repository map

```
crates/molplate_core/   presets, image post-processing, wikitext  (native-tested)
crates/molplate_wasm/   viewer host, job queue, PNG capture, JSON exports
web/                    Vite + TypeScript page
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

`node scripts/verify.mjs --dir web/dist` checks all of that in a real browser. It runs on
the WebGL2 fallback on this workstation: its GPU (GeForce GTX 650) exposes no WebGPU
adapter to Chrome, so the WebGPU path is implemented and reported but not yet exercised
here.
