# Vendored: RDKit MinimalLib 2026.9.2

These files are the official RDKit.js MinimalLib build, copied verbatim from the npm
package `@rdkit/rdkit@2026.9.2`. Nothing in this directory is edited by hand.

| | |
| --- | --- |
| Upstream | <https://github.com/rdkit/rdkit> |
| Package | <https://www.npmjs.com/package/@rdkit/rdkit> |
| Version | 2026.9.2 (RDKit 2026.09) |
| Licence | BSD-3-Clause, see `LICENSE` in this directory |
| Files | `RDKit_minimal.js` 102588 bytes, `RDKit_minimal.wasm` 7394153 bytes, `RDKit_minimal.d.ts` 9528 bytes |
| SHA-256 | `RDKit_minimal.js` `2160B93AD2F82AEEBA90F5551D9DC8BC21FE9D20E1E7AE7428840C889C073733` |
| | `RDKit_minimal.wasm` `CAF7EB9F09733CFD3E1B038EB5E05F9EEAFC05F58E5780561C583ABA7E5D8FD4` |

## Why vendored

`RDKit_minimal.js` is a classic-script UMD bundle, not an ES module. The page loads it
with a script tag on first use and reads `window.initRDKitModule`.

The wasm sits beside the script, so Emscripten finds it without a bundler. The page also
passes `locateFile`, so the URL is explicit.

The build is 7.39 MB. The page loads it only when the 2D view first opens, so the initial
bundle stays small.

## Rebuild

```powershell
npm pack @rdkit/rdkit@2026.9.2
tar -xzf rdkit-2026.9.2.tgz
```

Copy `package/dist/RDKit_minimal.js`, `package/dist/RDKit_minimal.wasm` and
`package/dist/RDKit_minimal.d.ts` into this directory. Copy the repository
[`license.txt`](https://raw.githubusercontent.com/rdkit/rdkit/master/license.txt) as
`LICENSE`.

There are no local patches. The version must match the npm package exactly, because the
JavaScript glue and the wasm are a pair.
