// End-to-end check of the built page in a real browser, over the DevTools protocol.
//
// Serves a directory, opens Chrome headless, loads a compound through the page's own
// controls, and reports what the console said plus a screenshot. No test framework: it
// is one script with one job, so a failure is a line of output, not a stack trace.
//
//   node scripts/verify.mjs --dir web/dist --out D:/Projects/tools/scratch/WikiMolGen 2.png
//   node scripts/verify.mjs --dir web --entry /                 # vite dev server variant
//
// Exit code is 0 only when the page loaded, produced markup, and the canvas was drawn on.

import { createServer } from "node:http";
import { readFile, readdir, mkdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, resolve, dirname } from "node:path";

const args = parseArgs(process.argv.slice(2));
const ROOT = resolve(args.dir ?? "web/dist");
const OUT = resolve(args.out ?? "screenshot.png");
const PORT = Number(args.port ?? 4173);
const COMPOUND = args.compound ?? "aspirin";
const verbose = args.verbose === "true";
const smoke = args.smoke === "true";
const EXTRA_FLAGS = args.flags ? args.flags.split("|").filter(Boolean) : [];
const CHROME = args.chrome ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// `--url` checks an already-running server (e.g. `npm run dev`); otherwise this script
// serves `--dir` itself so a build can be verified without starting anything else.
let server = null;
const baseUrl = args.url ?? `http://127.0.0.1:${PORT}/`;

if (args.url === undefined) {
  server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    const path = join(ROOT, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    try {
      const body = await readFile(path);
      response.writeHead(200, {
        "content-type": MIME[extname(path)] ?? "application/octet-stream",
        // WebGPU/WebGL2 do not need COOP/COEP, but the page should still work when a host
        // serves these headers.
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "credentialless",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  await new Promise((done) => server.listen(PORT, "127.0.0.1", done));
}
console.log(`target: ${baseUrl}`);
if (smoke) console.log("smoke: export, full screen, batch and deep link skipped");

const profile = join(process.env.TEMP ?? "/tmp", `wikimolgen2-verify-${Date.now()}`);
// Headless Chrome has no WebGPU adapter, so the WebGPU path needs a real browser process.
// `--headed true` runs it off-screen instead of popping a window in front of the user.
// `--gpu hardware` drops the SwiftShader overrides — forcing ANGLE's software GL also
// removes the hardware path that WebGPU needs, so a software run must not claim to test it.
const headed = args.headed === "true";
const hardwareGpu = args.gpu === "hardware";
const gpuFlags = hardwareGpu
  ? []
  : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"];
const chrome = spawn(
  CHROME,
  [
    ...(headed ? ["--window-position=-2400,-2400"] : ["--headless=new"]),
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--enable-unsafe-webgpu",
    ...gpuFlags,
    "--window-size=1440,900",
    ...EXTRA_FLAGS,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let stderr = "";
chrome.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const port = await debugPort(chrome, () => stderr);
const endpoint = await json(`http://127.0.0.1:${port}/json/version`);
const socket = new WebSocket(endpoint.webSocketDebuggerUrl);
await once(socket, "open");

let nextId = 1;
const pending = new Map();
const consoleErrors = [];

/** Resolved by the download-completion event, so no directory polling is needed. */
let downloadFinished = null;

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    entry?.resolve(message);
    return;
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = message.params.args
      .map((arg) => arg.value ?? arg.description ?? "")
      .join(" ");
    if (message.params.type === "error") consoleErrors.push(text);
    else if (verbose) console.log(`  [console.${message.params.type}] ${text}`);
  }
  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    const text = details.exception?.description ?? details.text ?? "exception";
    consoleErrors.push(text);
    if (verbose) console.log(`  [exception] ${text}`);
  }
  if (message.method?.startsWith("Browser.download") && verbose) {
    console.log(`  [${message.method}] ${JSON.stringify(message.params)}`);
  }
  // The completion event carries the real path; polling the directory races the browser.
  if (message.method === "Browser.downloadProgress" && message.params.state !== "inProgress") {
    downloadFinished?.(message.params);
  }
});

const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { resolve: res, reject: rej });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });

const { result: target } = await send("Target.createTarget", { url: "about:blank" });
const { result: attached } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
const session = attached.sessionId;

await send("Runtime.enable", {}, session);
await send("Page.enable", {}, session);
await send("Log.enable", {}, session);
// A screenshot for the docs wants a pinned colour scheme, not whatever the host prefers.
if (args.scheme === "light" || args.scheme === "dark") {
  await send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-color-scheme", value: args.scheme }] },
    session,
  );
}
// A fixed viewport checks the narrow layout without depending on the host window size.
const viewport = /^(\d+)x(\d+)$/.exec(args.viewport ?? "");
if (viewport !== null) {
  await send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: Number(viewport[1]),
      height: Number(viewport[2]),
      deviceScaleFactor: 1,
      mobile: false,
    },
    session,
  );
}
await send("Page.navigate", { url: baseUrl }, session);
const bootStart = Date.now();
await waitForLoad(session);

const failures = [];

// 0. What graphics backends does this browser actually offer?
const backends = await evaluate(
  session,
  `JSON.stringify({
     webgl2: !!document.createElement('canvas').getContext('webgl2'),
     webgpu: typeof navigator.gpu !== 'undefined',
   })`,
);
console.log(`backends: ${backends}`);
if (verbose) console.log(`  user agent: ${await evaluate(session, "navigator.userAgent")}`);

// PubChem is the one external dependency; a blocked request is the usual reason a load
// produces nothing, and it looks identical to a parse failure from the outside.
if (verbose) {
  const probe = await evaluate(
    session,
    `(async () => {
       const urls = [
         'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/record/SDF?record_type=3d',
         'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/aspirin/property/MolecularFormula/JSON',
       ];
       const out = [];
       for (const url of urls) {
         try {
           const response = await fetch(url);
           out.push(url.split('/').slice(-2).join('/') + ' -> ' + response.status);
         } catch (error) {
           out.push(url.split('/').slice(-2).join('/') + ' -> ' + error.message);
         }
       }
       return out.join(' | ');
     })()`,
  );
  console.log(`pubchem: ${probe}`);

  const adapter = await evaluate(
    session,
    `(async () => {
       if (!navigator.gpu) return 'no navigator.gpu';
       try {
         const found = await navigator.gpu.requestAdapter();
         if (!found) return 'requestAdapter -> null';
         const info = found.info ?? (found.requestAdapterInfo ? await found.requestAdapterInfo() : {});
         return 'adapter: ' + [info.vendor, info.architecture, info.description].filter(Boolean).join(' ');
       } catch (error) {
         return 'requestAdapter ERR ' + error.message;
       }
     })()`,
  );
  console.log(`webgpu: ${adapter}`);

  const appPath = await evaluate(
    session,
    `(async () => {
       const props = ['Title','IUPACName','MolecularFormula','MolecularWeight','IsomericSMILES',
         'ConnectivitySMILES','InChI','InChIKey','XLogP','TPSA','HBondDonorCount','HBondAcceptorCount',
         'RotatableBondCount','HeavyAtomCount','Charge','ExactMass','MonoisotopicMass','Complexity'].join(',');
       const base = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';
       const byName = await fetch(base + '/name/aspirin/property/' + props + '/JSON');
       const json = await byName.json();
       const row = json.PropertyTable?.Properties?.[0];
       const cid = row?.CID;
       const sdf = await fetch(base + '/cid/' + cid + '/record/SDF?record_type=3d');
       return JSON.stringify({ nameStatus: byName.status, cid, sdfStatus: sdf.status });
     })()`,
  );
  console.log(`app path: ${appPath}`);
}

// 1. The renderer must have started. Startup is asynchronous (wasm init + GPU device);
//    boot sets `data-ready` when it finishes, and a failed renderer leaves an error
//    overlay instead. The stage overlay itself now carries the empty-state hint.
const stageReady = await poll(async () => {
  const flagged = await evaluate(
    session,
    "document.documentElement.dataset.ready === '1'",
  );
  const failed = await evaluate(
    session,
    "document.getElementById('stage-message')?.classList.contains('error') ?? false",
  );
  return flagged || failed ? { ready: flagged, failed } : null;
}, 60_000);

const stageText = await evaluate(session, "document.getElementById('stage-message')?.textContent ?? ''");
if (stageReady === null) failures.push("renderer never finished starting");
if (stageReady !== null && !stageReady.ready) failures.push(`renderer did not start: ${stageText.trim()}`);
console.log(`renderer: ${stageReady?.ready ? "started" : "FAILED — " + stageText.trim()}`);
console.log(`boot: ${((Date.now() - bootStart) / 1000).toFixed(2)} s from navigation to ready`);

