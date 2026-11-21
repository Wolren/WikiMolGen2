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
        │                  └─────► 2D SDF ──► RDKit MinimalLib ──► SVG
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
| 2D depiction | RDKit's MinimalLib draws the skeletal SVG with canonical layout, stereo and element colours. The SVG has no background. The 7.39 MB module loads on first 2D use. A Rust V2000 parser is the fallback |
| Styles | Publication, Flat and Dark finishes of ball-and-stick; space filling, licorice and stick; protein cartoons by secondary structure or chain. The finishes start from the WikiMolGen preset: CPK spheres, grey sticks, a white page |
| Colour | Colour by element, chain, residue type, residue number, secondary structure, B-factor or a single ink. Seven element palettes: CPK (default), Jmol, RasMol, ChemDraw, VMD, print inks and dark figure. Sticks follow the atoms or take one flat ink. A cartoon takes three secondary-structure inks. Per-element overrides sit on top of the palette |
| Appearance | Stick and sphere size, transparency, ambient, direct, reflect, specular and shininess, ambient occlusion and strength, soft shadows, outline and width, depth cue and fog. Background and gradient are export settings |
| Navigation | Viewer's own mouse controls, zoom buttons, re-frame, and keyboard shortcuts |
| Export | PNG at any width from 400 to 4096 px; a 4 to 9 percent margin; 3x supersampling by default, 2x and 4x selectable; optional atom labels and scale bar; transparent by default, with an optional background and export gradient |
| Metadata | PubChem properties, Wikidata identifiers and ATC codes, Wikipedia clinical fields, and an openFDA drug label |
| `{{Infobox drug}}` | Field names, section order and escaping as the template expects, including ATC, routes and legal status |
| `{{Chembox}}` | Nested sections: identifiers, properties, pharmacology, hazards |
| Commons | File name, `{{Information}}` plus licence block, pre-filled upload URL; the licence follows the structure kind |
| Keyboard | `Ctrl+Enter` load, `2`/`3` view, `E` export, `F` frame, `+`/`-` zoom, `/` focus, `?` help |
| Theme | Light, Paper and Dark, plus System. The choice persists and applies before the first paint. The stage follows the theme tint |
| Graphics | WebGPU only. There is no WebGL2 fallback, so a browser without an adapter gets an explanation instead of a lesser image |

## Not in v1

| Missing | Why | What it needs |
| --- | --- | --- |
| V3000 mol blocks in the Rust fallback | The RDKit path reads V3000; the fallback parser reads V2000 | A V3000 parser in Rust, or removal of the fallback |
| Conformer generation for unknown SMILES | PubChem resolves SMILES, so an unknown string never reaches the renderer | RDKit-wasm embedding and MMFF, or a server |
| Ray-traced export | patinae's ray tracer is a native cdylib plugin and is not in the wasm build | A wasm ray tracer, or a server-side render |
| MSAA in the live view | patinae has no MSAA; FXAA and a 2x supersampled canvas are the substitutes | A renderer change, not an app change |
| Live background gradient | The canvas surface is opaque, so a CSS gradient cannot show through | Renderer support for a gradient clear, or an accept of the export-only option |
| True alpha in the live view | The patinae surface is opaque. The stage paints the theme tint instead | Renderer support for an alpha surface, or an accept of the tint |
| Export edges above 8192 px | The 4x 2000 px export (8000x10884) did not complete; the 3x export (6000x8163) did. The GPU reports 16384 | A tiled export, or a patinae change |
| Supersampling above 4x | The quality select stops at 4x; the 8192 edge cap limits it further at large widths | A tiled export, or a lower-level renderer option |
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
background and the colour inks. The adapter, not the core, knows how a style becomes
renderer commands.

The page copies a preset before the panel edits it (`cloneLook`). Editing the preset
object itself would write every slider back into the preset list, so choosing a look twice
would never reset.

### `Appearance` colour fields (Rust → TypeScript)

| Field | Meaning |
| --- | --- |
| `scheme` | Element palette id from `colorSchemesJson()`, e.g. `"cpk"` |
| `stick_color` | Flat stick ink, `null` for sticks that follow the atoms |
| `solid_color` | Ink for the `uniform` colour mode |
| `helix_color`, `sheet_color`, `loop_color` | Cartoon inks for the `sec_struct` colour mode |
| `element_colors` | Per-element overrides, applied on top of the scheme |

