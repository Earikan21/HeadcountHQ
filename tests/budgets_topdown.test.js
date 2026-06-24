import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, makeClient } from "./helpers.js";
import { allReconciliation, getCompanyBudget } from "../src/repos/budgets.js";

async function admin() {
  const srv = await startTestServer();
  const c = makeClient(srv.base);
  await c.get("/setup");
  await c.post("/setup", { name: "Ada", email: "ada@acme.co", password: "supersecret123" });
  await c.post("/departments", { name: "Engineering" });
  await c.post("/departments", { name: "Sales" });
  const eng = srv.db.prepare("SELECT id FROM departments WHERE name='Engineering'").get().id;
  const sales = srv.db.prepare("SELECT id FROM departments WHERE name='Sales'").get().id;
  return { srv, c, eng, sales };
}

test("set one company budget, then allocate down to departments", async () => {
  const { srv, c, eng, sales } = await admin();
  await c.post("/budgets", {
    company_headcount: "20", company_money: "3000000",
    [`hc_${eng}`]: "12", [`money_${eng}`]: "2000000",
    [`hc_${sales}`]: "6", [`money_${sales}`]: "800000",
  });
  const cb = getCompanyBudget(srv.db);
  assert.equal(cb.headcount, 20);
  assert.equal(cb.money, 3000000);
  const { allocation } = allReconciliation(srv.db);
  assert.equal(allocation.headcount.allocated, 18);
  assert.equal(allocation.headcount.remaining, 2);     // 20 cap - 18 allocated
  assert.equal(allocation.headcount.over, 0);
  assert.equal(allocation.money.allocated, 2800000);
  assert.equal(allocation.money.remaining, 200000);
  await srv.close();
});

test("over-allocating beyond the company cap is flagged", async () => {
  const { srv, c, eng, sales } = await admin();
  await c.post("/budgets", {
    company_headcount: "10", company_money: "1000000",
    [`hc_${eng}`]: "8", [`money_${eng}`]: "700000",
    [`hc_${sales}`]: "5", [`money_${sales}`]: "500000",
  });
  const { allocation } = allReconciliation(srv.db);
  assert.equal(allocation.headcount.allocated, 13);
  assert.equal(allocation.headcount.over, 3);           // 13 allocated - 10 cap
  assert.equal(allocation.money.over, 200000);          // 1.2M - 1.0M
  const pageHtml = await (await c.get("/budgets")).text();
  assert.match(pageHtml, /Company budget/);
  assert.match(pageHtml, /over-allocated/i);
  await srv.close();
});

test("budgets page shows the company-cap reconciliation", async () => {
  const { srv, c } = await admin();
  const pageHtml = await (await c.get("/budgets")).text();
  assert.match(pageHtml, /one company-wide budget/i);
  assert.match(pageHtml, /Allocate to departments/);
  await srv.close();
});