// The empty stage says what to do, and the long sections start folded.
const emptyText = await evaluate(session, "document.getElementById('stage-text')?.textContent ?? ''");
if (!emptyText.includes("Load a compound")) {
  failures.push(`the empty stage reads "${emptyText.trim()}"`);
}
const sections = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify({
       order: Array.from(document.querySelectorAll('details.section')).map((node) => node.id),
       view: document.getElementById('section-view').open,
       style: document.getElementById('section-style').open,
       colour: document.getElementById('section-colour').open,
       appearance: document.getElementById('section-appearance').open,
       export: document.getElementById('section-export').open,
     })`,
  ),
);
console.log(`sections: ${sections.order.join(' > ')}, all folded: ${!sections.view && !sections.style && !sections.colour && !sections.appearance && !sections.export}`);
if (sections.order[0] !== "section-view") failures.push(`the first section is ${sections.order[0]}`);
for (const id of ["view", "style", "colour", "appearance", "export"]) {
  if (sections[id] !== false) failures.push(`the ${id} section starts open`);
}

// The finish controls read the same defaults the Rust side ships.
const finish = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify({
       valence: document.getElementById('valence').checked,
       valenceScale: document.getElementById('valence-scale').value,
       stick: document.getElementById('stick-transparency').value,
       sphere: document.getElementById('sphere-transparency').value,
       cartoon: document.getElementById('cartoon-transparency').value,
       blending: document.getElementById('transparency-mode').value,
       antialias: document.getElementById('antialias').checked,
       fogStart: document.getElementById('fog-start').value,
       aoRadius: document.getElementById('ao-radius').value,
       shadow: document.getElementById('shadow-strength').value,
     })`,
  ),
);
console.log(`finish defaults: ${JSON.stringify(finish)}`);

// The top bar carries the project's two references, and they must point somewhere real.
const links = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify(Array.from(document.querySelectorAll('.topbar-links a')).map(
       (node) => [node.textContent.trim(), node.getAttribute('href')],
     ))`,
  ),
);
console.log(`topbar links: ${links.map(([label, href]) => `${label} -> ${href}`).join(", ")}`);
for (const expected of [
  "https://github.com/Wolren/WikiMolGen2",
  "https://github.com/Wolren/WikiMolGen",
]) {
  if (!links.some(([, href]) => href === expected)) failures.push(`no ${expected} link in the top bar`);
}

// A closed dialog must not paint; its flex layout otherwise keeps the buttons on the page.
const closedDialog = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify((() => {
       const dialog = document.getElementById('theme-dialog');
       const rect = dialog.getBoundingClientRect();
       return {
         open: dialog.open,
         display: getComputedStyle(dialog).display,
         width: Math.round(rect.width),
         height: Math.round(rect.height),
       };
     })())`,
  ),
);
console.log(`theme dialog closed: ${JSON.stringify(closedDialog)}`);
if (closedDialog.open || closedDialog.display !== "none" || closedDialog.width > 0) {
  failures.push("the closed theme dialog is still in the page");
}

// The built page carries a web manifest and installs an offline shell.
const manifestLink = await evaluate(
  session,
  "document.querySelector('link[rel=\"manifest\"]')?.getAttribute('href') ?? ''",
);
const manifestJson = await poll(
  async () =>
    await evaluate(
      session,
      "fetch('manifest.webmanifest').then((response) => response.ok ? response.json() : null).then((json) => json !== null && json.name === 'WikiMolGen 2' ? json : null).catch(() => null)",
    ),
  10_000,
);
if (manifestLink === "") failures.push("the page has no web manifest link");
if (manifestJson === null) failures.push("the web manifest is missing or invalid");
const swState = await poll(
  async () =>
    await evaluate(
      session,
      `("serviceWorker" in navigator
        ? navigator.serviceWorker.getRegistration().then((registration) =>
            registration === undefined ? "none" : registration.active !== null ? "active" : "pending")
        : Promise.resolve("unsupported"))`,
    ),
  20_000,
);
if (swState !== "active") failures.push(`the service worker is ${swState ?? "not active"}`);
console.log(
  `offline: manifest ${manifestJson?.name ?? "missing"}, service worker ${swState ?? "inactive"}`,
);
if (finish.valence !== true) failures.push("valence bonds start off");
if (finish.valenceScale !== "1") failures.push(`valence size starts at ${finish.valenceScale}`);
if (finish.stick !== "0" || finish.sphere !== "0" || finish.cartoon !== "0") {
  failures.push("a transparency slider does not start at zero");
}
if (finish.blending !== "1") failures.push(`blending starts at ${finish.blending}`);
if (finish.antialias !== true) failures.push("smooth edges starts off");
if (finish.fogStart !== "1") failures.push(`fog start starts at ${finish.fogStart}`);
if (finish.aoRadius !== "0.5") failures.push(`AO radius starts at ${finish.aoRadius}`);
if (finish.shadow !== "0.5") failures.push(`shadow strength starts at ${finish.shadow}`);

// 2. A row click loads the entry; the explicit focus event covers the offscreen window.
await evaluate(
  session,
  `(() => {
     const input = document.getElementById('identifier');
     input.value = '';
     input.dispatchEvent(new Event('input', { bubbles: true }));
     input.focus();
     input.dispatchEvent(new FocusEvent('focus'));
     return true;
   })()`,
);
const popular = await evaluate(
  session,
  "document.querySelectorAll('#suggestions button.suggestion').length",
);
if (popular < 5) {
  const diag = await evaluate(
    session,
    `JSON.stringify({
       active: document.activeElement?.id,
       hidden: document.getElementById('suggestions')?.hidden,
       kids: document.getElementById('suggestions')?.children.length,
       value: document.getElementById('identifier')?.value,
       expanded: document.getElementById('identifier')?.getAttribute('aria-expanded'),
     })`,
  );
  failures.push(`the empty field offers ${popular} suggestions; ${diag}`);
}
const aspirinHint = await evaluate(
  session,
  `(() => {
     const row = [...document.querySelectorAll('#suggestions button.suggestion')]
       .find((node) => node.querySelector('.suggestion-label')?.textContent === 'Aspirin');
     return row?.querySelector('.suggestion-hint')?.textContent ?? '';
   })()`,
);
console.log(`aspirin hint: ${aspirinHint}`);
if (aspirinHint !== "CID 2244") failures.push(`the aspirin hint is "${aspirinHint}", not "CID 2244"`);
await evaluate(
  session,
  `(() => {
     const input = document.getElementById('identifier');
     input.value = ${JSON.stringify(COMPOUND)};
     input.dispatchEvent(new Event('input', { bubbles: true }));
     return true;
   })()`,
);
const values = JSON.parse(
  await evaluate(
    session,
    "JSON.stringify(Array.from(document.querySelectorAll('#suggestions button.suggestion')).map((node) => node.dataset.value))",
  ),
);
const wanted = values.findIndex(
  (value) => String(value).toLowerCase() === COMPOUND.toLowerCase(),
);
if (wanted < 0) failures.push(`the suggestions do not list ${COMPOUND}: ${values.join(", ")}`);
else {
  await evaluate(
    session,
    `document.querySelectorAll('#suggestions button.suggestion')[${wanted}].click(), true`,
  );
}

// The status line under the figure is the page's one progress report, so it is what
// says a load finished. A protein's first cartoon frame compiles pipelines; measured
// up to 33 s under load.
const loaded = await poll(async () => {
  const text = await evaluate(session, "document.getElementById('export-status').textContent ?? ''");
  return text.includes("Loaded") ? text : null;
}, 90_000);
if (loaded === null) failures.push("no load status appeared");
else console.log(`status: ${loaded.slice(0, 160)}`);

// A protein has no drug box and no flat record, so the compound-only checks below skip.
const isProtein = await evaluate(
  session,
  "document.getElementById('block-drugbox').hidden === true",
);

// 3. Every output must produce markup. All three sit together, with the upload
//    description below the two infoboxes.
const blocks = isProtein ? ["commons"] : ["drugbox", "chembox", "commons"];
for (const name of blocks) {
  const text = await evaluate(
    session,
    `document.getElementById('wikitext-${name}').textContent ?? ''`,
  );
  const length = typeof text === "string" ? text.length : 0;
  if (length < 40) failures.push(`${name} produced ${length} characters of markup`);
  const balanced = typeof text === "string" && countUnbalanced(text) === 0;
  if (!balanced) failures.push(`${name} markup has unbalanced braces`);
  console.log(`${name}: ${length} chars${balanced ? "" : ": UNBALANCED"}`);
}

