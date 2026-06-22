/**
 * Central route registration. Each feature area registers its own routes; this
 * file just wires them together and keeps the health endpoints.
 */
import { registerHomeRoutes } from "./routes/home.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerDepartmentRoutes } from "./routes/departments.js";

export function registerRoutes(router, _deps) {
  router.get("/health", (ctx) => ctx.send(200, "text/plain; charset=utf-8", "Server healthy"));
  router.get("/health.json", (ctx) => ctx.json(200, { status: "ok", time: new Date().toISOString() }));

  registerHomeRoutes(router);
  registerAuthRoutes(router);
  registerAccountRoutes(router);
  registerDepartmentRoutes(router);
}
