# WikiMolGen 2, scope and contracts

What the app does, what it deliberately does not do yet, and the contracts between its
parts. Architecture rationale lives in [ADR-0001](ADR-0001-architecture.md), the
renderer swap is in [ADR-0002](ADR-0002-renderer-patinae.md), the theme token model is in
[ADR-0003](ADR-0003-theme-tokens.md), and the offline shell is in
[ADR-0004](ADR-0004-offline-shell.md). The upgrade that added most of this surface is
recorded in [UPGRADE-REPORT.md](UPGRADE-REPORT.md).

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

The page has two columns. The left column holds the instruments: lookup, style, colour,
appearance and the export settings, the long ones folded into sections that remember their
state. The right column is the figure with its toolbar and status line, then the generated
markup, which is the order WikiMolGen presents them in. The page displays no compound
summary: the metadata feeds the markup instead.

A lookup is written to the address as `?q=`, and boot reads it back, so a figure can be
shared or reloaded without retyping the name.

Below 1100 px the columns stack, controls first, so the lookup field is the first thing in
reach; a load then scrolls the figure into view.

## In v1

| Capability | Detail |
| --- | --- |
| Lookup by name, CID or SMILES | Name and CID resolve directly; a SMILES is resolved through PubChem's structure search, so only compounds PubChem knows work |
| Protein lookup | A four-character PDB ID (for example `1CRN`) or a `pdb:` prefix fetches the entry from RCSB and draws a cartoon |
| 3D structure | PubChem's 3D record; a compound without one falls back to its 2D record and says so |
| 2D depiction | RDKit's MinimalLib draws the skeletal SVG with canonical layout, stereo and element colours, or black and white. Bond width and label size are adjustable. The SVG has no background and carries a title. The 7.39 MB module loads on first 2D use. A Rust V2000 parser is the fallback and honours the monochrome switch |
| Styles | Publication, Flat and Dark finishes of ball-and-stick; space filling, licorice and stick; protein cartoons by the N to C rainbow, the trans flag inks, secondary structure or chain. The finishes start from the WikiMolGen preset: CPK spheres, grey sticks, a white page |
| Colour | Styles the 3D figure: colour by element, chain, residue type, the N to C rainbow, secondary structure, B-factor or a single ink. Seven element palettes: CPK (default), Jmol, RasMol, ChemDraw, VMD, print inks and dark figure. Sticks follow the atoms or take one flat ink. A cartoon takes three secondary-structure inks. Per-element overrides sit on top of the palette. The panel steps aside in the 2D view; the drawing bakes the scheme's element inks when it is built |
| View | Projection, zoom and re-frame, orientation presets (wiki 10°/20°, front, side, top) with custom X, Y and Z angles, and zoom to a selection |
| Appearance | A Preset row applies the original Wikipedia settings and the matching supersample; Save captures the current settings as a named preset in localStorage, Rename changes a saved name, Delete removes a saved one, and any manual change flips the row to Custom. Grouped as shape, light, effects and surface: stick radius, sphere size, valence and its size, the five light values, three transparencies, blending, depth cue with fog and fog start, ambient occlusion with strength and radius, soft shadows with strength, outline and width, smooth edges. Background and gradient are export settings. A two-step Reset sliders at the end restores the look's own appearance; the colour scheme stays. The colour scheme is the separate colour preset |
| Controls | View comes first, then export, style, colour and appearance. Every category starts folded, and an opened one stays open across reloads |
| Figures | The figure toolbar holds the 3D/2D switch, full screen and the download. The stage keeps a height rather than sharing the leftover space, so the molecule is drawn large and the column scrolls |
| Navigation | Viewer's own mouse controls, zoom buttons, re-frame, full screen, and keyboard shortcuts |
| Links | A lookup is written to `?q=` and read back on boot, so a figure can be shared or reloaded |
| Batch export | A dialog takes one identifier per line, renders each item with the current look and export settings, and packs the figures into one store-only ZIP. A failed row is recorded and the run continues. A run can be cancelled between rows, a failed or cancelled row can be retried on its own, and a progress bar names the current item |
| Export | The download button sits in the figure toolbar. PNG at any width from 400 to 8192 px; a 4 to 9 percent margin; 4x supersampling by default, lowered automatically when the render budget needs it; optional atom labels and scale bar; transparent by default, with an optional background and export gradient |
| Lookup | A combobox on the identifier field. A local index of 58 compounds and 13 proteins answers at once; PubChem autocomplete and RCSB full-text search add live results. A row fills the field and loads it; arrows, Enter and Escape work |
| Metadata | PubChem properties, Wikidata identifiers and ATC codes, Wikipedia clinical fields and an openFDA drug label, merged into the infobox and chembox fields. The page does not display them in a panel |
| `{{Infobox drug}}` | Field names, section order and escaping as the template expects, including ATC, routes and legal status |
| `{{Chembox}}` | Nested sections: identifiers, properties, pharmacology, hazards |
| Commons | File name, `{{Information}}` plus licence block, pre-filled upload URL; the licence follows the structure kind |
| Outputs | The drug infobox, the chembox and the Commons upload text sit stacked in one panel, in that order. Each box has a Copy action in its top-right corner; the Commons block carries the Upload to Commons link under its text; a protein shows the Commons text only |
| Keyboard | `Ctrl+Enter` load, `2`/`3` view, `E` export, `F` frame, `+`/`-` zoom, `/` focus, `?` help |
| Theme | System, six fixed palettes (Light, Paper, Contrast, Dark, Slate and Midnight) and saved custom themes. The picker previews every palette with a miniature of the page; a custom theme is built from five colours, derives the rest with 4.5:1 contrast floors, and is named. Themes can be duplicated, copied as a link, or exported and imported as JSON; open tabs follow storage changes. The choice persists and applies before the first paint, and System resolves to Contrast when the OS asks for more contrast. The stage follows the theme tint |
| Accessibility | A reduced-motion rule stops the spinner and the transitions. The 3D host and the 2D SVG carry accessible names, the SVG carries a title, every control has a label, and the dialogs trap focus natively |
| Offline | The built site registers a service worker: network-first HTML, cache-first hashed assets. The shell, the app wasm and the patinae viewer are precached from a build-generated list; the RDKit engine is cached on first 2D use. A manifest names the site and sets its theme colour |
| Links | The top bar carries the repository, the original WikiMolGen project and the docs, then the theme picker. Below 640 px the links fold away |
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
| Export edges above 8192 px | The renderer exports one view at a time; 8000x6963 completes at 1x, while 8000x10884 exceeded the 60 MP budget. The GPU reports 16384 | A tiled export, or an export offset in patinae |
| Supersampling above 6x | The quality select stops at 6x; the 8192 edge cap limits it further at large widths | A tiled export, or a lower-level renderer option |
| Direct DailyMed reads | The DailyMed service sends no CORS header, so the browser cannot read it | A proxy, or an upstream CORS header; openFDA serves the same SPL labels today |
| Protein 2D or sequence view | A cartoon is the useful figure for an article | A sequence panel and a depiction path |
| Element labels in 3D by symbol | The renderer's label expression has no element field; atom names are the substitute | A renderer label expression, or browser-side projection |
| Two-sided lighting, stick and sphere quality | patinae carries them as session fields, and its `set` registry rejects the names. These stay session fields | A patinae registry fix, or a session-level setter |