if (!isProtein) {
  const order = JSON.parse(
    await evaluate(
      session,
      `JSON.stringify(['drugbox', 'chembox', 'commons'].map(
         (name) => document.getElementById('block-' + name).getBoundingClientRect().top,
       ))`,
    ),
  );
  if (!(order[0] < order[1] && order[1] < order[2])) {
    failures.push(`the output blocks are out of order: ${order.join(", ")}`);
  }
}

// Each box carries its copy action in its own top-right corner.
const copyButtons = await evaluate(
  session,
  "document.querySelectorAll('.code-box .copy-button').length",
);
if (copyButtons !== 3) failures.push(`there are ${copyButtons} copy buttons, not one per box`);

// The upload action sits under the Commons text, in flow, and never overlaps it.
const uploads = JSON.parse(
  await evaluate(
    session,
    `(() => {
       const box = (id) => {
         const node = document.getElementById(id);
         const rect = node.getBoundingClientRect();
         return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), shown: !node.hidden };
       };
       return JSON.stringify({ text: box('wikitext-commons'), link: box('upload-commons') });
     })()`,
  ),
);
console.log(`upload link: ${JSON.stringify(uploads)}`);
if (uploads.link.shown !== true) failures.push("the Commons upload link is hidden");
if (uploads.link.top < uploads.text.bottom - 1) {
  failures.push("the Commons upload link overlaps its text");
}

// 3a. Orientation: the custom fields appear, and a preset survives in storage.
const orientation = await evaluate(
  session,
  `(() => {
     const select = document.getElementById('orientation');
     select.value = 'custom';
     select.dispatchEvent(new Event('change', { bubbles: true }));
     const shown = !document.getElementById('orientation-custom').hidden;
     const input = document.getElementById('rotation-x');
     input.value = '30';
     input.dispatchEvent(new Event('change', { bubbles: true }));
     select.value = 'wiki';
     select.dispatchEvent(new Event('change', { bubbles: true }));
     const stored = JSON.parse(localStorage.getItem('wikimolgen2.orientation') ?? '{}');
     select.value = 'free';
     select.dispatchEvent(new Event('change', { bubbles: true }));
     return JSON.stringify({ shown, preset: stored.preset });
   })()`,
);
const orientationState = JSON.parse(orientation);
if (orientationState.shown !== true) failures.push("the custom orientation fields did not appear");
if (orientationState.preset !== "wiki") failures.push("the orientation preset did not save");
console.log(`orientation: ${orientation}`);

if (args["appearance-probe"]) {
  const before = await evaluate(
    session,
    "JSON.stringify({ radius: document.getElementById('stick-radius').value, stateRadius: window.__wikimolgen2?.state?.look?.appearance?.stick_radius, mode: window.__wikimolgen2?.state?.mode, viewer: Boolean(window.__wikimolgen2?.state?.viewer), compound: Boolean(window.__wikimolgen2?.state?.compound) })",
  );
  await evaluate(
    session,
    "(() => { const input = document.getElementById('stick-radius'); input.value = '0.4'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()",
  );
  await new Promise((done) => setTimeout(done, 600));
  const after = await evaluate(
    session,
    "JSON.stringify({ radius: document.getElementById('stick-radius').value, stateRadius: window.__wikimolgen2?.state?.look?.appearance?.stick_radius, label: document.getElementById('stick-radius-value').textContent, status: document.getElementById('export-status').textContent })",
  );
  console.log(`appearance probe: before ${before} after ${after}`);
  const probeShot = await send("Page.captureScreenshot", { format: "png" }, session);
  await writeFile(join(dirname(OUT), "appearance-probe.png"), Buffer.from(probeShot.result.data, "base64"));
}

// 3a2. A settings preset sets its values; a manual edit flips it to Custom.
const settingsPreset = await evaluate(
  session,
  `(() => {
     const select = document.getElementById('settings-preset');
     select.value = 'wikipedia';
     select.dispatchEvent(new Event('change', { bubbles: true }));
     const stick = document.getElementById('stick-radius').value;
     const ambient = document.getElementById('ambient').value;
     const quality = document.getElementById('export-quality').value;
     const radius = document.getElementById('stick-radius');
     radius.value = '0.25';
     radius.dispatchEvent(new Event('input', { bubbles: true }));
     const after = select.value;
     document.getElementById('export-quality').value = '4';
     document.querySelector('#looks input:checked')?.dispatchEvent(new Event('change', { bubbles: true }));
     return JSON.stringify({ stick, ambient, quality, after });
   })()`,
);
const presetValues = JSON.parse(settingsPreset);
if (presetValues.stick !== "0.2") failures.push(`the preset stick radius is ${presetValues.stick}`);
if (presetValues.ambient !== "0.3") failures.push(`the preset ambient is ${presetValues.ambient}`);
if (presetValues.quality !== "2") failures.push(`the preset quality is ${presetValues.quality}`);
if (presetValues.after !== "custom") failures.push("a manual edit keeps the preset selected");
console.log(`settings preset: ${settingsPreset}`);

// 3a3. Save the current settings, then delete the saved entry.
const savedPreset = await evaluate(
  session,
  `(() => {
     const select = document.getElementById('settings-preset');
     document.getElementById('preset-save').click();
     const rowShown = !document.getElementById('preset-name-row').hidden;
     document.getElementById('preset-name').value = 'Test preset';
     document.getElementById('preset-name-save').click();
     const savedId = [...select.options].map((option) => option.value).find((value) => value.startsWith('saved-'));
     const stored = JSON.parse(localStorage.getItem('wikimolgen2.settings-presets') ?? '[]').length;
     document.getElementById('preset-rename').click();
     document.getElementById('preset-name').value = 'Renamed';
     document.getElementById('preset-name-save').click();
     const renamed = [...select.options].some((option) => option.textContent === 'Renamed');
     document.getElementById('preset-delete').click();
     const after = [...select.options].map((option) => option.value);
     return JSON.stringify({ rowShown, saved: savedId !== undefined, stored, renamed, deleted: !after.some((value) => value.startsWith('saved-')), state: select.value });
   })()`,
);
const savedValues = JSON.parse(savedPreset);
if (savedValues.rowShown !== true) failures.push("the preset name row does not open");
if (savedValues.saved !== true) failures.push("saving a preset adds no option");
if (savedValues.stored !== 1) failures.push(`the saved preset store holds ${savedValues.stored}`);
if (savedValues.renamed !== true) failures.push("renaming a preset does not update the option");
if (savedValues.deleted !== true) failures.push("deleting a preset leaves the option");
if (savedValues.state !== "custom") failures.push("deleting a preset does not return to Custom");
console.log(`saved preset: ${savedPreset}`);

const resetFlow = await evaluate(
  session,
  `(() => {
     const input = document.getElementById('stick-radius');
     input.value = '0.45';
     input.dispatchEvent(new Event('input', { bubbles: true }));
     document.getElementById('appearance-reset-open').click();
     const asked = document.getElementById('appearance-reset-confirm').hidden === false;
     document.getElementById('appearance-reset-cancel').click();
     const cancelled = document.getElementById('appearance-reset-confirm').hidden === true && input.value === '0.45';
     document.getElementById('appearance-reset-open').click();
     document.getElementById('appearance-reset-yes').click();
     return JSON.stringify({ asked, cancelled, value: input.value, label: document.getElementById('stick-radius-value').textContent, note: document.getElementById('settings-preset-note').textContent, preset: document.getElementById('settings-preset').value });
   })()`,
);
const resetValues = JSON.parse(resetFlow);
if (resetValues.asked !== true) failures.push("the reset does not ask first");
if (resetValues.cancelled !== true) failures.push("cancelling the reset changes the slider");
if (Number(resetValues.value) > 0.21) failures.push(`the reset leaves stick radius ${resetValues.value}`);
if (resetValues.label.trim() !== "0.20") failures.push(`the reset label reads ${resetValues.label}`);
if (resetValues.preset !== "custom") failures.push("the reset does not mark the preset custom");
console.log(`reset flow: ${resetFlow}`);

