# molplate

Molecule figures for Wikipedia, rendered in the browser.

Load a compound by name, PubChem CID or SMILES. It is fetched straight from PubChem,
rendered to a publication-style figure with [molar_vis](https://github.com/yesint/molar_vis)
in WebAssembly, and handed back together with the `{{Infobox drug}}`, `{{Chembox}}` and
Wikimedia Commons markup that goes around it.

It is a static site: no server, no upload, no install.

## Build

Requirements: a Rust toolchain with the `wasm32-unknown-unknown` target,
`wasm-bindgen-cli` matching the version `Cargo.lock` pins, and Node 20+.

```powershell
# 1. Renderer + bindings (release build; the first one is slow)
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

## How it is put together

* `crates/molplate_core` — presets, image post-processing and the wikitext generators.
  No browser, no GPU, so it is unit-tested natively.
* `crates/molplate_wasm` — boots the viewer on a `<canvas>`, drives it through its job
  channel, and returns captured PNGs to JavaScript.
* `web/` — Vite + TypeScript: lookups, controls, downloads.

The renderer is the upstream `molar_vis` library, embedded rather than forked, with its
own sidebar and toolbar hidden. Details and the trade-offs, including why export is a
screenshot of a resized canvas rather than an offscreen render, are in
[docs/ADR-0001-architecture.md](docs/ADR-0001-architecture.md); what is in and out of the
current scope is in [docs/SPEC.md](docs/SPEC.md).

## Status

Early. The 3D path, PNG export and all three markup generators work; the 2D skeletal
depiction and conformer generation for SMILES that PubChem does not know are not built
yet, and are the two gaps that need a chemical toolkit compiled to wasm.

## Licence

MIT OR Apache-2.0. The renderer is Artistic-2.0 and is used unmodified as a dependency.
