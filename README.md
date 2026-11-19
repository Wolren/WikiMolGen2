# molplate

Molecule figures for Wikipedia, rendered in the browser.

Load a compound by name, PubChem CID or SMILES. It is fetched straight from PubChem,
rendered to a publication-style figure with [patinae](https://github.com/zmactep/pymol-rs)
in WebAssembly, and handed back together with the `{{Infobox drug}}`, `{{Chembox}}` and
Wikimedia Commons markup that goes around it.

It is a static site: no server, no upload, no install.

![molplate rendering aspirin, with the Commons markup beside it](docs/screenshot.png)

An exported figure — aspirin, ball and stick, cropped and padded by the app itself:

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
node scripts/verify.mjs --dir web/dist --out web/shot.png
```

## How it is put together

* `crates/molplate_core` — presets, image post-processing and the wikitext generators.
  No browser, no GPU, so it is unit-tested natively.
* `crates/molplate_wasm` — the Rust that has to run in the browser: crops a rendered PNG
  into a figure, and generates the markup. It does not render.
* `web/` — Vite + TypeScript: lookups, controls, downloads, and the adapter that drives
  the renderer (`src/renderer.ts`).
* `web/public/vendor/patinae` — the renderer itself: patinae's web viewer, vendored as a
  built ES module plus wasm. Provenance and the rebuild command are in
  [PROVENANCE.md](web/public/vendor/patinae/PROVENANCE.md).

The renderer is patinae (formerly PyMOL-RS), not `molar_vis`. Why it was swapped, what the
swap cost, and what it gives up — notably a WebGL2 fallback — are in
[docs/ADR-0002-renderer-patinae.md](docs/ADR-0002-renderer-patinae.md); the earlier design
and its reasoning are kept in
[docs/ADR-0001-architecture.md](docs/ADR-0001-architecture.md), and what is in and out of
the current scope is in [docs/SPEC.md](docs/SPEC.md).

## Status

Early, but the whole 3D path works end to end: look a compound up, style it, export a
figure, and paste the markup. The gaps that need a chemical toolkit compiled to wasm —
2D skeletal depiction and conformer generation for SMILES PubChem does not know — are
not built yet.

WebGPU is required and the path is exercised: `scripts/verify.mjs --gpu hardware` reports
the live backend, loads aspirin and exports a figure on real hardware.

## Licence

MIT OR Apache-2.0. The renderer (patinae) is BSD-3-Clause; its build is vendored
unmodified under `web/public/vendor/patinae` with the licence beside it.