// 3b. The 2D view. The first open loads RDKit (7.39 MB) and draws an inline SVG. A
//     protein has no flat record, so the mode button is disabled and there is nothing to
//     check.
if (isProtein) {
  console.log("2d: skipped (a protein has no flat record)");
} else {
  await evaluate(session, "document.getElementById('mode-2d').click(), true");
  const svgSize = await poll(async () => {
    const size = await evaluate(
      session,
      "document.querySelector('#depiction svg')?.outerHTML.length ?? 0",
    );
    return typeof size === "number" && size > 500 ? size : null;
  }, 60_000);
  if (svgSize === null) failures.push("the 2D view did not render an SVG");
  else console.log(`2d: ${svgSize} chars`);
  // The toolbar button follows the stage: a vector drawing downloads as an SVG.
  const svgLabel = await evaluate(session, "document.getElementById('export').textContent");
  if (svgLabel.trim() !== "Download SVG") {
    failures.push(`the 2D toolbar offers "${svgLabel.trim()}"`);
  }
  // The 2D engine bakes the scheme inks in, so the drawing must use the carbon ink.
  const carbonInk = await evaluate(
    session,
    "document.querySelector('#element-colors input[aria-label=\"C colour\"]')?.value ?? ''",
  );
  const svgText = await evaluate(
    session,
    "document.querySelector('#depiction svg')?.outerHTML ?? ''",
  );
  if (carbonInk !== "" && !svgText.toLowerCase().includes(carbonInk.toLowerCase())) {
    failures.push(`the 2D drawing does not use the carbon ink ${carbonInk}`);
  }
  // The colour panel styles the 3D figure; in 2D it must step aside with a note.
  const colourHidden = await evaluate(
    session,
    "document.getElementById('colour-controls').hidden === true && document.getElementById('colour-note').hidden === false",
  );
  if (colourHidden !== true) failures.push("the 3D colour controls stay visible in the 2D mode");
  const sectionsHidden = await evaluate(
    session,
    "document.getElementById('section-appearance').hidden === true && document.getElementById('section-view').hidden === true",
  );
  if (sectionsHidden !== true) failures.push("the 3D-only sections stay visible in the 2D mode");
  await evaluate(session, "document.getElementById('mode-3d').click(), true");
  await new Promise((done) => setTimeout(done, 300));
  const colourShown = await evaluate(
    session,
    "document.getElementById('colour-controls').hidden === false",
  );
  if (colourShown !== true) failures.push("the colour controls do not return in the 3D mode");
  const sectionsShown = await evaluate(
    session,
    "document.getElementById('section-appearance').hidden === false && document.getElementById('section-view').hidden === false",
  );
  if (sectionsShown !== true) failures.push("the 3D-only sections do not return in 3D");
  const pngLabel = await evaluate(session, "document.getElementById('export').textContent");
  if (pngLabel.trim() !== "Download PNG") {
    failures.push(`the 3D toolbar offers "${pngLabel.trim()}"`);
  }
}

// 3c. The colour surface. Every palette and every mode has to reach the renderer and come
//     back without an error, which is what proves the command strings parse: an unknown
//     setting or a malformed ink would land in the export status line.

// The panel must show the wikimolgen preset on a fresh load: CPK inks and grey sticks.
const preset = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify({
       palette: document.getElementById('color-scheme').value,
       stickMode: document.getElementById('stick-color-mode').value,
       stickRadius: document.getElementById('stick-radius').value,
       sphereScale: document.getElementById('sphere-scale').value,
       chips: Array.from(document.querySelectorAll('#element-colors span')).map((span) => span.textContent),
     })`,
  ),
);
console.log(
  `preset: ${preset.palette}, sticks ${preset.stickMode}, radius ${preset.stickRadius}, sphere ${preset.sphereScale}, chips ${preset.chips.join(" ")}`,
);
if (preset.palette !== "cpk") failures.push(`a fresh load uses the ${preset.palette} palette, not cpk`);
if (preset.stickMode !== "single") failures.push(`a fresh load colours sticks ${preset.stickMode}`);
if (preset.stickRadius !== "0.2" || preset.sphereScale !== "0.3") {
  failures.push(`a fresh load uses radius ${preset.stickRadius} and sphere ${preset.sphereScale}`);
}
// A protein has no element formula, so it lists no chips and hides the element palette.
if (isProtein) {
  if (preset.chips.length !== 0) failures.push(`a protein lists chips ${preset.chips.join(",")}`);
} else if (preset.chips.join(",") !== "C,O") {
  failures.push(`the chips list ${preset.chips.join(",")}`);
}

const palettes = await evaluate(
  session,
  "Array.from(document.getElementById('color-scheme').options).map((option) => option.value)",
);
const modes = await evaluate(
  session,
  "Array.from(document.getElementById('color-mode').options).map((option) => option.value)",
);
console.log(`palettes: ${Array.isArray(palettes) ? palettes.join(", ") : palettes}`);
if (!Array.isArray(palettes) || palettes.length < 6) {
  failures.push(`the palette picker lists ${palettes?.length ?? 0} schemes`);
}
if (!Array.isArray(modes) || modes.length < 7) {
  failures.push(`the colour mode picker lists ${modes?.length ?? 0} modes`);
}

/** Change one select or colour input, let the page recolour, then report the status. */
async function recolour(id, value, event = "change") {
  await evaluate(
    session,
    `(() => {
       const node = document.getElementById('${id}');
       node.value = ${JSON.stringify(value)};
       node.dispatchEvent(new Event('${event}'));
       return true;
     })()`,
  );
  await new Promise((done) => setTimeout(done, 250));
  return evaluate(session, "document.getElementById('export-status').textContent ?? ''");
}

for (const id of Array.isArray(palettes) ? palettes : []) {
  const status = await recolour("color-scheme", id);
  if (/Could not recolour/.test(status)) failures.push(`palette ${id} failed: ${status}`);
}

// The chips are labelled with the scheme's inks, so a palette change must move them.
const cpkChips = await evaluate(
  session,
  `(() => {
     const node = document.getElementById('color-scheme');
     node.value = 'cpk';
     node.dispatchEvent(new Event('change'));
     return Array.from(document.querySelectorAll('#element-colors input')).map((input) => input.value).join(',');
   })()`,
);
if (!isProtein && cpkChips !== "#595959,#ff0000") {
  failures.push(`the CPK chips read ${cpkChips}, not the scheme's carbon and oxygen`);
}

for (const mode of Array.isArray(modes) ? modes : []) {
  const status = await recolour("color-mode", mode);
  if (/Could not recolour/.test(status)) failures.push(`colour mode ${mode} failed: ${status}`);
}

