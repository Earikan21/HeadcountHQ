/**
 * Planning engine — pure, no DB. Projects a hiring scenario month by month to
 * show time-phased headcount, fully-loaded cost, revenue, net burn, cash, and
 * RUNWAY, plus a productivity-output sensitivity band. All assumptions are
 * explicit inputs (no fabricated ROI — productivity is admin-supplied per dept).
 */

export const PACES = ["all_at_once", "even", "quarterly"];
export const PACE_LABELS = { all_at_once: "All at once", even: "Even ramp", quarterly: "Quarterly" };
export const OUTCOMES = ["conservative", "base", "aggressive"];

/** Cumulative new hires added by the END of month index m (0-based). */
export function hiresByMonth(total, startMonth, pace, horizon, m) {
  total = Math.max(0, Math.round(Number(total) || 0));
  startMonth = Math.max(0, Math.round(Number(startMonth) || 0));
  if (total === 0 || m < startMonth) return 0;
  if (pace === "all_at_once") return total;
  const span = Math.max(1, horizon - startMonth);
  if (pace === "quarterly") {
    const quarters = Math.ceil(span / 3);
    const perQuarter = Math.ceil(total / quarters);
    const elapsed = Math.floor((m - startMonth) / 3) + 1;
    return Math.min(total, elapsed * perQuarter);
  }
  // even: linear from startMonth across the remaining horizon
  return Math.min(total, Math.round((total * (m - startMonth + 1)) / span));
}

const outcomeMultipliers = (fin) => ({
  conservative: (Number(fin.productivity_conservative_pct) || 70) / 100,
  base: 1,
  aggressive: (Number(fin.productivity_aggressive_pct) || 135) / 100,
});

/**
 * @param {object} p
 * @param {object} p.financials   cash_balance, monthly_burn, monthly_revenue,
 *                                revenue_growth_pct, comp_inflation_pct, horizon_months,
 *                                productivity_conservative_pct, productivity_aggressive_pct
 * @param {Array}  p.departments  [{ id, name, currentHeadcount, currentMonthlyCost }]
 * @param {Array}  p.items        [{ department_id, new_hires, start_month, pace,
 *                                   cost_per_hire, productivity_per_head, outcome }]
 */
export function projectScenario({ financials = {}, departments = [], items = [], horizon }) {
  const H = Math.max(1, Math.round(Number(horizon) || Number(financials.horizon_months) || 24));
  const inflation = (Number(financials.comp_inflation_pct) || 0) / 100;
  const revGrowth = (Number(financials.revenue_growth_pct) || 0) / 100;
  const byDeptItem = new Map(items.map((i) => [i.department_id, i]));
  const mult = outcomeMultipliers(financials);

  let cash = Number(financials.cash_balance) || 0;
  let runwayMonths = null;
  const months = [];
  for (let m = 0; m < H; m++) {
    let headcount = 0, hcCost = 0;
    for (const d of departments) {
      const it = byDeptItem.get(d.id);
      const added = it ? hiresByMonth(it.new_hires, it.start_month, it.pace, H, m) : 0;
      headcount += (d.currentHeadcount || 0) + added;
      const monthlyBase = (d.currentMonthlyCost || 0) + added * ((Number(it?.cost_per_hire) || 0) / 12);
      hcCost += monthlyBase * (1 + inflation * (m / 12));
    }
    const revenue = (Number(financials.monthly_revenue) || 0) * (1 + revGrowth * (m / 12));
    const netBurn = hcCost + (Number(financials.monthly_burn) || 0) - revenue;
    cash -= netBurn;
    if (runwayMonths === null && cash < 0) runwayMonths = m;
    months.push({ month: m, headcount, headcountCost: Math.round(hcCost), revenue: Math.round(revenue), netBurn: Math.round(netBurn), cash: Math.round(cash) });
  }

  // End-state per-department output (productivity is per-dept, with a chosen outcome).
  const byDept = departments.map((d) => {
    const it = byDeptItem.get(d.id);
    const newHires = Math.max(0, Math.round(Number(it?.new_hires) || 0));
    const endHeads = (d.currentHeadcount || 0) + newHires;
    const perHead = Number(it?.productivity_per_head) || 0;
    const outcome = OUTCOMES.includes(it?.outcome) ? it.outcome : "base";
    const output = perHead > 0 ? Math.round(endHeads * perHead * mult[outcome]) : null;
    return { id: d.id, name: d.name, newHires, addedAnnualCost: Math.round(newHires * (Number(it?.cost_per_hire) || 0)), endHeads, perHead, outcome, output };
  });

  // Company output: the per-dept selected outcomes, plus a full sensitivity band.
  const band = { conservative: 0, base: 0, aggressive: 0 };
  for (const d of departments) {
    const it = byDeptItem.get(d.id);
    const perHead = Number(it?.productivity_per_head) || 0;
    if (perHead <= 0) continue;
    const endHeads = (d.currentHeadcount || 0) + Math.max(0, Math.round(Number(it?.new_hires) || 0));
    band.conservative += endHeads * perHead * mult.conservative;
    band.base += endHeads * perHead * mult.base;
    band.aggressive += endHeads * perHead * mult.aggressive;
  }
  const selectedOutput = byDept.reduce((a, d) => a + (d.output || 0), 0);

  const last = months[months.length - 1];
  const summary = {
    horizon: H,
    totalNewHires: byDept.reduce((a, d) => a + d.newHires, 0),
    endHeadcount: last ? last.headcount : departments.reduce((a, d) => a + (d.currentHeadcount || 0), 0),
    endMonthlyNetBurn: last ? last.netBurn : 0,
    addedAnnualCost: byDept.reduce((a, d) => a + d.addedAnnualCost, 0),
    runwayMonths, // null => cash lasts beyond the horizon
    endCash: last ? last.cash : Math.round(cash),
    output: { selected: Math.round(selectedOutput), conservative: Math.round(band.conservative), base: Math.round(band.base), aggressive: Math.round(band.aggressive) },
  };
  return { months, byDept, summary };
}
