import { test } from "node:test";
import assert from "node:assert/strict";
import { hiresByMonth, projectScenario } from "../src/domain/planning.js";

test("hiresByMonth: all-at-once lands fully at the start month", () => {
  assert.equal(hiresByMonth(6, 3, "all_at_once", 12, 2), 0);
  assert.equal(hiresByMonth(6, 3, "all_at_once", 12, 3), 6);
  assert.equal(hiresByMonth(6, 3, "all_at_once", 12, 11), 6);
});

test("hiresByMonth: even ramp builds linearly to the total", () => {
  // 6 hires from month 0 across 12 months
  assert.equal(hiresByMonth(6, 0, "even", 12, 0), 1); // ~0.5 -> rounds to 1 by end of m0
  const end = hiresByMonth(6, 0, "even", 12, 11);
  assert.equal(end, 6);
});

test("hiresByMonth: quarterly adds in chunks", () => {
  assert.equal(hiresByMonth(8, 0, "quarterly", 12, 0), 2); // 4 quarters -> 2/quarter
  assert.equal(hiresByMonth(8, 0, "quarterly", 12, 3), 4);
  assert.equal(hiresByMonth(8, 0, "quarterly", 12, 11), 8);
});

test("projectScenario: runway is the month cash goes negative", () => {
  const r = projectScenario({
    financials: { cash_balance: 1000000, monthly_burn: 100000, monthly_revenue: 0, horizon_months: 24 },
    departments: [{ id: 1, name: "Eng", currentHeadcount: 0, currentMonthlyCost: 0 }],
    items: [],
  });
  // pure 100k/mo burn on 1M cash -> negative at month 10 (cash after m9 = 0, m10 < 0)
  assert.equal(r.summary.runwayMonths, 10);
});

test("projectScenario: hiring adds time-phased cost and shortens runway", () => {
  const base = projectScenario({
    financials: { cash_balance: 1200000, monthly_burn: 0, horizon_months: 24 },
    departments: [{ id: 1, name: "Eng", currentHeadcount: 0, currentMonthlyCost: 0 }],
    items: [{ department_id: 1, new_hires: 12, start_month: 0, pace: "all_at_once", cost_per_hire: 120000 }],
  });
  // 12 hires x 120k = 1.44M/yr = 120k/mo -> 1.2M cash lasts 10 months
  assert.equal(base.summary.runwayMonths, 10);
  assert.equal(base.summary.addedAnnualCost, 1440000);
  assert.equal(base.summary.endHeadcount, 12);
});

test("projectScenario: productivity outcomes give a sensitivity band", () => {
  const r = projectScenario({
    financials: { cash_balance: 5000000, horizon_months: 12, productivity_conservative_pct: 70, productivity_aggressive_pct: 130 },
    departments: [{ id: 1, name: "Sales", currentHeadcount: 4, currentMonthlyCost: 0 }],
    items: [{ department_id: 1, new_hires: 2, start_month: 0, pace: "all_at_once", productivity_per_head: 500000, outcome: "base" }],
  });
  // end heads = 6, base output = 6 * 500k = 3.0M
  assert.equal(r.summary.output.base, 3000000);
  assert.equal(r.summary.output.conservative, 2100000); // x0.7
  assert.equal(r.summary.output.aggressive, 3900000);   // x1.3
  assert.equal(r.byDept[0].output, 3000000);            // selected outcome = base
});

test("projectScenario: per-department selected outcome drives company selected output", () => {
  const r = projectScenario({
    financials: { cash_balance: 1, horizon_months: 12, productivity_conservative_pct: 50, productivity_aggressive_pct: 200 },
    departments: [{ id: 1, name: "A", currentHeadcount: 1, currentMonthlyCost: 0 }, { id: 2, name: "B", currentHeadcount: 1, currentMonthlyCost: 0 }],
    items: [
      { department_id: 1, new_hires: 0, start_month: 0, pace: "all_at_once", productivity_per_head: 100000, outcome: "conservative" },
      { department_id: 2, new_hires: 0, start_month: 0, pace: "all_at_once", productivity_per_head: 100000, outcome: "aggressive" },
    ],
  });
  // A: 1*100k*0.5 = 50k ; B: 1*100k*2.0 = 200k ; selected = 250k
  assert.equal(r.summary.output.selected, 250000);
});