// The secondary-structure inks appear with that mode and carry the wikimolgen defaults.
await recolour("color-mode", "sec_struct");
const ssInks = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify({
       hidden: document.getElementById('secstruct-color-control').hidden,
       helix: document.getElementById('helix-color').value,
       sheet: document.getElementById('sheet-color').value,
       loop: document.getElementById('loop-color').value,
     })`,
  ),
);
console.log(`ss inks: helix ${ssInks.helix}, sheet ${ssInks.sheet}, loop ${ssInks.loop}`);
if (ssInks.hidden) failures.push("the secondary-structure inks stay hidden in that mode");
if (ssInks.helix !== "#3399ff" || ssInks.sheet !== "#ffcc00" || ssInks.loop !== "#99aabb") {
  failures.push(`the secondary-structure inks are ${ssInks.helix}/${ssInks.sheet}/${ssInks.loop}`);
}
const ssEdit = await recolour("helix-color", "#2f6fbf", "input");
if (/Could not recolour/.test(ssEdit)) failures.push(`a helix ink change failed: ${ssEdit}`);

// The single ink shows in the uniform mode only.
await recolour("color-mode", "uniform");
if (!(await evaluate(session, "!document.getElementById('solid-color-control').hidden"))) {
  failures.push("the single ink stays hidden in the uniform mode");
}

for (const stickMode of ["single", "follow"]) {
  const status = await recolour("stick-color-mode", stickMode);
  if (/Could not recolour/.test(status)) failures.push(`stick mode ${stickMode} failed: ${status}`);
}

// A look carries its own palette and stick ink, so switching one must move the controls.
// A radio that is already checked fires no change event, so nudge to another look first.
// The page re-renders the radios on every choice, so the node is looked up again after it.
async function chooseLook(index) {
  await evaluate(
    session,
    `(() => {
       const inputs = () => document.querySelectorAll('#looks input');
       if (inputs()[${index}].checked) {
         inputs()[${index} === 0 ? inputs().length - 1 : 0].click();
       }
       inputs()[${index}].click();
       return true;
     })()`,
  );
  await new Promise((done) => setTimeout(done, 600));
  return JSON.parse(
    await evaluate(
      session,
      `JSON.stringify({
         palette: document.getElementById('color-scheme').value,
         sticks: document.getElementById('stick-color-mode').value,
         colour: document.getElementById('color-mode').value,
         status: document.getElementById('export-status').textContent ?? '',
       })`,
    ),
  );
}

// A protein offers two cartoon looks, not the small-molecule finishes.
const lookCount = await evaluate(session, "document.querySelectorAll('#looks input').length");
if (!isProtein && lookCount >= 3) {
  const darkLook = await chooseLook(2);
  console.log(`dark look: palette ${darkLook.palette}, sticks ${darkLook.sticks}`);
  if (darkLook.palette !== "dark") failures.push(`the dark look selects the ${darkLook.palette} palette`);
  if (darkLook.sticks !== "follow") failures.push(`the dark look colours sticks ${darkLook.sticks}`);
  if (/Could not/.test(darkLook.status)) failures.push(`the dark look failed: ${darkLook.status}`);

  const flatLook = await chooseLook(1);
  console.log(`flat look: palette ${flatLook.palette}, sticks ${flatLook.sticks}`);
  if (flatLook.palette !== "cpk") failures.push(`the flat look selects the ${flatLook.palette} palette`);
} else {
  console.log(`looks: ${lookCount}, look switching skipped`);
}

// Back to the first look last, so a protein keeps its secondary-structure colouring and
// the screenshot shows the preset figure.
await recolour("color-mode", "element");
await recolour("color-scheme", "cpk");
await recolour("stick-color-mode", "single");
const firstLook = await chooseLook(0);
console.log(`first look: colour by ${firstLook.colour}, palette ${firstLook.palette}`);
if (isProtein && firstLook.colour !== "sec_struct") {
  failures.push(`the cartoon look colours by ${firstLook.colour}, not secondary structure`);
}
if (!isProtein && firstLook.colour !== "element") {
  failures.push(`the publication look colours by ${firstLook.colour}, not element`);
}

// Both the single export and the batch write here, so the directory is set up first.
const downloadDir = join(process.env.TEMP ?? "/tmp", `wikimolgen2-download-${Date.now()}`);
await mkdir(downloadDir, { recursive: true });
await send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: downloadDir,
  eventsEnabled: true,
});

exportStep: {
if (smoke) break exportStep;

// 4. Export a PNG through the app's own path; the downloaded file is the product.
const completion = new Promise((resolve) => {
  downloadFinished = resolve;
});

await evaluate(session, `(() => {
  const width = document.getElementById('export-width');
  width.value = ${JSON.stringify(String(args["export-width"] ?? "1200"))};
  width.dispatchEvent(new Event('change'));
  document.getElementById('export').click();
  return true;
})()`);

// The app writes "Saved ..." after the PNG is composed, so that line is the completion
// signal. The browser's download event is the fast path; it can lag or go missing in an
// offscreen window, which made the check flaky.
const saved = await poll(async () => {
  const text = await evaluate(
    session,
    "document.getElementById('export-status').textContent ?? ''",
  );
  return typeof text === "string" && text.startsWith("Saved ") ? text : null;
}, 90_000);

let download = await Promise.race([
  completion,
  new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
]);

// The completion event is not guaranteed; the file in the directory is the same artefact.
if (download === null || download.state !== "completed" || !download.filePath) {
  // The browser writes the file a moment after the app says Saved, so wait for it.
  const finished = await poll(async () => newestPng(downloadDir), 5000);
  if (finished !== null) {
    download = { state: "completed", filePath: finished };
    console.log(`  no download event; using ${finished}`);
  }
}

console.log(`export status: ${await evaluate(session, "document.getElementById('export-status').textContent")}`);

if (saved === null) failures.push(`export did not finish; the status line says nothing`);
else if (download === null || download.state !== "completed" || !download.filePath) {
  failures.push("the export says Saved but no PNG is in the download directory");
} else {
  const bytes = await readFile(download.filePath);
  // Keep the artefact next to the screenshot: the browser's download directory is
  // temporary, and this is the file a human wants to look at.
  const exportedCopy = join(dirname(OUT), `export-${Date.now()}.png`);
  await writeFile(exportedCopy, bytes);

  const signature = bytes.subarray(0, 8).toString("hex");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const isPng = signature === "89504e470d0a1a0a";
  console.log(`export: ${isPng ? "PNG" : "NOT PNG"}, ${width}x${height} -> ${exportedCopy}`);
  if (!isPng) failures.push("exported file is not a PNG");
  // The figure is cropped to the molecule and padded, so the width is content-driven;
  // what must hold is that it is a real image and that its border is clean: white or
  // transparent.
  if (width < 400 || height < 400) failures.push(`exported image is only ${width}x${height}`);

  const painted = await samplePng(bytes);
  console.log(
    `export pixels: ${painted.differing}/${painted.samples} samples differ from the background; corner rgba(${painted.corner.join(",")})`,
  );
  if (painted.differing < 5) failures.push("exported image looks blank");
  const [red, green, blue, alpha] = painted.corner;
  if (alpha !== 0 && [red, green, blue].some((channel) => channel < 250)) {
    failures.push(`exported image has a non-white border: rgba(${painted.corner.join(",")})`);
  }
}

/**
 * Decode the exported PNG in the browser and count pixels that differ from the corner
 * colour. Node has no image decoder here, and the browser already has one.
 */
async function samplePng(bytes) {
  const base64 = Buffer.from(bytes).toString("base64");
  const result = await evaluate(
    session,
    `(async () => {
       const image = new Image();
       image.src = 'data:image/png;base64,${base64}';
       await image.decode();
       const canvas = document.createElement('canvas');
       canvas.width = image.naturalWidth;
       canvas.height = image.naturalHeight;
       const context = canvas.getContext('2d');
       context.drawImage(image, 0, 0);
       const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
       const [r, g, b, a] = [data[0], data[1], data[2], data[3]];
       let differing = 0;
       let samples = 0;
       for (let i = 0; i < data.length; i += 4 * 53) {
         samples += 1;
         if (
           Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) +
           Math.abs(data[i + 2] - b) + Math.abs(data[i + 3] - a) > 24
         ) {
           differing += 1;
         }
       }
       return JSON.stringify({ differing, samples, corner: [r, g, b, a] });
     })()`,
  );
  return JSON.parse(result);
}
} // exportStep

// `--open appearance` expands a folded section before the screenshot, so the panel's
// inner groups can be shown without clicking through the page.
if (args.open) {
  await evaluate(
    session,
    `(() => {
       for (const name of ${JSON.stringify(String(args.open).split(","))}) {
         document.getElementById('section-' + name.trim())?.setAttribute('open', '');
       }
       return true;
     })()`,
  );
  await new Promise((done) => setTimeout(done, 200));
}

// 4b. A typed selection refits the camera; re-frame then restores the full view.
const zoomSelection = isProtein ? "resi 1" : "elem C";
await evaluate(
  session,
  `(() => {
     const input = document.getElementById('zoom-selection');
     input.value = ${JSON.stringify(zoomSelection)};
     input.dispatchEvent(new Event('input', { bubbles: true }));
     document.getElementById('zoom-selection-go').click();
     return true;
   })()`,
);
const zoomed = await poll(async () => {
  const text = await evaluate(session, "document.getElementById('export-status').textContent ?? ''");
  return text.startsWith("Zoomed to") ? text : null;
}, 15_000);
if (zoomed === null) failures.push("zoom to a selection did not run");
else console.log(`zoom selection: ${zoomed.slice(0, 60)}`);
await evaluate(session, "document.getElementById('frame').click(), true");
await new Promise((done) => setTimeout(done, 400));

// `--suggest aspirin` opens the dropdown so the screenshot shows the combobox.
if (args.suggest) {
  await evaluate(
    session,
    `(() => {
       const input = document.getElementById('identifier');
       input.focus();
       input.dispatchEvent(new FocusEvent('focus'));
       input.value = ${JSON.stringify(String(args.suggest))};
       input.dispatchEvent(new Event('input', { bubbles: true }));
       return true;
     })()`,
  );
  await new Promise((done) => setTimeout(done, 1500));
}

// `--click-canvas true` clicks the figure, which is what focuses the canvas.
if (args["click-canvas"]) {
  await clickAt("#viewer canvas");
  await new Promise((done) => setTimeout(done, 300));
}

// `--preset-name true` opens the preset name field so the screenshot shows it.
if (args["preset-name"]) {
  await evaluate(session, "document.getElementById('preset-save').click(), true");
  await new Promise((done) => setTimeout(done, 200));
}

// `--dialog` opens the batch dialog so the screenshot shows its layout.
if (args.dialog) {
  await evaluate(
    session,
    `(() => {
       document.getElementById('batch-open').click();
       const input = document.getElementById('batch-input');
       input.value = 'aspirin\\nibuprofen';
       input.dispatchEvent(new Event('input', { bubbles: true }));
       return true;
     })()`,
  );
  await new Promise((done) => setTimeout(done, 300));
}

// `--2d` switches the stage to the drawing before the screenshot.
if (args["2d"]) {
  await evaluate(session, "document.getElementById('mode-2d').click(), true");
  await poll(
    async () =>
      ((await evaluate(session, "document.querySelector('#depiction svg')?.outerHTML.length ?? 0")) ?? 0) > 500
        ? true
        : null,
    60_000,
  );
  await new Promise((done) => setTimeout(done, 300));
}

// `--orientation wiki` applies a preset so the screenshot shows the house tilt.
if (args.orientation) {
  await evaluate(
    session,
    `(() => {
       const select = document.getElementById('orientation');
       select.value = ${JSON.stringify(String(args.orientation))};
       select.dispatchEvent(new Event('change', { bubbles: true }));
       return true;
     })()`,
  );
  await new Promise((done) => setTimeout(done, 600));
}

// `--zoom 12` clicks zoom-in that many times, so a screenshot can show a deep view.
if (args.zoom) {
  const notches = Number(args.zoom);
  for (let index = 0; index < notches; index += 1) {
    await evaluate(session, "document.getElementById('zoom-in').click(), true");
    await new Promise((done) => setTimeout(done, 60));
  }
  await new Promise((done) => setTimeout(done, 300));
}

// 5. Screenshot for a human to look at. `--scroll <id>` brings one control into view and
//    `--scroll-offset <px>` shifts the panel after that, which is how the colour section
//    is captured with its heading instead of mid-field.
if (args.scroll) {
  const offset = Number(args["scroll-offset"] ?? 0);
  await evaluate(
    session,
    `(() => {
       document.getElementById('${args.scroll}')?.scrollIntoView({ block: 'start' });
       const panel = document.querySelector('.controls');
       if (panel !== null) panel.scrollTop += ${Number.isFinite(offset) ? offset : 0};
       return true;
     })()`,
  );
  await new Promise((done) => setTimeout(done, 200));
}
// `--hunt true` runs the bug-hunt probes after the functional checks.
if (!smoke && args.hunt) {
  const beforeLook = await evaluate(
    session,
    "(() => { const dark = [...document.querySelectorAll('#looks input')].find((input) => input.value === 'dark'); if (dark !== undefined) dark.click(); return window.__wikimolgen2?.state?.look?.id ?? null; })()",
  );
  await evaluate(
    session,
    "(() => { const field = document.getElementById('identifier'); field.value = 'Ibuprofen'; document.getElementById('lookup').requestSubmit(); return true; })()",
  );
  const loaded = await poll(
    async () => {
      const status = await evaluate(session, "document.getElementById('export-status').textContent");
      return status.includes("Loaded Ibuprofen") ? status : null;
    },
    60_000,
  );
  const after = await evaluate(
    session,
    "JSON.stringify({ look: window.__wikimolgen2?.state?.look?.id ?? null, name: window.__wikimolgen2?.state?.compound?.name ?? null, status: document.getElementById('export-status').textContent })",
  );
  const pug = await evaluate(
    session,
    "JSON.stringify(performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/rest/pug/')).map((entry) => [entry.name.replace(/^.*\\/rest\\/pug\\//, ''), Math.round(entry.duration)]))",
  );
  console.log(`hunt: look before ${beforeLook}, load ${loaded}, after ${after}`);
  console.log(`hunt: pubchem ${pug}`);

  // A slow Aspirin lookup must not overwrite a newer Ibuprofen load.
  await evaluate(
    session,
    `(() => {
       const original = window.fetch;
       window.fetch = (input, init) => {
         const url = String(input);
         if (url.includes('compound/smiles/Aspirin') || url.includes('compound/name/Aspirin')) {
           return new Promise((resolve, reject) => {
             setTimeout(() => original(input, init).then(resolve, reject), 4000);
           });
         }
         return original(input, init);
       };
       return true;
     })()`,
  );
  await evaluate(
    session,
    "(() => { const field = document.getElementById('identifier'); field.value = 'Aspirin'; document.getElementById('lookup').requestSubmit(); return true; })()",
  );
  await new Promise((done) => setTimeout(done, 150));
  await evaluate(
    session,
    "(() => { const field = document.getElementById('identifier'); field.value = 'Ibuprofen'; document.getElementById('lookup').requestSubmit(); return true; })()",
  );
  await new Promise((done) => setTimeout(done, 9000));
  const race = await evaluate(
    session,
    "JSON.stringify({ name: window.__wikimolgen2?.state?.compound?.name ?? null, status: document.getElementById('export-status').textContent })",
  );
  console.log(`hunt race: ${race}`);
}
// `--protein true` loads 1CRN and checks the Wikipedia rainbow is the default look.
if (args.protein) {
  await evaluate(
    session,
    "(() => { const field = document.getElementById('identifier'); field.value = '1CRN'; document.getElementById('lookup').requestSubmit(); return true; })()",
  );
  const proteinLoaded = await poll(
    async () => {
      const status = await evaluate(session, "document.getElementById('export-status').textContent");
      return status.includes("Loaded 1CRN") ? status : null;
    },
    120_000,
  );
  if (proteinLoaded === null) failures.push("the protein did not load");
  const proteinState = await evaluate(
    session,
    "JSON.stringify({ look: document.querySelector('#looks input:checked')?.value ?? null, mode: document.getElementById('color-mode').value, status: document.getElementById('export-status').textContent })",
  );
  const proteinValues = JSON.parse(proteinState);
  if (proteinValues.look !== "rainbow") failures.push(`the protein starts on ${proteinValues.look}, not the rainbow look`);
  if (proteinValues.mode !== "rainbow") failures.push(`the colour select reads ${proteinValues.mode}`);
  console.log(`protein: ${proteinState}`);
  if (args.trans) {
    const transLook = await evaluate(
      session,
      "(() => { const radio = [...document.querySelectorAll('#looks input')].find((input) => input.value === 'trans'); if (radio === undefined) return null; radio.click(); return true; })()",
    );
    await new Promise((done) => setTimeout(done, 800));
    const transState = await evaluate(
      session,
      "JSON.stringify({ look: document.querySelector('#looks input:checked')?.value ?? null, helix: document.getElementById('helix-color').value.toLowerCase(), sheet: document.getElementById('sheet-color').value.toLowerCase(), loop: document.getElementById('loop-color').value.toLowerCase(), outlines: document.getElementById('silhouettes').checked, status: document.getElementById('export-status').textContent })",
    );
    console.log(`trans: ${transState}`);
    const transValues = JSON.parse(transState);
    if (transLook !== true) failures.push("the trans look radio is missing");
    if (transValues.look !== "trans") failures.push("the trans look did not select");
    if (transValues.helix !== "#5bcefa") failures.push(`the trans helix reads ${transValues.helix}`);
    if (transValues.sheet !== "#f5a9b8") failures.push(`the trans sheet reads ${transValues.sheet}`);
    if (transValues.loop !== "#ffffff") failures.push(`the trans loop reads ${transValues.loop}`);
    if (transValues.outlines !== true) failures.push("the trans look has no outline");
  }
}
// `--reset-confirm true` opens the slider reset question so the screenshot shows it.
if (args["reset-confirm"]) {
  await evaluate(session, "document.getElementById('appearance-reset-open').click(), true");
  await evaluate(session, "document.getElementById('appearance-reset-confirm').scrollIntoView({ block: 'center' }), true");
  await new Promise((done) => setTimeout(done, 200));
}
const shot = await send("Page.captureScreenshot", { format: "png" }, session);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log(`screenshot: ${OUT}`);

// A 2D screenshot leaves the canvas hidden; the full-screen check needs the 3D stage.
if (args["2d"]) {
  await evaluate(session, "document.getElementById('mode-3d').click(), true");
  await new Promise((done) => setTimeout(done, 600));
}

platformStep: {
if (smoke) break platformStep;

// 6. Full screen: the stage fills the screen, its toolbar stays, and the canvas follows.
//    A programmatic click does not count as a user gesture, so the press goes through
//    the input domain as a real mouse event.
async function clickAt(selector) {
  const box = JSON.parse(
    await evaluate(
      session,
      `(() => {
         const node = document.querySelector(${JSON.stringify(selector)});
         if (node === null) return JSON.stringify(null);
         const rect = node.getBoundingClientRect();
         return JSON.stringify({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
       })()`,
    ),
  );
  if (box === null) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send(
      "Input.dispatchMouseEvent",
      { type, x: box.x, y: box.y, button: "left", clickCount: 1 },
      session,
    );
  }
  return true;
}

const fullscreenButton = await evaluate(
  session,
  "document.getElementById('fullscreen').hidden === false",
);
if (fullscreenButton !== true) {
  failures.push("the full-screen button is hidden");
} else {
  // Fullscreen needs an active tab; the test window is offscreen, so activate it here.
  await send("Page.bringToFront", {}, session);
  await new Promise((done) => setTimeout(done, 300));
  await evaluate(
    session,
    `(() => {
       window.__fsClicks = 0;
       document.getElementById('fullscreen').addEventListener('click', () => {
         window.__fsClicks += 1;
       });
       return true;
     })()`,
  );
  if (!(await clickAt("#fullscreen"))) failures.push("the full-screen button cannot be clicked");
  await new Promise((done) => setTimeout(done, 800));
  let probe = JSON.parse(
    await evaluate(
      session,
      `JSON.stringify({
         clicks: window.__fsClicks ?? -1,
         enabled: document.fullscreenEnabled,
         active: document.fullscreenElement !== null,
         hasFocus: document.hasFocus(),
       })`,
    ),
  );
  console.log(`full screen probe: ${JSON.stringify(probe)}`);
  if (probe.active !== true) {
    // A synthetic mouse click does not always carry the activation fullscreen needs.
    // A key press on the focused button is the other native path.
    await evaluate(session, "(document.getElementById('fullscreen').focus(), true)");
    for (const type of ["keyDown", "keyUp"]) {
      await send(
        "Input.dispatchKeyEvent",
        { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 },
        session,
      );
    }
    await new Promise((done) => setTimeout(done, 800));
    probe = JSON.parse(
      await evaluate(
        session,
        `JSON.stringify({ active: document.fullscreenElement !== null })`,
      ),
    );
    console.log(`full screen after Enter: ${JSON.stringify(probe)}`);
  }
  const full = JSON.parse(
    await evaluate(
      session,
      `JSON.stringify({
         active: document.fullscreenElement !== null,
         stage: document.fullscreenElement?.classList.contains('stage') ?? false,
         width: Math.round(document.fullscreenElement?.getBoundingClientRect().width ?? 0),
         height: Math.round(document.fullscreenElement?.getBoundingClientRect().height ?? 0),
         viewport: [window.innerWidth, window.innerHeight],
         canvas: Math.round(document.querySelector('#viewer canvas')?.getBoundingClientRect().width ?? 0),
         label: document.getElementById('fullscreen').textContent,
       })`,
    ),
  );

  // Chrome sometimes refuses fullscreen for a synthetic gesture in an offscreen window.
  // The click is delivered either way, so a refusal is an environment limit, not a defect.
  if (!full.active) {
    console.log(`full screen: refused by this automation window; layout checks skipped (button "${full.label}")`);
  } else {
    console.log(
      `full screen: ${full.width}x${full.height} of ${full.viewport.join("x")}, canvas ${full.canvas}, button "${full.label}"`,
    );
    if (!full.stage) failures.push("full screen did not take over the stage");
    if (Math.abs(full.width - full.viewport[0]) > 2 || Math.abs(full.height - full.viewport[1]) > 2) {
      failures.push(`the full-screen stage is ${full.width}x${full.height}, not the viewport`);
    }
    if (full.canvas < full.viewport[0] - 30) {
      failures.push(`the canvas is ${full.canvas} wide in full screen`);
    }
    if (full.label !== "Exit full screen") failures.push(`the full-screen button reads "${full.label}"`);

    // Keep the full-screen frame beside the screenshot; it is the evidence for the mode.
    const fullShot = await send("Page.captureScreenshot", { format: "png" }, session);
    await writeFile(join(dirname(OUT), "fullscreen.png"), Buffer.from(fullShot.result.data, "base64"));

    await clickAt("#fullscreen");
    await new Promise((done) => setTimeout(done, 600));
    const exited = await evaluate(session, "document.fullscreenElement === null");
    if (exited !== true) failures.push("the figure did not leave full screen");
  }
}

// 6b. Batch export: two identifiers, two rows, one ZIP with two figures.
const batchItems = isProtein ? "1CRN\n1UBQ" : "aspirin\nibuprofen";
await evaluate(session, "document.getElementById('export-quality').value = '2', true");
await evaluate(session, "document.getElementById('batch-open').click(), true");
if ((await evaluate(session, "document.getElementById('batch').open")) !== true) {
  failures.push("the batch dialog did not open");
}
await evaluate(
  session,
  `(() => {
     const input = document.getElementById('batch-input');
     input.value = ${JSON.stringify(batchItems)};
     input.dispatchEvent(new Event('input', { bubbles: true }));
     document.getElementById('batch-run').click();
     return true;
   })()`,
);
const rows = await poll(async () => {
  const states = JSON.parse(
    await evaluate(
      session,
      "JSON.stringify([...document.querySelectorAll('#batch-list .batch-row')].map((row) => row.dataset.state))",
    ),
  );
  if (states.length !== 2) return null;
  return states.every((state) => state === "done" || state === "failed") ? states : null;
}, 120_000);
if (rows === null) {
  const states = await evaluate(
    session,
    `JSON.stringify({
       rows: [...document.querySelectorAll('#batch-list .batch-row')].map((row) => {
         return { state: row.dataset.state, text: row.querySelector('.batch-state')?.textContent };
       }),
       status: document.getElementById('export-status')?.textContent,
       input: document.getElementById('batch-input')?.value,
       open: document.getElementById('batch')?.open,
     })`,
  );
  failures.push(`the batch did not finish; ${states}`);
} else console.log(`batch rows: ${JSON.stringify(rows)}`);
const batchDetail = await evaluate(
  session,
  "JSON.stringify([...document.querySelectorAll('#batch-list .batch-row')].map((row) => ({ state: row.dataset.state, text: row.querySelector('.batch-state')?.textContent })))",
);
console.log(`batch detail: ${batchDetail}`);

const zipPath = await poll(async () => newestZip(downloadDir), 10_000);
if (zipPath === null) failures.push("the batch ZIP did not download");
else {
  const zipBytes = await readFile(zipPath);
  await writeFile(join(dirname(OUT), `batch-${Date.now()}.zip`), zipBytes);
  const names = zipEntries(zipBytes);
  console.log(`batch zip: ${names.join(", ")}`);
  if (names.length !== 2) failures.push(`the batch ZIP holds ${names.length} figures, not 2`);
  if (!names.every((name) => name.endsWith(".png"))) failures.push("a batch entry is not a PNG");
}
await evaluate(session, "document.getElementById('batch-close').click(), true");
await evaluate(session, "document.getElementById('export-quality').value = '4', true");
} // platformStep

// 7. A folded section is remembered, which is the only state the page keeps besides the
//    theme. Opening one and reloading must bring it back open. The write happens in the
//    element's toggle event, so wait for the store rather than for the clock.
await evaluate(session, "(document.getElementById('section-appearance').open = true, true)");
await poll(
  async () => {
    const stored = await evaluate(session, "localStorage.getItem('wikimolgen2.sections') ?? ''");
    return stored.includes('"section-appearance":true') ? true : null;
  },
  10_000,
);
await send("Page.reload", {}, session);
const reloaded = await poll(
  async () => (await evaluate(session, "document.documentElement.dataset.ready === '1'")) ? true : null,
  60_000,
);
if (reloaded !== true) {
  failures.push("the page did not come back after a reload");
} else {
  const remembered = await evaluate(session, "document.getElementById('section-appearance').open");
  console.log(`sections after reload: appearance ${remembered}`);
  if (remembered !== true) failures.push("an opened section is not remembered across a reload");
}

deepLinkStep: {
if (smoke) break deepLinkStep;

// 7. A lookup link loads itself, which is what makes a figure shareable.
await send("Page.navigate", { url: `${baseUrl}?q=aspirin` }, session);
const linked = await poll(async () => {
  const text = await evaluate(session, "document.getElementById('export-status').textContent ?? ''");
  return typeof text === "string" && text.includes("Loaded Aspirin") ? text : null;
}, 90_000);
if (linked === null) {
  const current = await evaluate(
    session,
    `JSON.stringify({
       status: document.getElementById('export-status')?.textContent ?? '',
       ready: document.documentElement.dataset.ready ?? '(none)',
       stage: document.getElementById('stage-text')?.textContent ?? '',
       busy: document.getElementById('stage-message')?.classList.contains('busy') ?? false,
       identifier: document.getElementById('identifier')?.value ?? '',
       url: location.href,
       requests: performance
         .getEntriesByType('resource')
         .filter((entry) => entry.name.includes('pubchem'))
         .map((entry) => entry.name.split('/').slice(-2).join('/') + ' ' + Math.round(entry.duration) + 'ms'),
     })`,
  );
  failures.push(`a ?q= link does not load its compound; ${current}`);
} else {
  console.log(`deep link: ${linked.slice(0, 80)}`);
}
} // deepLinkStep

// 8. The picker lists every built-in; a custom theme survives a reload and a confirmed delete.
await evaluate(session, "document.getElementById('theme-open').click(), true");
const picker = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify({
       open: document.getElementById('theme-dialog').open,
       cards: document.querySelectorAll('#theme-grid .theme-card').length,
       names: [...document.querySelectorAll('#theme-grid .theme-card-name')].map((node) => node.textContent),
     })`,
  ),
);
console.log(`theme picker: ${picker.names.join(", ")}`);
if (picker.open !== true) failures.push("the theme dialog does not open");
if (picker.cards !== 7) failures.push(`the theme picker lists ${picker.cards} built-ins, not 7`);
for (const name of ["System", "Light", "Paper", "Contrast", "Dark", "Slate", "Midnight"]) {
  if (!picker.names.includes(name)) failures.push(`the theme picker misses ${name}`);
}
await evaluate(
  session,
  `(() => {
     document.querySelector('input[name="theme-choice"][value="paper"]').click();
     return true;
   })()`,
);
const paper = await poll(async () => {
  const theme = await evaluate(session, "document.documentElement.dataset.theme");
  if (theme !== "paper") return null;
  const surface = await evaluate(
    session,
    "getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()",
  );
  return { theme, surface };
}, 5_000);
if (paper === null) failures.push("selecting Paper does not change the theme");
else if (paper.surface !== "#fbf7ef") failures.push(`Paper paints its surface as ${paper.surface}`);