`ColorMode` is `element`, `chain`, `residue`, `index`, `sec_struct`, `b_factor` or
`uniform`. All but `uniform` are patinae colour schemes under another name; `uniform`
paints one ink and is the black-and-white figure.

### Element palettes (Rust → TypeScript)

`colorSchemesJson()` returns the picker entries: `id`, `label`, `description` and the stick
ink the scheme expects. `schemeColor(scheme, symbol)` returns one element's `#rrggbb`.

The tables live in `crates/molplate_core/src/palette.rs`: the CPK table (120 rows, 118
elements plus the D and T aliases) plus the handful of overrides that define each viewer's
palette. CPK is the default, so a molplate figure matches a WikiMolGen render.

The page resolves the palette for the elements the structure has and sends the result as
`element_colors`, which keeps the command count to the molecule rather than the periodic
table. A user override wins over the scheme; a non-element colour mode sends no element
inks at all, because the mode command has already painted the atoms.

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

The app passes `[0, 0, 0, 0]` by default, so the PNG margin is transparent. The background
or gradient applies when Transparent is off.

The page renders at 2x, 3x or 4x the output width, then composes at the exact width. A
large width lowers the factor so no render edge exceeds 8192 px, the export limit on this
build.

The output width is exact. The content is scaled to `width - 2 * margin_px`, so the
horizontal margin is exact and no atom leaves the canvas. The scale bar is drawn in the
bottom margin from the Å per pixel that the camera reports through `get_view`.

### Depiction (RDKit → SVG)

`depictWithRdkit(sdf, width, height)` calls RDKit's `get_mol`, removes the explicit
hydrogens, runs `set_new_coords` and calls `get_svg_with_highlights` with
`clearBackground: false`. The result has no background rectangle. The 7.39 MB MinimalLib
loads on first 2D use from `web/public/vendor/rdkit`.

`depictSvg(sdf, width, margin, labels, monochrome, name)` is the Rust fallback. It parses
a V2000 mol block and returns an SVG. Hydrogens are implicit. Heteroatoms are always
labelled; `labels` adds the carbons.

## Repository map

```
crates/molplate_core/   depiction, presets, palettes, figure composition, image ops, wikitext
crates/molplate_wasm/   SVG, figure and JSON exports  (no renderer)
web/src/main.ts         page controller: lookup, modes, markup
web/src/context.ts      shared state, DOM handles, status helpers
web/src/appearance.ts   the colour and appearance panels
web/src/figure.ts       export: PNG composition and SVG download
web/src/keyboard.ts     shortcuts
web/src/theme.ts        Light, Paper, Dark and System
web/src/depiction.ts    inline SVG and the engine choice
web/src/rdkit.ts        RDKit MinimalLib loader
web/src/pubchem.ts      PubChem lookups and the compound type
web/src/sources.ts      Wikidata, Wikipedia, DailyMed / openFDA
web/src/protein.ts      RCSB PDB
web/src/renderer.ts     the only file that knows patinae's API
web/public/vendor/      the vendored patinae and RDKit builds (see their PROVENANCE.md)
web/pkg/                generated wasm + JS bindings (git-ignored)
docs/                   this file, the ADRs and the upgrade report
scripts/dev-env.ps1     toolchain paths for this workstation
```

## Acceptance

* `cargo test -p molplate_core` passes natively (57 tests at the time of writing).
* `cargo build --target wasm32-unknown-unknown -p molplate_wasm` produces the module.
* The page loads, accepts `aspirin`, shows a molecule, and every tab produces markup that
  parses as balanced templates.
* Export at 1600 px writes a 1600 px wide PNG with 6 percent margins and no clipped atoms.
* The 2D view draws a transparent RDKit SVG under 100 KB and downloads it.
* A 1CRN lookup draws a cartoon coloured by secondary structure in under three seconds.
* The same compound loaded by name, CID and SMILES exports byte-identical images.
* Every palette and every colour mode applies without an error, and a fresh load starts
  on the CPK palette with the grey stick ink of the WikiMolGen preset.
* A browser without WebGPU explains itself. The 2D SVG and the markup still work.

`node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu hardware` checks
the browser-facing parts. The `--gpu hardware` flag matters: SwiftShader's flags remove the
adapter this renderer needs, so a software run would report a failure that is about the
flags rather than the app.
