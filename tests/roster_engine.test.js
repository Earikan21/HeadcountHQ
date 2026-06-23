import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/domain/roster.js";

test("autoMap matches common header variants", () => {
  const { mapping, confidence } = R.autoMap(["Emp ID", "Full Name", "Dept", "Comp Amount", "Pay Unit"]);
  assert.equal(mapping.employee_id, "Emp ID");
  assert.equal(mapping.name, "Full Name");
  assert.equal(mapping.department, "Dept");
  assert.equal(mapping.compensation_amount, "Comp Amount");
  assert.equal(confidence.employee_id, "high");
});

test("parseAmount handles $, commas, k, m", () => {
  assert.equal(R.parseAmount("$120,000"), 120000);
  assert.equal(R.parseAmount("95k"), 95000);
  assert.equal(R.parseAmount("1.2m"), 1200000);
  assert.equal(R.parseAmount("N/A"), null);
});

test("toAnnual converts pay units", () => {
  assert.equal(R.toAnnual(10000, "monthly"), 120000);
  assert.equal(R.toAnnual(50, "hourly"), 104000);
  assert.equal(R.toAnnual(5000, "biweekly"), 130000);
});

test("band labels group salaries", () => {
  assert.equal(R.band(137000), "$125k–$150k");
  assert.equal(R.band(95000), "$75k–$100k");
});

test("buildCanonical flags errors and annualizes", () => {
  const raw = [
    { ID: "E1", Name: "A", Dept: "Eng", Amount: "120000", Unit: "Annual" },
    { ID: "", Name: "B", Dept: "Sales", Amount: "100", Unit: "Hourly" },     // missing id (error)
    { ID: "E3", Name: "C", Dept: "Sales", Amount: "N/A", Unit: "Annual" },   // bad comp (error)
    { ID: "E1", Name: "D", Dept: "Eng", Amount: "5000", Unit: "Monthly" },   // dup id (warn)
  ];
  const mapping = { employee_id: "ID", name: "Name", department: "Dept", compensation_amount: "Amount", compensation_unit: "Unit" };
  const built = R.buildCanonical(raw, mapping);
  assert.equal(built.summary.total, 4);
  assert.equal(built.rows[0].annual_salary, 120000);
  assert.equal(built.rows[1]._ok, false); // missing id
  assert.equal(built.rows[2]._ok, false); // bad comp
  assert.ok(built.rows[3]._issues.some((x) => x.level === "warn")); // dup
  assert.equal(built.rows[3].annual_salary, 60000); // 5000 * 12
});

test("rollup totals by department, excludes inactive when asked", () => {
  const built = R.buildCanonical(
    [
      { ID: "E1", Name: "A", Dept: "Eng", Amount: "100000", Unit: "Annual", St: "Active" },
      { ID: "E2", Name: "B", Dept: "Eng", Amount: "200000", Unit: "Annual", St: "Active" },
      { ID: "E3", Name: "C", Dept: "Sales", Amount: "150000", Unit: "Annual", St: "Terminated" },
    ],
    { employee_id: "ID", name: "Name", department: "Dept", compensation_amount: "Amount", compensation_unit: "Unit", employment_status: "St" }
  );
  const roll = R.rollup(built.rows, { excludeInactive: true });
  assert.equal(roll.totals.headcount, 2);
  assert.equal(roll.totals.annualCost, 300000);
  assert.equal(roll.departments[0].department, "Eng");
});
