import { html, raw } from "../html.js";
import { renderPage, csrfField, money } from "../views/ui.js";
import { requirePermission } from "../middleware.js";
import { canSetBudgets } from "../authz.js";
import {
  allReconciliation, getEnvelopes, getCompanyBudget,
  setCompanyHeadcount, setCompanyMoney, setEnvelopeHeadcount, setEnvelopeMoney,
} from "../repos/budgets.js";
import { listDepartments } from "../repos/departments.js";
import { getSettings } from "../repos/settings.js";
import { logAudit } from "../repos/audit.js";

export function registerBudgetRoutes(router) {
  router.get("/budgets", (ctx) => {
    if (!requirePermission(ctx, canSetBudgets)) return;
    const mode = ctx.query.get("mode") === "money" ? "money" : "headcount";
    ctx.html(200, page(ctx, mode));
  });
  router.post("/budgets", (ctx) => {
    if (!requirePermission(ctx, canSetBudgets)) return;
    const mode = ctx.body.mode === "money" ? "money" : "headcount";
    const depts = listDepartments(ctx.db);
    if (mode === "money") {
      setCompanyMoney(ctx.db, ctx.body.company_money, ctx.user.id);
      for (const d of depts) if (ctx.body[`money_${d.id}`] !== undefined) setEnvelopeMoney(ctx.db, d.id, ctx.body[`money_${d.id}`], ctx.user.id);
    } else {
      setCompanyHeadcount(ctx.db, ctx.body.company_headcount, ctx.user.id);
      for (const d of depts) if (ctx.body[`hc_${d.id}`] !== undefined) setEnvelopeHeadcount(ctx.db, d.id, ctx.body[`hc_${d.id}`], ctx.user.id);
    }
    logAudit(ctx.db, { userId: ctx.user.id, action: "budgets.updated", entity: "budget_envelope", detail: { mode } });
    ctx.redirect(`/budgets?mode=${mode}&msg=Saved`);
  });
}

function bar(used, budget, over) {
  const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const cls = over ? "over" : pct >= 90 ? "warn" : "ok";
  return raw(`<div class="ubar"><i class="${cls}" style="width:${pct}%"></i></div>`);
}
function allocNote(a, kind) {
  if (!a.cap) return html`<span class="muted">set a company budget first</span>`;
  if (a.over > 0) return html`<span class="over-txt">over by ${kind === "money" ? money(a.over) : a.over}</span>`;
  return html`<span class="ok-txt">${kind === "money" ? money(a.remaining) : a.remaining} left</span>`;
}
function tabs(mode) {
  const tab = (m, label) => `<a class="wtab ${m === mode ? "on" : ""}" href="/budgets?mode=${m}">${label}</a>`;
  return raw(`<div class="wtabs">${tab("headcount", "Headcount budget")}${tab("money", "Money budget")}</div>`);
}

function page(ctx, mode) {
  const settings = getSettings(ctx.db);
  const cap = getCompanyBudget(ctx.db);
  const { rows, allocation, company, currentEmployees } = allReconciliation(ctx.db);
  const env = getEnvelopes(ctx.db);
  const noDepts = rows.length === 0;

  const head = html`
    <div class="pagehead"><h1>Budgets</h1>
      <p class="muted">Top-down: set one company budget, then allocate it across departments. Work on one number at a time. Enforcement is <b>${settings.budget_enforcement}</b> (<a href="/philosophy">change</a>).</p>
    </div>
    ${tabs(mode)}`;

  let body;
  if (mode === "headcount") {
    const a = allocation.headcount;
    const deptRows = noDepts ? raw('<tr><td colspan="5" class="muted">No departments yet.</td></tr>')
      : rows.map((r) => html`<tr>
          <td><b>${r.name}</b></td>
          <td class="right">${r.currentEmployees}</td>
          <td class="right">${r.positions.approved}${r.positions.pending ? html` <span class="muted">+${r.positions.pending} pending</span>` : ""}</td>
          <td><input class="tcell" type="number" min="0" step="1" name="hc_${r.id}" value="${env[r.id]?.headcount_budget ?? 0}"></td>
          <td>${bar(r.positions.approved, r.positions.budget, r.positions.over > 0)}</td>
        </tr>`);
    body = html`${head}
      <form method="post" action="/budgets">
        ${csrfField(ctx)}<input type="hidden" name="mode" value="headcount">
        <section class="card">
          <h2>Company headcount budget</h2>
          <label>Total positions, company-wide<input type="number" min="0" step="1" name="company_headcount" value="${cap.headcount}" style="max-width:200px"></label>
        </section>
        <div class="kpis">
          <div class="kpi"><div class="lbl">Current employees</div><div class="val">${currentEmployees}</div></div>
          <div class="kpi"><div class="lbl">Approved positions</div><div class="val">${company.positions.approved}</div></div>
          <div class="kpi"><div class="lbl">Allocated / cap</div><div class="val ${a.over ? "bad" : ""}">${a.allocated} / ${cap.headcount}</div><div class="lbl">${allocNote(a, "hc")}</div></div>
        </div>
        <section class="card">
          <h2>Allocate positions to departments</h2>
          <table class="table">
            <thead><tr><th>Department</th><th class="right">Current employees</th><th class="right">Approved</th><th>Allocated</th><th>Fill</th></tr></thead>
            <tbody>${deptRows}</tbody>
          </table>
          ${noDepts ? html`<p class="muted">Add departments first.</p>` : html`<button class="btn" type="submit" style="margin-top:12px">Save headcount budget</button>`}
        </section>
      </form>`;
  } else {
    const a = allocation.money;
    const deptRows = noDepts ? raw('<tr><td colspan="4" class="muted">No departments yet.</td></tr>')
      : rows.map((r) => html`<tr>
          <td><b>${r.name}</b></td>
          <td class="right">${money(r.money.committed)}${r.money.pending ? html` <span class="muted">+${money(r.money.pending)} pending</span>` : ""}</td>
          <td><input class="tcell wide" type="number" min="0" step="1000" name="money_${r.id}" value="${env[r.id]?.money_budget ?? 0}"></td>
          <td>${bar(r.money.committed, r.money.budget, r.money.over > 0)}</td>
        </tr>`);
    body = html`${head}
      <form method="post" action="/budgets">
        ${csrfField(ctx)}<input type="hidden" name="mode" value="money">
        <section class="card">
          <h2>Company money budget</h2>
          <label>Total annual, fully-loaded, company-wide<input type="number" min="0" step="1000" name="company_money" value="${cap.money}" style="max-width:240px"></label>
        </section>
        <div class="kpis">
          <div class="kpi"><div class="lbl">Committed spend</div><div class="val">${money(company.money.committed)}</div></div>
          <div class="kpi"><div class="lbl">Allocated / cap</div><div class="val ${a.over ? "bad" : ""}">${money(a.allocated)} / ${money(cap.money)}</div><div class="lbl">${allocNote(a, "money")}</div></div>
        </div>
        <section class="card">
          <h2>Allocate money to departments</h2>
          <table class="table">
            <thead><tr><th>Department</th><th class="right">Committed</th><th>Allocated</th><th>Spend</th></tr></thead>
            <tbody>${deptRows}</tbody>
          </table>
          ${noDepts ? html`<p class="muted">Add departments first.</p>` : html`<button class="btn" type="submit" style="margin-top:12px">Save money budget</button>`}
        </section>
      </form>`;
  }
  return renderPage(ctx, { title: "Budgets", body, active: "budgets" });
}