## Contracts

### `Compound` (TypeScript → Rust)

`web/src/pubchem.ts` produces it, `wikimolgen2_core::wikitext::Compound` consumes it. All
fields are optional; missing fields are omitted from the markup rather than rendered empty.
Field names are `snake_case` on both sides because serde maps them directly. Metadata from
Wikidata, Wikipedia and openFDA is merged after the figure renders, and PubChem wins where
both sources know a field.

### `Look` (Rust → TypeScript)

`looksJson()` and `proteinLooksJson()` return the preset lists; the page renders them and
hands a chosen preset to `Renderer.applyLook(look)` unchanged. The object is
`wikimolgen2_core::style::Look`, the same type in both directions, so a renamed field breaks
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

### Theme tokens (TypeScript → CSS)

The interface has one token set: 21 custom properties (`--ink`, `--surface`, `--accent`,
`--stage-tint`, `--shadow-2` and the rest) that every rule reads. A fixed palette is a
block in `styles.css` under `[data-theme="light|paper|contrast|dark|slate|midnight"]`. The
same block carries `[data-theme-preview="..."]`, so a picker card paints the real palette
instead of a hand-made copy.

A custom theme is data. `ThemeSeed` holds five hex colours: accent, page, panel, text and
figure backdrop. `deriveTheme` expands them in OKLab, with floors: muted and faint text
reach 4.5:1 against the panel, and the accent reaches 4.5:1 or is lifted toward black or
white. The mode follows the panel's luminance. The result is written inline on `<html>`,
and a copy is stored for the head script:

