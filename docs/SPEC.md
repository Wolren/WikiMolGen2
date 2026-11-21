# molplate, scope and contracts

What the app does, what it deliberately does not do yet, and the contracts between its
parts. Architecture rationale lives in [ADR-0001](ADR-0001-architecture.md), and the
renderer swap is in [ADR-0002](ADR-0002-renderer-patinae.md). The upgrade that added most
of this surface is recorded in [UPGRADE-REPORT.md](UPGRADE-REPORT.md).

## Product

A static web app that turns a compound or a PDB entry into a figure and the text that
frames it:

```
name / CID / SMILES ──► PubChem ──► 3D SDF ──► patinae ──► PNG
        │                  └─────► 2D SDF ──► Rust depict ──► SVG
        │                  └─────► Wikidata, Wikipedia, openFDA ──► metadata
        │                                                              │
        └─────────────────────────────────────────────────────► wikitext
4-character PDB ID ──► RCSB ──► patinae cartoon ──► PNG
```

Everything runs in the browser. Structures are fetched directly from PubChem and RCSB,
which allow cross-origin requests; nothing is uploaded anywhere.

## In v1

| Capability | Detail |
| --- | --- |
| Lookup by name, CID or SMILES | Name and CID resolve directly; a SMILES is resolved through PubChem's structure search, so only compounds PubChem knows work |
| Protein lookup | A four-character PDB ID (for example `1CRN`) or a `pdb:` prefix fetches the entry from RCSB and draws a cartoon |
| 3D structure | PubChem's 3D record; a compound without one falls back to its 2D record and says so |
| 2D depiction | Rust parses the V2000 table, hides hydrogens and writes a skeletal SVG with element colours; no chemistry toolkit in the bundle |
| Styles | Publication, Flat and Dark finishes of ball-and-stick; space filling, licorice and stick; protein cartoons by secondary structure or chain |
| Appearance | Background, stick and sphere size, transparency, ambient and direct light, specular, ambient occlusion, outline, depth cue, per-element colour overrides |
| Navigation | Viewer's own mouse controls, zoom buttons, re-frame, and keyboard shortcuts |
| Export | PNG at exactly 1200, 1600 or 2000 px wide; a 4 to 9 percent margin; 2x supersampling; optional atom labels, scale bar, transparent background and export gradient |
| Metadata | PubChem properties, Wikidata identifiers and ATC codes, Wikipedia clinical fields, and an openFDA drug label |
| `{{Infobox drug}}` | Field names, section order and escaping as the template expects, including ATC, routes and legal status |
| `{{Chembox}}` | Nested sections: identifiers, properties, pharmacology, hazards |
| Commons | File name, `{{Information}}` plus licence block, pre-filled upload URL; the licence follows the structure kind |
| Keyboard | `Ctrl+Enter` load, `2`/`3` view, `E` export, `F` frame, `+`/`-` zoom, `/` focus, `?` help |
| Graphics | WebGPU only. There is no WebGL2 fallback, so a browser without an adapter gets an explanation instead of a lesser image |

## Not in v1

| Missing | Why | What it needs |
| --- | --- | --- |
| V3000 mol blocks in 2D | The depiction reads the V2000 table | A V3000 parser, or a toolkit |
| Conformer generation for unknown SMILES | PubChem resolves SMILES, so an unknown string never reaches the renderer | RDKit-wasm embedding and MMFF, or a server |
| Ray-traced export | patinae's ray tracer is a native cdylib plugin and is not in the wasm build | A wasm ray tracer, or a server-side render |
| MSAA in the live view | patinae has no MSAA; FXAA and a 2x supersampled canvas are the substitutes | A renderer change, not an app change |
| Live background gradient | The canvas surface is opaque, so a CSS gradient cannot show through | Renderer support for a gradient clear, or an accept of the export-only option |
| Direct DailyMed reads | The DailyMed service sends no CORS header, so the browser cannot read it | A proxy, or an upstream CORS header; openFDA serves the same SPL labels today |
| Protein 2D or sequence view | A cartoon is the useful figure for an article | A sequence panel and a depiction path |
| Element labels in 3D by symbol | The renderer's label expression has no element field; atom names are the substitute | A renderer label expression, or browser-side projection |

## Contracts

### `Compound` (TypeScript → Rust)

`web/src/pubchem.ts` produces it, `molplate_core::wikitext::Compound` consumes it. All
fields are optional; missing fields are omitted from the markup rather than rendered empty.
Field names are `snake_case` on both sides because serde maps them directly. Metadata from
Wikidata, Wikipedia and openFDA is merged after the figure renders, and PubChem wins where
both sources know a field.

### `Look` (Rust → TypeScript)

`looksJson()` and `proteinLooksJson()` return the preset lists; the page renders them and
hands a chosen preset to `Renderer.applyLook(look)` unchanged. The object is
`molplate_core::style::Look`, the same type in both directions, so a renamed field breaks
one test rather than two implementations. `Look.appearance` carries the light, finish,
background and element overrides. The adapter, not the core, knows how a style becomes
renderer commands.

### Figure spec (TypeScript → Rust)

`composeFigure(png, spec_json)` reads `molplate_core::figure::FigureSpec`:

```json
{
  "width": 1600,
  "margin": 0.06,
  "background": [255, 255, 255, 255],
  "gradient": null,
  "scale_bar": { "angstrom_per_pixel": 0.0039 }
}
```

The output width is exact. The content is scaled to `width - 2 * margin_px`, so the
horizontal margin is exact and no atom leaves the canvas. The scale bar is drawn in the
bottom margin from the Å per pixel that the camera reports through `get_view`.

### Depiction (Rust → SVG)

`depictSvg(sdf, width, margin, labels, monochrome, name)` parses a V2000 mol block and
returns a complete SVG document. Hydrogens are implicit. Heteroatoms are always labelled;
`labels` adds the carbons.

## Repository map

```
crates/molplate_core/   depiction, presets, figure composition, image ops, wikitext
crates/molplate_wasm/   SVG, figure and JSON exports  (no renderer)
web/src/main.ts         page controller: lookup, modes, markup
web/src/context.ts      shared state, DOM handles, status helpers
web/src/appearance.ts   the appearance panel
web/src/figure.ts       export: PNG composition and SVG download
web/src/keyboard.ts     shortcuts
web/src/depiction.ts    inline SVG
web/src/pubchem.ts      PubChem lookups and the compound type
web/src/sources.ts      Wikidata, Wikipedia, DailyMed / openFDA
web/src/protein.ts      RCSB PDB
web/src/renderer.ts     the only file that knows patinae's API
web/public/vendor/      the vendored patinae build (see its PROVENANCE.md)
web/pkg/                generated wasm + JS bindings (git-ignored)
docs/                   this file, the ADRs and the upgrade report
scripts/dev-env.ps1     toolchain paths for this workstation
```

## Acceptance

* `cargo test -p molplate_core` passes natively (37 tests at the time of writing).
* `cargo build --target wasm32-unknown-unknown -p molplate_wasm` produces the module.
* The page loads, accepts `aspirin`, shows a molecule, and every tab produces markup that
  parses as balanced templates.
* Export at 1600 px writes a 1600 px wide PNG with 6 percent margins and no clipped atoms.
* A 1CRN lookup draws a cartoon coloured by secondary structure in under three seconds.
* The same compound loaded by name, CID and SMILES exports byte-identical images.
* A browser without WebGPU explains itself, disables export, and still generates markup.

`node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu hardware` checks
the browser-facing parts. The `--gpu hardware` flag matters: SwiftShader's flags remove the
adapter this renderer needs, so a software run would report a failure that is about the
flags rather than the app.