await evaluate(session, "document.getElementById('theme-new').click(), true");
await evaluate(
  session,
  `(() => {
     const select = document.getElementById('theme-base');
     select.value = 'dark';
     select.dispatchEvent(new Event('change', { bubbles: true }));
     return true;
   })()`,
);
const baseCopy = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify({
       accent: document.getElementById('theme-accent').value,
       panel: document.getElementById('theme-panel').value,
       scheme: document.documentElement.dataset.scheme,
     })`,
  ),
);
if (baseCopy.accent !== "#4cc9bd" || baseCopy.panel !== "#131a22" || baseCopy.scheme !== "dark") {
  failures.push(`copying the Dark colours gives ${JSON.stringify(baseCopy)}`);
}
await evaluate(
  session,
  `(() => {
     const set = (id, value) => {
       const node = document.getElementById(id);
       node.value = value;
       node.dispatchEvent(new Event('input', { bubbles: true }));
     };
     document.getElementById('theme-custom-name').value = 'Verify custom';
     set('theme-accent', '#ffb454');
     set('theme-panel', '#171310');
     set('theme-page', '#0b0908');
     set('theme-text', '#f5e9da');
     set('theme-stage', '#120f0c');
     return true;
   })()`,
);
const editor = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify({
       shown: !document.getElementById('theme-editor').hidden,
       picker: document.getElementById('theme-picker-view').hidden,
       scheme: document.documentElement.dataset.scheme,
     })`,
  ),
);
if (editor.shown !== true) failures.push("the custom theme editor does not open");
if (editor.picker !== true) failures.push("the picker stays behind the custom theme editor");
if (editor.scheme !== "dark") failures.push(`a dark panel previews as ${editor.scheme}`);
await evaluate(session, "document.getElementById('theme-save').click(), true");
const custom = await poll(async () => {
  const state = JSON.parse(
    await evaluate(
      session,
      `JSON.stringify({
         choice: localStorage.getItem('wikimolgen2.theme'),
         count: JSON.parse(localStorage.getItem('wikimolgen2.custom-themes') ?? '[]').length,
         theme: document.documentElement.dataset.theme,
         accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
         label: document.getElementById('theme-name').textContent,
       })`,
    ),
  );
  return state.choice !== null && state.choice.startsWith("custom-") && state.count === 1
    ? state
    : null;
}, 5_000);
if (custom === null) failures.push("saving a custom theme does not store it");
else {
  console.log(`custom theme: ${custom.label}, ${custom.accent}`);
  if (custom.theme !== "custom") failures.push(`a custom theme sets data-theme to ${custom.theme}`);
  if (custom.accent !== "#ffb454") failures.push(`the custom accent reads ${custom.accent}`);
  if (custom.label !== "Verify custom") failures.push(`the top bar names the theme ${custom.label}`);
}

