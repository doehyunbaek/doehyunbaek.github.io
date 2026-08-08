import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker/index.js";

const port = Number(process.env.PORT) || 8000;
const root = dirname(fileURLToPath(import.meta.url));
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function serveApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const workerRequest = new Request(url, { method: request.method, headers: { Accept: "application/json" } });
  const workerResponse = await worker.fetch(workerRequest, {}, { waitUntil() {} });
  response.writeHead(workerResponse.status, Object.fromEntries(workerResponse.headers));
  response.end(Buffer.from(await workerResponse.arrayBuffer()));
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = normalize(join(root, requested));
  if (!filePath.startsWith(`${root}/`)) throw new Error("Forbidden");
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("Not found");
  const data = await readFile(filePath);
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  response.end(data);
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await serveApi(request, response);
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET" });
      return response.end("Method not allowed");
    }
    await serveStatic(url.pathname, response);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error.message === "Forbidden" ? "Forbidden" : "Not found");
  }
}).listen(port, () => console.log(`VocaTube is running at http://localhost:${port}`));
