/**
 * Route registration. Handlers are thin: they translate HTTP to/from the
 * rendering and (later) domain layers, and hold no business logic.
 */
import { layout, html } from "./html.js";

/**
 * @param {import("./router.js").Router} router
 * @param {{ config: any, db: import("node:sqlite").DatabaseSync }} _deps
 */
export function registerRoutes(router, _deps) {
  router.get("/health", ({ res, send }) => {
    send(res, 200, "text/plain; charset=utf-8", "Server healthy");
  });

  router.get("/health.json", ({ res, send }) => {
    send(res, 200, "application/json; charset=utf-8",
      JSON.stringify({ status: "ok", time: new Date().toISOString() }));
  });

  router.get("/", ({ res, send }) => {
    const body = html`
      <section class="card">
        <h1>Headcount HQ</h1>
        <p class="muted">
          Self-hosted headcount modeling — current roster &amp; compensation connected
          to structured hiring requests, reconciled against budget and runway.
        </p>
        <p>The application is running. Sign-in and the workspace come online in the next milestone.</p>
        <p><a class="btn" href="/health">Check server status</a></p>
      </section>`;
    send(res, 200, "text/html; charset=utf-8", layout({ title: "Home", body }));
  });
}
