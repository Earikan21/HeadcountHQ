/**
 * Builds the HTTP server: security headers, static assets, and routes. Kept
 * separate from server start-up so tests can listen on an ephemeral port.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { Router } from "./router.js";
import { registerRoutes } from "./routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, "..", "public");

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * @param {{ config: any, db: import("node:sqlite").DatabaseSync }} deps
 * @returns {import("node:http").Server}
 */
export function buildApp({ config, db }) {
  const router = new Router();
  registerRoutes(router, { config, db });

  const server = createServer(async (req, res) => {
    try {
      setSecurityHeaders(res, config);
      const url = new URL(req.url, "http://localhost");
      const pathname = url.pathname;

      // Static assets.
      if (pathname.startsWith("/static/")) {
        return await serveStatic(pathname.slice("/static/".length), res);
      }

      const matched = router.match(req.method, pathname);
      if (!matched) return send(res, 404, "text/plain; charset=utf-8", "Not found");

      const ctx = { req, res, url, params: matched.params, config, db, send };
      await matched.handler(ctx);
    } catch (err) {
      // Never leak internals to the client.
      // eslint-disable-next-line no-console
      console.error(err);
      if (!res.headersSent) send(res, 500, "text/plain; charset=utf-8", "Internal Server Error");
    }
  });

  return server;
}

function setSecurityHeaders(res, config) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; img-src 'self' data:");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (config.COOKIE_SECURE) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

async function serveStatic(relPath, res) {
  // Prevent path traversal: normalise and reject anything climbing out of /public.
  const safeRel = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = join(PUBLIC_DIR, safeRel);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, "text/plain", "Forbidden");
  try {
    const data = await readFile(full);
    const ext = safeRel.slice(safeRel.lastIndexOf("."));
    send(res, 200, STATIC_TYPES[ext] || "application/octet-stream", data);
  } catch {
    send(res, 404, "text/plain; charset=utf-8", "Not found");
  }
}