| Key | Value |
| --- | --- |
| `wikimolgen2.theme` | `system`, a fixed id, or `custom-<id>` |
| `wikimolgen2.theme-mode` | the resolved `light` or `dark` |
| `wikimolgen2.custom-themes` | `[{ id, name, seed }]` |
| `wikimolgen2.theme-vars` | `{ id, mode, vars }`, the resolved tokens for a custom first paint |

The head script only applies a stored payload; it never derives a palette. `data-scheme`
carries the mode for the two rules that need it: the RDKit black inks in `stage.css`.

A theme leaves the browser in two forms. A `?theme=` link carries a base64url JSON payload
`{ v: 1, name, seed }`; boot applies it, saves the theme, selects it and removes the
parameter. A theme file carries `{ kind: "wikimolgen2-theme", version: 1, name, seed }`.
Both resolve by name and seed, so a repeated link or file selects the saved theme instead
of adding a duplicate. The saved list caps at 40.

A `storage` event on the theme choice or the custom list reloads the list and re-applies
the stored choice in every other tab. An open editor defers the update until it saves or
cancels, so a preview is not overwritten. `System` resolves through `prefers-color-scheme`
and `prefers-contrast: more`; the second selects the Contrast palette.

### Element palettes (Rust → TypeScript)

`colorSchemesJson()` returns the picker entries: `id`, `label`, `description` and the stick
ink the scheme expects. `schemeColor(scheme, symbol)` returns one element's `#rrggbb`.

The tables live in `crates/wikimolgen2_core/src/palette.rs`: the CPK table (120 rows, 118
elements plus the D and T aliases) plus the handful of overrides that define each viewer's
palette. CPK is the default, so a WikiMolGen 2 figure matches a WikiMolGen render.

The page resolves the palette for the elements the structure has and sends the result as
`element_colors`, which keeps the command count to the molecule rather than the periodic
table. A user override wins over the scheme; a non-element colour mode sends no element
inks at all, because the mode command has already painted the atoms.

### Lookups and network (TypeScript)

`net.ts` is the only place the page calls `fetch`. Each request gets a deadline, one retry
for a network error, a 429 or a 5xx, and a short session cache for GETs. A definitive
answer, such as a 404, is not retried. `requestJson`, `requestText` and `requestBytes` key
the cache by method and URL, so two lookups of the same record share one request. PubChem
and RCSB retry once; the optional metadata calls pass `retries: 0` so the figure does not
wait on them. A failure surfaces as `NetworkError`, with a `timeout` flag, or `HttpError`,
with the status.

### Offline shell (Vite → service worker)

`web/public/sw.js` registers only in the production build. Install caches the shell and
fetches `precache-manifest.json`, which the Vite plugin writes with the hashed bundle, the
app wasm, the patinae viewer and its wasm. The RDKit bundle is not
precached; the first 2D use caches it at runtime. Navigation is network-first, so a deploy
is seen on the next load. Every other same-origin GET is cache-first with a runtime fill.
The cached HTML is the offline fallback. `CACHE` in `sw.js` is the version knob.

### Figure spec (TypeScript → Rust)

`composeFigure(png, spec_json)` reads `wikimolgen2_core::figure::FigureSpec`:

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

The page renders at 2x, 3x, 4x or 6x the output width, then composes at the exact width. A
large width lowers the factor so no render edge exceeds 8192 px, the export limit on this
build.

The output width is exact. The content is scaled to `width - 2 * margin_px`, so the
horizontal margin is exact and no atom leaves the canvas. The scale bar is drawn in the
bottom margin from the Å per pixel that the camera reports through `get_view`.

### Depiction (RDKit → SVG)

`depictWithRdkit(sdf, width, height)` calls RDKit's `get_mol`, removes the explicit
hydrogens, runs `set_new_coords` and calls `get_svg_with_highlights` with
`clearBackground: false`. The result has no background rectangle. The parsed mol is kept
while the same record is redrawn, so a control change does not run CoordGen again. The
7.39 MB MinimalLib loads on first 2D use from `web/public/vendor/rdkit`.

The drawing options map to MinimalLib keys. `monochrome` fills `atomColourPalette` with
black for every atomic number, `bondWidth` sets `bondLineWidth`, and `labelSize` sets
`fixedFontSize`; zero keeps RDKit's default. The SVG gains a `<title>`; the in-page root
also carries `role="img"` and an `aria-label`.

