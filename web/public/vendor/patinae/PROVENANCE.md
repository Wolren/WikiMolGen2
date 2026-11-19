# Vendored: patinae web viewer 0.5.4

These files are a **build output**, copied here verbatim. Nothing in this directory is
edited by hand — to change it, rebuild from source and copy again.

| | |
| --- | --- |
| Upstream | <https://github.com/zmactep/pymol-rs> (formerly PyMOL-RS; "patinae") |
| Commit | `a52a315618bb1476fb250c2f4e1f26d5a759ab6c` |
| Version | 0.5.4 (`web/package.json`) |
| Licence | BSD-3-Clause — see `LICENSE` in this directory |
| Built | 2026-11-19 |

## Why vendored instead of a dependency

patinae's `web/` crate declares its own `[workspace]` and depends on the rest of patinae
by **path** (`../crates/patinae-render`, …). That means:

* it cannot be consumed as a `cargo` git dependency — cargo resolves a git dependency
  through the manifest at the repository root, and this package is not a member of that
  workspace;
* depending on it by path would tie this repo to a checkout outside it;
* publishing it would mean copying ~200k lines into this repository.

So the page consumes the built ES module and its wasm directly. The cost is that
upgrading means re-running the build below, which is why the commit is recorded here.

## Rebuild

Requires the workspace toolchain (`scripts/dev-env.ps1`), `wasm32-unknown-unknown` and
Node 22+. Cargo's TLS is broken on this workstation, so the loopback crates mirror
(`D:\Projects\tools\crates-mirror\server.mjs`) must be running.

```powershell
git clone https://github.com/zmactep/pymol-rs.git <scratch>\patinae
cd <scratch>\patinae\web
npm ci
npm run build          # wasm-pack + vite, writes dist/ and pkg/
```

Then copy the three files below from `web/dist/` into this directory, plus the repository
`LICENSE`:

```
patinae-viewer.js       # the ES module facade (PatinaeViewer)
patinae_web_bg.wasm     # the renderer (WebGPU only)
patinae_web-<hash>.js   # wasm-bindgen glue; the hash changes between builds
```

`patinae-viewer.js` resolves `patinae_web_bg.wasm` relative to its own URL, so all three
files must stay together under the same path. The facade also imports its glue chunk by
relative path — keep it alongside.

## What the vendored build does not include

* No native plugins (`plugins/raytracer` is a native cdylib) — so no ray tracing here.
* `wasm-pack build --no-opt` is what `npm run build` runs, so the wasm is **not**
  wasm-opt'd. A production deploy would add that pass for a smaller payload.
