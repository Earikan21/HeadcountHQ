/** Budget envelopes + per-department reconciliation (positions & money). */
import { reconcile } from "../domain/budget.js";

const APPROVED = "('approved','open','filled','frozen')";
const OPEN_REQ = "('submitted','under_review','deferred')";

export function getEnvelopes(db) {
  const rows = db.prepare("SELECT department_id, headcount_budget, money_budget FROM budget_envelopes WHERE period='current'").all();
  const map = {};
  for (const r of rows) map[r.department_id] = r;
  return map;
}
export function getCompanyBudget(db) {
  const r = db.prepare("SELECT company_headcount_budget AS headcount, company_money_budget AS money FROM workspace_settings WHERE workspace_id=1").get();
  return r || { headcount: 0, money: 0 };
}
export function setCompanyBudget(db, headcount, money, userId) {
  db.prepare("UPDATE workspace_settings SET company_headcount_budget=?, company_money_budget=?, updated_by=?, updated_at=datetime('now') WHERE workspace_id=1")
    .run(Math.max(0, Math.round(Number(headcount) || 0)), Math.max(0, Number(money) || 0), userId);
}

export const getEnvelope = (db, deptId) =>
  db.prepare("SELECT * FROM budget_envelopes WHERE department_id=? AND period='current'").get(deptId)
  || { department_id: deptId, headcount_budget: 0, money_budget: 0 };

export function setEnvelope(db, deptId, headcount, money, userId) {
  db.prepare(
    `INSERT INTO budget_envelopes (department_id, period, headcount_budget, money_budget, set_by)
     VALUES (?, 'current', ?, ?, ?)
     ON CONFLICT(workspace_id, department_id, period)
       DO UPDATE SET headcount_budget=excluded.headcount_budget, money_budget=excluded.money_budget,
                     set_by=excluded.set_by, updated_at=datetime('now')`
  ).run(deptId, Math.max(0, Math.round(Number(headcount) || 0)), Math.max(0, Number(money) || 0), userId);
}

/** Live usage numbers for one department. */
export function departmentUsage(db, deptId) {
  const approvedPositions = db.prepare(`SELECT COUNT(*) AS n FROM seats WHERE department_id=? AND status IN ${APPROVED}`).get(deptId).n;
  const committedMoney = db.prepare(`SELECT COALESCE(SUM(loaded_cost_estimate),0) AS s FROM seats WHERE department_id=? AND status != 'closed'`).get(deptId).s;
  const pendingPositions = db.prepare(`SELECT COUNT(*) AS n FROM hiring_requests WHERE department_id=? AND status IN ${OPEN_REQ}`).get(deptId).n;
  const pendingMoney = db.prepare(`SELECT COALESCE(SUM(estimated_cost),0) AS s FROM hiring_requests WHERE department_id=? AND status IN ${OPEN_REQ}`).get(deptId).s;
  return { approvedPositions, committedMoney, pendingPositions, pendingMoney };
}

export function departmentReconciliation(db, deptId) {
  const env = getEnvelope(db, deptId);
  const u = departmentUsage(db, deptId);
  return reconcile({ headcountBudget: env.headcount_budget, moneyBudget: env.money_budget, ...u });
}

/**
 * Top-down reconciliation. The COMPANY budget (set at the top) is the cap; each
 * department's envelope is an ALLOCATION of it. Returns per-department rows, the
 * allocation status (how much of the company cap is handed out), and the company
 * reconciliation (cap vs. actual approved/committed).
 */
export function allReconciliation(db) {
  const depts = db.prepare("SELECT id, name FROM departments ORDER BY name").all();
  const rows = depts.map((d) => ({ id: d.id, name: d.name, ...departmentReconciliation(db, d.id) }));
  const sum = (sel) => rows.reduce((a, r) => a + sel(r), 0);
  const cap = getCompanyBudget(db);

  const allocated = {
    headcount: sum((r) => r.positions.budget),
    money: sum((r) => r.money.budget),
  };
  const allocation = {
    headcount: { cap: cap.headcount, allocated: allocated.headcount, remaining: cap.headcount - allocated.headcount, over: Math.max(0, allocated.headcount - cap.headcount) },
    money: { cap: cap.money, allocated: allocated.money, remaining: cap.money - allocated.money, over: Math.max(0, allocated.money - cap.money) },
  };

  const company = reconcile({
    headcountBudget: cap.headcount,
    moneyBudget: cap.money,
    approvedPositions: sum((r) => r.positions.approved),
    committedMoney: sum((r) => r.money.committed),
    pendingPositions: sum((r) => r.positions.pending),
    pendingMoney: sum((r) => r.money.pending),
  });

  return { rows, allocation, company };
}