`depictSvg(sdf, width, margin, labels, monochrome, name)` is the Rust fallback. It parses
a V2000 mol block and returns an SVG. Hydrogens are implicit. Heteroatoms are always
labelled; `labels` adds the carbons. Only the monochrome switch applies to this path.

## Repository map

```
crates/wikimolgen2_core/   depiction, presets, palettes, figure composition, image ops, wikitext
crates/wikimolgen2_wasm/   SVG, figure and JSON exports  (no renderer)
web/src/main.ts         page controller: lookup, modes, markup
web/src/context.ts      shared state, DOM handles, status helpers
web/src/appearance.ts   the colour and appearance panels
web/src/panel.ts        the foldable control sections
web/src/figure.ts       export: PNG composition and SVG download
web/src/keyboard.ts     shortcuts
web/src/theme.ts        the chosen theme, saved custom themes and token derivation
web/src/theme-colour.ts OKLab mixing, alpha and contrast maths
web/src/theme-dialog.ts the preview picker and the custom theme editor
web/src/depiction.ts    inline SVG, drawing options and the engine choice
web/src/rdkit.ts        RDKit MinimalLib loader and draw options
web/src/net.ts          deadlines, one retry and the session cache
web/src/pubchem.ts      PubChem lookups and the compound type
web/src/sources.ts      Wikidata, Wikipedia, DailyMed / openFDA
web/src/protein.ts      RCSB PDB
web/src/renderer.ts     the only file that knows patinae's API
web/src/*.test.ts       unit tests for colour maths, theme files and the network client
web/public/sw.js        the offline shell
web/public/manifest.webmanifest   the app name and theme colour
web/vite.config.ts      base, dev headers and the precache list
web/vitest.config.ts    unit test config
web/public/vendor/      the vendored patinae and RDKit builds (see their PROVENANCE.md)
web/pkg/                generated wasm + JS bindings (git-ignored)
docs/                   this file, the ADRs and the upgrade report
scripts/verify.mjs      the browser check, full and smoke
scripts/dev-env.ps1     toolchain paths for this workstation
```

## Acceptance

* `cargo test -p wikimolgen2_core` passes natively (57 tests at the time of writing).
* `cd web; npm test` passes the 22 unit tests for colour maths, theme files and the
  network client.
* `cargo build --target wasm32-unknown-unknown -p wikimolgen2_wasm` produces the module.
* The page loads, accepts `aspirin`, shows a molecule, and all three outputs produce markup
  that parses as balanced templates.
* The field offers the shortlist on focus, finds aspirin and 1CRN by name, and a row click loads the entry.
* Export at 1600 px writes a 1600 px wide PNG with 6 percent margins and no clipped atoms.
* The 2D view draws a transparent RDKit SVG under 100 KB and downloads it. The monochrome
  switch removes the element inks and the bond width changes the SVG stroke.
* A batch of two figures finishes, and cancel stops a longer run after the current row.
  A failed row offers Retry and downloads that figure on its own.
* A theme link and a theme file both add the theme once; a duplicate action copies it.
  A theme changed in a second tab reaches the first without a reload.
* The page carries a valid manifest, the service worker reaches `active`, and a reload
  with the server stopped still opens the shell.
* A 1CRN lookup draws a cartoon coloured by secondary structure in under three seconds.
* The same compound loaded by name, CID and SMILES exports byte-identical images.
* Every palette and every colour mode applies without an error, and a fresh load starts
  on the CPK palette with the grey stick ink of the WikiMolGen preset.
* The long control sections start folded, and an opened one stays open across a reload.
* The theme picker lists System and the six fixed palettes, and a card's miniature uses
  the palette it offers.
* A custom theme saved from five colours survives a reload with its name, its accent and
  no flash before the module loads.
* Deleting the active custom theme returns the page to System after a second click.
* A `?q=aspirin` link loads the compound on its own.
* Full screen gives the stage the whole display, the toolbar stays, and the button exits.
* A browser without WebGPU explains itself. The 2D SVG and the markup still work.

`node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu hardware` checks
the browser-facing parts. The `--gpu hardware` flag matters: SwiftShader's flags remove the
adapter this renderer needs, so a software run would report a failure that is about the
flags rather than the app. Add `--smoke true` to skip the export, full screen, batch and
deep-link checks while a page change is in progress.
