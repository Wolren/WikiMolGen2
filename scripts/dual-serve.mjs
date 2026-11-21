// Static server for the dual build: patinae at /, classic at /classic/.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.argv[2] ?? process.cwd();
const port = Number(process.argv[3] ?? 5182);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
]);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (path === "" || path.endsWith("/") || path.endsWith("\\")) path = join(path, "index.html");
    const file = join(root, path);
    if (!file.startsWith(root)) return void res.writeHead(403).end("forbidden");
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": types.get(extname(target).toLowerCase()) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`dual site: http://127.0.0.1:${port}/  classic: http://127.0.0.1:${port}/classic/`);
});
