import { defineConfig } from "vite";

export default defineConfig({
  // Relative assets work at the site root and under the GitHub Pages project path.
  base: "./",
  server: {
    // The vendored wasm is a large, locked binary. HMR does not need to watch it.
    watch: {
      ignored: ["**/public/vendor/**"],
    },
    headers: {
      // patinae's wasm is built for a cross-origin-isolated page and its own dev server
      // sets this pair. `credentialless` rather than `require-corp` keeps the PubChem
      // lookup working: a CORS fetch there is fine, a CORP-gated subresource would not be.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  // The viewer is a prebuilt ES module plus its wasm under public/vendor/patinae, so it
  // is copied verbatim rather than bundled. It resolves the wasm relative to its own URL,
  // which is why the files have to stay together.
});