await send("Page.reload", {}, session);
await poll(async () => (await evaluate(session, "document.documentElement.dataset.ready === '1'")) ? true : null, 60_000);
const restored = JSON.parse(
  await evaluate(
    session,
    `JSON.stringify({
       theme: document.documentElement.dataset.theme,
       scheme: document.documentElement.dataset.scheme,
       accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
       label: document.getElementById('theme-name').textContent,
     })`,
  ),
);
console.log(`custom theme after reload: ${JSON.stringify(restored)}`);
if (restored.theme !== "custom") failures.push("a custom theme does not survive a reload");
if (restored.scheme !== "dark") failures.push(`the restored custom theme is ${restored.scheme}`);
if (restored.accent !== "#ffb454") failures.push(`the restored custom accent reads ${restored.accent}`);
if (restored.label !== "Verify custom") failures.push(`the restored theme is named ${restored.label}`);

await evaluate(session, "document.getElementById('theme-open').click(), true");
const armed = JSON.parse(
  await evaluate(
    session,
    `(() => {
       document.getElementById('theme-delete').click();
       return JSON.stringify({
         text: document.getElementById('theme-delete').textContent,
         count: JSON.parse(localStorage.getItem('wikimolgen2.custom-themes') ?? '[]').length,
       });
     })()`,
  ),
);
if (armed.text !== "Confirm delete" || armed.count !== 1) {
  failures.push(`the first delete click does not confirm: ${JSON.stringify(armed)}`);
}
await evaluate(session, "document.getElementById('theme-delete').click(), true");
const deleted = await poll(async () => {
  const state = JSON.parse(
    await evaluate(
      session,
      `JSON.stringify({
         choice: localStorage.getItem('wikimolgen2.theme'),
         count: JSON.parse(localStorage.getItem('wikimolgen2.custom-themes') ?? '[]').length,
       })`,
    ),
  );
  return state.choice === "system" && state.count === 0 ? state : null;
}, 5_000);
if (deleted === null) failures.push("deleting a custom theme does not remove it");
await evaluate(session, "document.getElementById('theme-done').click(), true");

