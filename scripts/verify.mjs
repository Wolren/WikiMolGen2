// End-to-end check of the built page in a real browser, over the DevTools protocol.
//
// Serves a directory, opens Chrome headless, loads a compound through the page's own
// controls, and reports what the console said plus a screenshot. No test framework: it
// is one script with one job, so a failure is a line of output, not a stack trace.
//
//   node scripts/verify.mjs --dir web/dist --out D:/Projects/tools/scratch/molplate.png
//   node scripts/verify.mjs --dir web --entry /                 # vite dev server variant
//
// Exit code is 0 only when the page loaded, produced markup, and the canvas was drawn on.

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join, resolve, dirname } from "node:path";

const args = parseArgs(process.argv.slice(2));
const ROOT = resolve(args.dir ?? "web/dist");
const OUT = resolve(args.out ?? "screenshot.png");
const PORT = Number(args.port ?? 4173);
const COMPOUND = args.compound ?? "aspirin";
const verbose = args.verbose === "true";
const EXTRA_FLAGS = args.flags ? args.flags.split("|").filter(Boolean) : [];
const CHROME = args.chrome ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
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

const profile = join(process.env.TEMP ?? "/tmp", `molplate-verify-${Date.now()}`);
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
await send("Page.navigate", { url: baseUrl }, session);
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

// 1. The renderer must have started. Startup is asynchronous (wasm init + GPU device),
//    so wait for the stage overlay to clear or turn into an error.
const stageReady = await poll(async () => {
  const hidden = await evaluate(session, "document.getElementById('stage-message')?.hidden ?? false");
  const failed = await evaluate(
    session,
    "document.getElementById('stage-message')?.classList.contains('error') ?? false",
  );
  return hidden || failed ? { hidden, failed } : null;
}, 60_000);

const stageText = await evaluate(session, "document.getElementById('stage-message')?.textContent ?? ''");
if (stageReady === null) failures.push("renderer never finished starting");
if (stageReady !== null && !stageReady.hidden) failures.push(`renderer did not start: ${stageText.trim()}`);
console.log(
  `renderer: ${stageReady?.hidden ? "started" : "FAILED — " + stageText.trim()}`,
);

// The badge is filled a tick after the overlay clears (boot sets it right after the
// renderer resolves), so wait for it instead of racing that one line.
const engine = await poll(
  async () => {
    const text = await evaluate(session, "document.getElementById('engine')?.textContent ?? ''");
    return text === "" ? null : text;
  },
  10_000,
);
console.log(`backend: ${engine || "(none reported)"}`);
if (engine !== "WebGPU" && engine !== "WebGL2") {
  failures.push(`unexpected graphics backend: ${engine || "none"}`);
} else if (engine === "WebGL2") {
  console.log("  note: WebGL2 fallback in use — WebGPU was not available to this browser");
}

// 2. Load a compound through the page's own form.
await evaluate(
  session,
  `(() => {
     const input = document.getElementById('identifier');
     input.value = ${JSON.stringify(COMPOUND)};
     document.getElementById('lookup').requestSubmit();
     return true;
   })()`,
);

const summary = await poll(async () => {
  const visible = await evaluate(session, "!document.getElementById('summary').hidden");
  return visible ? await evaluate(session, "document.getElementById('summary').innerText") : null;
  // A protein's first cartoon frame compiles pipelines; measured up to 33 s under load.
}, 90_000);
if (summary === null) failures.push("no compound summary appeared");
else console.log(`compound: ${summary.replace(/\n/g, " | ").slice(0, 160)}`);
console.log(`status: ${await evaluate(session, "document.getElementById('export-status').textContent")}`);

// A protein has no drug box and no flat record, so the compound-only checks below skip.
const isProtein = await evaluate(
  session,
  "document.getElementById('tab-drugbox').hidden === true",
);

// 3. Every tab must produce markup.
for (const tab of ["drugbox", "chembox", "commons"]) {
  await evaluate(session, `document.getElementById('tab-${tab}').click(), true`);
  const text = await evaluate(session, "document.getElementById('wikitext').textContent");
  const length = typeof text === "string" ? text.length : 0;
  if (length < 40) failures.push(`${tab} produced ${length} characters of markup`);
  const balanced = typeof text === "string" && countUnbalanced(text) === 0;
  if (!balanced) failures.push(`${tab} markup has unbalanced braces`);
  console.log(`${tab}: ${length} chars${balanced ? "" : ": UNBALANCED"}`);
}

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
  await evaluate(session, "document.getElementById('mode-3d').click(), true");
  await new Promise((done) => setTimeout(done, 300));
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

// 4. Export a PNG through the app's own path. The renderer draws offscreen and the page
//    composes the figure in Rust, so the downloaded file is the product, not a canvas read.
const downloadDir = join(process.env.TEMP ?? "/tmp", `molplate-download-${Date.now()}`);
await mkdir(downloadDir, { recursive: true });
await send("Browser.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: downloadDir,
  eventsEnabled: true,
});

const completion = new Promise((resolve) => {
  downloadFinished = resolve;
});

await evaluate(session, `(() => {
  const width = document.getElementById('export-width');
  width.value = '1200';
  width.dispatchEvent(new Event('change'));
  document.getElementById('export').click();
  return true;
})()`);

// Wait for the browser's own completion event: it carries the real file path, whereas
// polling the directory races the browser's write-then-rename.
const download = await Promise.race([
  completion,
  new Promise((resolve) => setTimeout(() => resolve(null), 90_000)),
]);

console.log(`export status: ${await evaluate(session, "document.getElementById('export-status').textContent")}`);

if (download === null || download.state !== "completed" || !download.filePath) {
  failures.push(`export did not complete (${download?.state ?? "no download event"})`);
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
const shot = await send("Page.captureScreenshot", { format: "png" }, session);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, Buffer.from(shot.result.data, "base64"));
console.log(`screenshot: ${OUT}`);

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

/** Net `{{` vs `}}` count — the cheapest check that a template is pasteable. */
function countUnbalanced(text) {
  return (text.match(/\{\{/g)?.length ?? 0) - (text.match(/\}\}/g)?.length ?? 0);
}
