import { html, raw } from "../html.js";
import { renderPage, csrfField, money } from "../views/ui.js";
import { requirePermission } from "../middleware.js";
import { canSetBudgets } from "../authz.js";
import { allReconciliation, getEnvelopes, setEnvelope, getCompanyBudget, setCompanyBudget } from "../repos/budgets.js";
import { listDepartments } from "../repos/departments.js";
import { getSettings } from "../repos/settings.js";
import { logAudit } from "../repos/audit.js";

export function registerBudgetRoutes(router) {
  router.get("/budgets", (ctx) => {
    if (!requirePermission(ctx, canSetBudgets)) return;
    ctx.html(200, page(ctx));
  });
  router.post("/budgets", (ctx) => {
    if (!requirePermission(ctx, canSetBudgets)) return;
    // 1) company-wide cap (top), then 2) allocations down to departments
    setCompanyBudget(ctx.db, ctx.body.company_headcount, ctx.body.company_money, ctx.user.id);
    for (const d of listDepartments(ctx.db)) {
      const hc = ctx.body[`hc_${d.id}`];
      const mny = ctx.body[`money_${d.id}`];
      if (hc !== undefined || mny !== undefined) setEnvelope(ctx.db, d.id, hc, mny, ctx.user.id);
    }
    logAudit(ctx.db, { userId: ctx.user.id, action: "budgets.updated", entity: "budget_envelope" });
    ctx.redirect("/budgets?msg=Budget+saved");
  });
}

function bar(used, budget, over) {
  const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const cls = over ? "over" : pct >= 90 ? "warn" : "ok";
  return raw(`<div class="ubar"><i class="${cls}" style="width:${pct}%"></i></div>`);
}
function allocNote(a, unit) {
  if (!a.cap) return html`<span class="muted">no company cap set</span>`;
  if (a.over > 0) return html`<span class="over-txt">over-allocated by ${unit === "money" ? money(a.over) : a.over}</span>`;
  return html`<span class="ok-txt">${unit === "money" ? money(a.remaining) : a.remaining} left to allocate</span>`;
}

function page(ctx) {
  const settings = getSettings(ctx.db);
  const cap = getCompanyBudget(ctx.db);
  const { rows, allocation, company } = allReconciliation(ctx.db);
  const env = getEnvelopes(ctx.db);

  const deptRows = rows.length ? rows.map((r) => html`<tr>
      <td><b>${r.name}</b></td>
      <td><input class="tcell" type="number" min="0" step="1" name="hc_${r.id}" value="${env[r.id]?.headcount_budget ?? 0}"></td>
      <td class="right">${r.positions.approved}${r.positions.pending ? html` <span class="muted">+${r.positions.pending}</span>` : ""}</td>
      <td>${bar(r.positions.approved, r.positions.budget, r.positions.over > 0)}</td>
      <td><input class="tcell wide" type="number" min="0" step="1000" name="money_${r.id}" value="${env[r.id]?.money_budget ?? 0}"></td>
      <td class="right">${money(r.money.committed)}${r.money.pending ? html` <span class="muted">+${money(r.money.pending)}</span>` : ""}</td>
      <td>${bar(r.money.committed, r.money.budget, r.money.over > 0)}</td>
    </tr>`) : raw('<tr><td colspan="7" class="muted">No departments yet.</td></tr>');

  const body = html`
    <div class="pagehead"><h1>Budgets &amp; reconciliation</h1>
      <p class="muted">The position economy, top-down: set <b>one company-wide budget</b>, then allocate it across departments.
      Bottom-up requests and the seats they open consume each allocation. Enforcement is <b>${settings.budget_enforcement}</b> (<a href="/philosophy">change</a>).</p>
    </div>

    <form method="post" action="/budgets">
      ${csrfField(ctx)}

      <section class="card">
        <h2>1 · Company budget</h2>
        <p class="muted small">The total cap Finance prints. Allocations below can't sensibly exceed this.</p>
        <div class="formgrid">
          <label>Total headcount budget <span class="hint">positions, company-wide</span>
            <input type="number" min="0" step="1" name="company_headcount" value="${cap.headcount}"></label>
          <label>Total money budget <span class="hint">annual, fully-loaded</span>
            <input type="number" min="0" step="1000" name="company_money" value="${cap.money}"></label>
        </div>
      </section>

      <div class="kpis">
        <div class="kpi"><div class="lbl">Headcount allocated</div><div class="val ${allocation.headcount.over ? "bad" : ""}">${allocation.headcount.allocated} / ${cap.headcount}</div><div class="lbl">${allocNote(allocation.headcount, "hc")}</div></div>
        <div class="kpi"><div class="lbl">Money allocated</div><div class="val ${allocation.money.over ? "bad" : ""}">${money(allocation.money.allocated)} / ${money(cap.money)}</div><div class="lbl">${allocNote(allocation.money, "money")}</div></div>
        <div class="kpi"><div class="lbl">Approved vs cap</div><div class="val">${company.positions.approved} / ${cap.headcount}</div></div>
        <div class="kpi"><div class="lbl">Committed vs cap</div><div class="val">${money(company.money.committed)} / ${money(cap.money)}</div></div>
      </div>

      <section class="card">
        <h2>2 · Allocate to departments</h2>
        <table class="table">
          <thead><tr><th>Department</th><th>HC alloc</th><th class="right">Approved</th><th>Fill</th><th>Money alloc</th><th class="right">Committed</th><th>Spend</th></tr></thead>
          <tbody>${deptRows}</tbody>
          ${rows.length ? html`<tfoot><tr class="totrow">
            <td><b>Allocated</b></td>
            <td class="${allocation.headcount.over ? "over-txt" : ""}"><b>${allocation.headcount.allocated}</b> / ${cap.headcount}</td>
            <td class="right">${company.positions.approved}</td><td></td>
            <td class="${allocation.money.over ? "over-txt" : ""}"><b>${money(allocation.money.allocated)}</b> / ${money(cap.money)}</td>
            <td class="right">${money(company.money.committed)}</td><td></td>
          </tr></tfoot>` : ""}
        </table>
        ${rows.length ? html`<button class="btn" type="submit" style="margin-top:12px">Save budget</button>` : html`<p class="muted">Add departments first, then allocate.</p>`}
      </section>
    </form>`;
  return renderPage(ctx, { title: "Budgets", body, active: "budgets" });
}