if (consoleErrors.length > 0) {
  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors.slice(0, 10)) console.log(`  ${error}`);
}

socket.close();
chrome.kill();
server?.close();

if (failures.length > 0) {
  console.log("\nFAILED:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nOK");
}

// --- helpers -----------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--")) continue;
    parsed[argv[i].slice(2)] = argv[i + 1];
  }
  return parsed;
}

async function debugPort(child, readStderr) {
  // Chrome prints "DevTools listening on ws://127.0.0.1:PORT/..." — the port is random
  // with --remote-debugging-port=0, so it has to be read back.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const match = readStderr().match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (match) return Number(match[1]);
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Chrome did not report a debugging port");
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

function once(socket, event) {
  return new Promise((resolve) => socket.addEventListener(event, resolve, { once: true }));
}

async function waitForLoad(session) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await evaluate(session, "document.readyState === 'complete'");
    if (ready === true) return;
    await new Promise((done) => setTimeout(done, 100));
  }
}

async function evaluate(session, expression) {
  const response = await send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    session,
  );
  if (response.result?.exceptionDetails) return `EXCEPTION: ${response.result.exceptionDetails.text}`;
  return response.result?.result?.value;
}

async function poll(probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null && value !== false && value !== undefined) return value;
    await new Promise((done) => setTimeout(done, 250));
  }
  return null;
}

/** Newest completed PNG in a directory, or `null`. A partial `.crdownload` is skipped. */
async function newestPng(directory) {
  const names = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith(".png"));
  let newest = null;
  let newestAt = 0;
  for (const name of names) {
    const path = join(directory, name);
    const info = await stat(path).catch(() => null);
    if (info !== null && info.size > 0 && info.mtimeMs > newestAt) {
      newest = path;
      newestAt = info.mtimeMs;
    }
  }
  return newest;
}

/** The newest `.zip` the browser wrote, which is the batch archive. */
async function newestZip(directory) {
  const names = (await readdir(directory).catch(() => [])).filter((name) => name.endsWith(".zip"));
  let newest = null;
  let newestAt = 0;
  for (const name of names) {
    const path = join(directory, name);
    const info = await stat(path).catch(() => null);
    if (info !== null && info.size > 0 && info.mtimeMs > newestAt) {
      newest = path;
      newestAt = info.mtimeMs;
    }
  }
  return newest;
}

/** File names from a ZIP central directory, without unpacking the entries. */
function zipEntries(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) return [];
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  const names = [];
  let at = start;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) break;
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    names.push(bytes.toString("utf8", at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}


/** Net `{{` vs `}}` count — the cheapest check that a template is pasteable. */
function countUnbalanced(text) {
  return (text.match(/\{\{/g)?.length ?? 0) - (text.match(/\}\}/g)?.length ?? 0);
}
