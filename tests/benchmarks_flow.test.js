import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, makeClient } from "./helpers.js";

async function adminWithDepts() {
  const srv = await startTestServer();
  const c = makeClient(srv.base);
  await c.get("/setup");
  await c.post("/setup", { name: "Ada", email: "a@b.co", password: "supersecret123" });
  await c.post("/departments", { name: "Engineering" });
  await c.post("/departments", { name: "Sales" });
  return { srv, c };
}
const engTarget = (db) => db.prepare("SELECT target_pct FROM target_ratios WHERE key='Engineering'").get()?.target_pct;

test("Suggest produces phase-specific targets (early vs scale differ)", async () => {
  const { srv, c } = await adminWithDepts();
  await c.post("/philosophy", { seat_mode: "seat", backfill_policy: "auto", company_phase: "early", industry: "general" });
  await c.post("/philosophy/targets/suggest", {});
  const early = engTarget(srv.db);

  await c.post("/philosophy", { seat_mode: "seat", backfill_policy: "auto", company_phase: "scale", industry: "general" });
  await c.post("/philosophy/targets/suggest", {});
  const scale = engTarget(srv.db);

  assert.ok(early > scale, `Engineering target should be higher early (${early}) than at scale (${scale})`);
  await srv.close();
});

test("Philosophy page renders the industry dropdown", async () => {
  const { srv, c } = await adminWithDepts();
  const pageHtml = await (await c.get("/philosophy")).text();
  assert.match(pageHtml, /<select name="industry">/);
  assert.match(pageHtml, /B2B SaaS/);
  assert.match(pageHtml, /Other \/ General/);
  await srv.close();
});
