# New session prompt: visual and capability upgrade for molplate

Paste this whole file into a fresh session. It is self-contained.

---

## Mission

Make molplate's output and its 3D view substantially better than today. Work on visual
quality, graphics controls and capability. Do not replace the renderer. Improve what the app
does with the renderer it has.

Use `D:\Projects\python\WikiMolGen` as the capability reference. That Python tool is the
mature sibling of this web app: it produces 2D SVG, ray-traced 3D PNG and protein cartoons
for Wikipedia. Molplate is the browser counterpart and currently lacks most of that surface.

Deliver working code, commits on a local branch, and a report with before and after proof.

## What exists today

- App: `D:\Projects\web\molplate`, branch `patinae-rewrite`, clean, HEAD `7a61796`.
- Stack: Vite 8, TypeScript, Rust wasm crates `molplate_core` and `molplate_wasm`.
- Renderer: patinae, vendored at `web/public/vendor/patinae` (4.2 MB wasm). It owns the
  canvas, the camera and the PNG export.
- Export path: `exportPng` at 2x, then `resizePng` (Rust, premultiplied, Triangle filter),
  then `frameFigure` (single trim, even margin). Figure renders around 1433x1243.
- Live view: the canvas is supersampled 2x through the `renderScale` option (commit
  `6c56ec2`). Edge ramp improved from 0.23 px to 0.62 px.
- Known defect: patinae has no MSAA. Every pipeline is `sample_count: 1` and FXAA is the
  only antialiasing. See `docs/ADR-0002-renderer-patinae.md` and
  `web/public/vendor/patinae/PROVENANCE.md`. Do not try to fix this in the renderer.
- Dual build: `pwsh -File scripts/build-dual.ps1` builds patinae at `/` and the old
  molar_vis renderer at `/classic/`, served on port 5182. Use it to compare looks.
- Harnesses: `node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu
  hardware --out <png>` and `cargo test -p molplate_core`.

## Reference: what WikiMolGen already does

Read these files before designing anything.

| Area | Where | What it offers |
| --- | --- | --- |
| 2D SVG | `wikimolgen/rendering/wikimol2d.py` | RDKit `rdMolDraw2D`, element colours, atom highlights, custom scale, margin, font size, coordinate rotation, canvas fitted to the molecule |
| 3D quality | `wikimolgen/rendering/wikimol3d.py` | stick and sphere quality, transparency, `stick_ball`, ray tracing with shadows, `ray_trace_mode`, fog, transparency contrast and oblique, opaque background, explicit width and height |
| Protein | `wikimolgen/rendering/protein.py` | cartoon and cartoon_fancy styles, flat sheets, fancy helices, colour schemes, PDB input |
| Sources | `wikimolgen/sources/` | PubChem props, SDF, substance and experimental; Wikidata; Wikipedia infobox; DailyMed |
| Wikipedia | `wikimolgen/core.py`, CLI | drugbox and chembox templates, Commons upload text |
| Styling | `wikimolgen/configs/loader.py` | named templates and colour templates |

## Current gaps to close

Molplate today offers ball-and-stick, space-filling, licorice and stick presets, element
colours, a transparent background toggle, zoom buttons, PubChem loading, and wikitext
generation. It has no 2D depiction, no protein view, no named style templates, no
highlighting, no labels or annotations, no figure composition controls, and a thin source
list.

## Workstreams

Do them in this order. Commit after each one. Each has an acceptance test that produces a
number or an image.

### A. 2D depiction mode

Give the app a 2D SVG mode beside the 3D view. Evaluate `rdkit-js` (wasm) first. If it is too
heavy, build the depiction from the SDF bond table and the 2D coordinates from PubChem, and
state the tradeoff.

Acceptance: aspirin renders as a clean skeletal SVG with correct element colours, the file
is under 100 KB, and it downloads from the button in the UI. Show the SVG inline.

### B. 3D visual quality controls

Expose what the renderer already has, and improve the default look. Cover stick and sphere
radius, transparency, lighting and exposure, ambient occlusion, silhouette or outline,
depth cueing, background colour and gradient, and per-element colour overrides.

Acceptance: three named looks (publication, flat, dark) render without changing code, and a
screenshot pair against the `/classic/` renderer documents the difference.

### C. Protein cartoons

Add a PDB input path and cartoon rendering. patinae ships `compute/cartoon_extrude.rs`, so
check what its command surface supports before writing anything new.

Acceptance: a PDB ID such as `1CRN` renders as a cartoon in under 3 seconds, with colour by
secondary structure. If the renderer cannot do cartoons, fall back to a documented sticks
view and say so in the report.

### D. Figure composition and export

Add resolution presets (1200, 1600, 2000 px wide), margin control, transparent background,
optional atom labels, optional scale bar, and framing that matches publication spacing.

Acceptance: an export at 1600 px with margins between 5 and 7 percent, no clipped atoms, and
the measured numbers recorded in the report. Keep the current export quality as the floor.

### E. Sources and metadata

Add Wikidata, Wikipedia infobox and DailyMed lookups beside PubChem. Keep the drugbox and
chembox generation working, and extend it with whatever metadata the new sources supply.

Acceptance: load the same compound by name, CID and SMILES with identical render output, and
show one added metadata field that PubChem alone does not give.

### F. Interface

Add a style picker, a 2D and 3D toggle, keyboard shortcuts, a progress state for slow loads,
and a layout that works at 1280 px wide and at 800 px wide.

Acceptance: a screenshot at both widths, no overflow, and a keyboard path from load to
export.

## Rules

- Renderer work is out of scope. If a capability needs it, document the gap and ship the
  browser-side version.
- Write in ASD-STE100 style. No em dashes, no contractions, no idioms, sentences of 20 words
  or fewer. This applies to code comments, docs and commit messages.
- Scratch files, screenshots and experiments go to `D:\Scratch\dsh`.
- Commit locally and never push. Use imperative commit subjects under 72 characters.
- Verify before you claim. A number or an image backs every statement in the report.

## Verification commands

```
pwsh -File scripts/build-dual.ps1 -NoServe
node scripts/verify.mjs --url http://localhost:5173/ --headed true --gpu hardware --out D:\Scratch\dsh\verify.png
cargo test -p molplate_core
cd web; npm run build
```

## Deliverable

A branch with one commit per workstream, and `docs/UPGRADE-REPORT.md` containing the
before and after images, the measured numbers, the gaps that remain, and the next step you
would take. Present the report at the end of the session.
