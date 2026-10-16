// Serves the built frontend as a SPA (unknown paths fall back to index.html).

import fs from "node:fs";
import path from "node:path";
import type { Handler } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function serveSpa(root: string): Handler {
  const index = path.join(root, "index.html");

  return (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname);
    let file = path.join(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = index;
    if (!fs.existsSync(file)) return c.text("Awake is running, but the web UI is not built (npm run build -w frontend).", 503);

    // Vite assets carry a content hash; everything else (index, service worker, manifest) must be revalidated.
    const immutable = file.startsWith(path.join(root, "assets") + path.sep);
    return c.body(fs.readFileSync(file), 200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
  };
}

/** `--api-only` (development): Vite serves the UI, so this server only points there. */
export function apiOnly(publicUrl: string): Handler {
  const page =
    `<!doctype html><meta charset="utf-8"><title>Awake API</title>` +
    `<body style="font:16px system-ui,sans-serif;padding:3rem;max-width:40rem">` +
    `<h1>Awake API (development)</h1><p>This server only answers <code>/api</code> and <code>/agent</code>.</p>` +
    `<p>Open the web UI at <a href="${publicUrl}">${publicUrl}</a>.</p></body>`;
  return (c) => c.html(page, 404);
}
