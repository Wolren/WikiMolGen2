# ADR 0004, Offline shell and the precache list

Status: **accepted** (2026-11-22)
Supersedes: nothing

## Context

The app is a static site with no server. Its assets are small except for the renderers:
the patinae viewer and its wasm are about 4.3 MB, the RDKit module and its wasm are about
7.5 MB, and the app's own wasm is about 0.6 MB. RDKit already loads only on the first 2D
view, and the page preconnects to its data sources.

A user who returns to the same figure should not download the shell again, and a user who
opened a figure once should be able to reload the page with the network gone. That needs a
service worker, a manifest and a cache strategy. The strategy must not pin an old build
or defeat the lazy RDKit load.

## Decision

### 1. Register only in the production build

`main.ts` registers `sw.js` when `import.meta.env.PROD` is true. The dev server keeps
working with live modules and no cache. The worker's URL is resolved against
`document.baseURI`, so the same code works at a site root and under the GitHub Pages
project path.

### 2. HTML is network-first; assets are cache-first

A navigation goes to the network first, so a deploy is seen on the next load. The response
is stored and becomes the offline answer. Every other same-origin GET is served from the
cache, then fetched and stored. Cross-origin requests are left alone: PubChem, RCSB and the
metadata services need the network and their answers are not the app's assets.

### 3. The build writes the hashed names

The worker cannot know Vite's hashed filenames at install time. A Vite plugin emits
`precache-manifest.json` with the bundle, the app wasm, the patinae viewer and its wasm,
the icons and the manifest. The worker fetches that list at install and caches it. The RDKit
bundle is deliberately absent: it stays lazy and joins the cache on the first 2D view.

### 4. The cache name is the version knob

`CACHE` in `sw.js` names the cache. Changing it drops the old cache on activate. A deploy
that only changes hashed assets is covered by the network-first HTML and the runtime cache;
a deploy that changes the worker bumps the name for a clean precache.

## Alternatives considered

| Option | Why not |
| --- | --- |
| No service worker | The page works, but a repeat visit pays for the shell and a lost connection leaves nothing |
| Cache the HTML first | A deploy would need a cache version bump before anyone saw it, and a stale page is worse than a network wait |
| Precache every vendor file at install | Forces the 7.5 MB RDKit download before the user asks for 2D, which is the opposite of the lazy load |
| A hardcoded asset list | Vite hashes change on every build; the list would rot silently |
| Intercept cross-origin lookups | The data is not the app, and caching a compound could show a stale structure after an edit |

## Consequences

* The first install fetches the shell, the app wasm and the 3D viewer, about 5 MB, most of
  which the page has already fetched for the first frame.
* A repeat visit opens from the cache even with the network gone. PubChem and RCSB still
  need a connection, so a lookup offline fails with the normal error message.
* The 2D engine is cached after its first use, not at install. An offline first 2D view
  falls back to the Rust V2000 parser and says so.
* `precache-manifest.json` is generated, not edited. Adding a new build output to the list
  means changing the plugin's filter, not the worker.
* A service worker update is visible on the next navigation. The worker calls
  `skipWaiting` and `clients.claim`, so there is no separate "reload to update" prompt.
