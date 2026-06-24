/**
 * Central route registration. Each feature area registers its own routes; this
 * file just wires them together and keeps the health endpoints.
 */
import { registerHomeRoutes } from "./routes/home.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerDepartmentRoutes } from "./routes/departments.js";
import { registerRosterRoutes } from "./routes/roster.js";
import { registerPhilosophyRoutes } from "./routes/philosophy.js";
import { registerSeatRoutes } from "./routes/seats.js";
import { registerRequestRoutes } from "./routes/requests.js";
import { registerBudgetRoutes } from "./routes/budgets.js";

export function registerRoutes(router, _deps) {
  router.get("/health", (ctx) => ctx.send(200, "text/plain; charset=utf-8", "Server healthy"));
  router.get("/health.json", (ctx) => ctx.json(200, { status: "ok", time: new Date().toISOString() }));

  registerHomeRoutes(router);
  registerAuthRoutes(router);
  registerAccountRoutes(router);
  registerDepartmentRoutes(router);
  registerRosterRoutes(router);
  registerPhilosophyRoutes(router);
  registerSeatRoutes(router);
  registerRequestRoutes(router);
  registerBudgetRoutes(router);
}
