import { html, raw } from "../html.js";
import { renderPage, csrfField } from "../views/ui.js";
import { requirePermission } from "../middleware.js";
import { canManageSettings } from "../authz.js";
import { getSettings, updateSettings } from "../repos/settings.js";
import { logAudit } from "../repos/audit.js";

const PHASES = [
  ["early", "Early — pre-product-market-fit, small team"],
  ["growth", "Growth — scaling go-to-market"],
  ["mid", "Mid — multiple departments, established"],
  ["scale", "Scale — large, optimizing"],
];

export function registerSettingsRoutes(router) {
  router.get("/settings", (ctx) => {
    if (!requirePermission(ctx, canManageSettings)) return;
    ctx.html(200, page(ctx, {}));
  });
  router.post("/settings", (ctx) => {
    if (!requirePermission(ctx, canManageSettings)) return;
    updateSettings(ctx.db, {
      seat_mode: ctx.body.seat_mode,
      backfill_policy: ctx.body.backfill_policy,
      company_phase: ctx.body.company_phase,
      industry: ctx.body.industry,
    }, ctx.user.id);
    logAudit(ctx.db, { userId: ctx.user.id, action: "settings.updated", entity: "workspace_settings", entityId: 1 });
    ctx.redirect("/settings?msg=Settings+saved");
  });
}

function radio(name, value, current, label) {
  return html`<label class="radio"><input type="radio" name="${name}" value="${value}" ${current === value ? raw("checked") : ""}> ${raw(label)}</label>`;
}

function page(ctx, _opts) {
  const s = getSettings(ctx.db);
  const body = html`
    <div class="pagehead"><h1>Workspace philosophy</h1>
      <p class="muted">Set the rules of the game before modeling. These govern how approvals, vacancies, and targets behave across the workspace.</p>
    </div>
    <form method="post" action="/settings">
      ${csrfField(ctx)}
      <section class="card">
        <h2>What does approving headcount grant?</h2>
        <fieldset class="radios">
          ${radio("seat_mode", "seat", s.seat_mode, "<b>A seat</b> — the position persists when someone leaves, ready to be backfilled.")}
          ${radio("seat_mode", "person", s.seat_mode, "<b>A person</b> — when someone leaves, the headcount dissolves and re-staffing needs a new approval.")}
        </fieldset>
      </section>
      <section class="card">
        <h2>When a seat becomes vacant</h2>
        <p class="muted small">Applies in "seat" mode.</p>
        <fieldset class="radios">
          ${radio("backfill_policy", "auto", s.backfill_policy, "<b>Auto-backfill</b> — the seat reopens automatically as an open req.")}
          ${radio("backfill_policy", "reapprove", s.backfill_policy, "<b>Require re-approval</b> — the seat freezes and returns to the budget pool until re-approved.")}
        </fieldset>
      </section>
      <section class="card">
        <h2>Company phase &amp; industry</h2>
        <p class="muted small">Phase selects which target ratios apply; industry seeds benchmarks (coming in M4/M4.5).</p>
        <label>Company phase
          <select name="company_phase">
            ${PHASES.map(([v, lbl]) => html`<option value="${v}" ${s.company_phase === v ? raw("selected") : ""}>${lbl}</option>`)}
          </select>
        </label>
        <label>Industry <span class="hint">free text for now; becomes a dropdown once benchmarks are seeded</span>
          <input name="industry" value="${s.industry}" placeholder="e.g. B2B SaaS, fintech, healthtech">
        </label>
      </section>
      <button class="btn" type="submit">Save philosophy</button>
    </form>`;
  return renderPage(ctx, { title: "Settings", body, active: "settings" });
}
