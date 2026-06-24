import { html, raw } from "../html.js";
import { renderPage, csrfField, money } from "../views/ui.js";
import { requirePermission } from "../middleware.js";
import { canSetBudgets } from "../authz.js";
import { allReconciliation, getEnvelopes, setEnvelope } from "../repos/budgets.js";
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
    for (const d of listDepartments(ctx.db)) {
      const hc = ctx.body[`hc_${d.id}`];
      const mny = ctx.body[`money_${d.id}`];
      if (hc !== undefined || mny !== undefined) setEnvelope(ctx.db, d.id, hc, mny, ctx.user.id);
    }
    logAudit(ctx.db, { userId: ctx.user.id, action: "budgets.updated", entity: "budget_envelope" });
    ctx.redirect("/budgets?msg=Budgets+saved");
  });
}

function bar(used, budget, over) {
  const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  const cls = over ? "over" : pct >= 90 ? "warn" : "ok";
  return raw(`<div class="ubar"><i class="${cls}" style="width:${pct}%"></i></div>`);
}

function page(ctx) {
  const settings = getSettings(ctx.db);
  const { rows, totals } = allReconciliation(ctx.db);
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
      <p class="muted">The top-down position economy: set each department's headcount and money budget. Bottom-up requests and the seats they open consume it — the gap is shown live. Enforcement is currently <b>${settings.budget_enforcement}</b> (<a href="/philosophy">change</a>).</p>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="lbl">Positions approved / budget</div><div class="val">${totals.positions.approved} / ${totals.positions.budget}</div></div>
      <div class="kpi"><div class="lbl">Committed / money budget</div><div class="val">${money(totals.money.committed)} / ${money(totals.money.budget)}</div></div>
      <div class="kpi"><div class="lbl">Pending requests</div><div class="val">${totals.positions.pending}</div></div>
    </div>
    <form method="post" action="/budgets">
      ${csrfField(ctx)}
      <section class="card">
        <table class="table">
          <thead><tr><th>Department</th><th>HC budget</th><th class="right">Approved</th><th>Fill</th><th>Money budget</th><th class="right">Committed</th><th>Spend</th></tr></thead>
          <tbody>${deptRows}</tbody>
        </table>
        ${rows.length ? html`<button class="btn" type="submit" style="margin-top:12px">Save budgets</button>` : html`<p class="muted">Add departments first.</p>`}
      </section>
    </form>`;
  return renderPage(ctx, { title: "Budgets", body, active: "budgets" });
}
