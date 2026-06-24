import { html, raw } from "../html.js";
import { renderPage, csrfField, money } from "../views/ui.js";
import { requirePermission } from "../middleware.js";
import { canManageSettings } from "../authz.js";
import { getSettings, updateSettings } from "../repos/settings.js";
import { getDepartmentTargets, saveDepartmentTargets } from "../repos/targets.js";
import { listDepartments } from "../repos/departments.js";
import { headcountRollup } from "../repos/seats.js";
import * as P from "../domain/philosophy.js";
import { logAudit } from "../repos/audit.js";

const PHASE_LABELS = {
  early: "Early — pre-PMF, small team", growth: "Growth — scaling go-to-market",
  mid: "Mid — multiple departments", scale: "Scale — large, optimizing",
};

export function registerPhilosophyRoutes(router) {
  router.get("/settings", (ctx) => ctx.redirect("/philosophy"));

  router.get("/philosophy", (ctx) => {
    if (!requirePermission(ctx, canManageSettings)) return;
    ctx.html(200, page(ctx));
  });

  // Core parameters
  router.post("/philosophy", (ctx) => {
    if (!requirePermission(ctx, canManageSettings)) return;
    updateSettings(ctx.db, ctx.body, ctx.user.id);
    logAudit(ctx.db, { userId: ctx.user.id, action: "philosophy.updated", entity: "workspace_settings", entityId: 1 });
    ctx.redirect("/philosophy?msg=Philosophy+saved");
  });

  // Apply phase suggestions to the scalar params
  router.post("/philosophy/apply-phase", (ctx) => {
    if (!requirePermission(ctx, canManageSettings)) return;
    const s = getSettings(ctx.db);
    const sug = P.phaseSuggestions(s.company_phase);
    updateSettings(ctx.db, { ...s, ...sug }, ctx.user.id);
    ctx.redirect("/philosophy?msg=Applied+phase+suggestions");
  });

  // Department target balance — direct manual edit
  router.post("/philosophy/targets", (ctx) => {
    if (!requirePermission(ctx, canManageSettings)) return;
    const targets = {};
    for (const [k, v] of Object.entries(ctx.body)) {
      if (k.startsWith("target_") && k !== "target_span_of_control") {
        targets[decodeURIComponent(k.slice("target_".length))] = v;
      }
    }
    saveDepartmentTargets(ctx.db, targets, "manual", ctx.user.id);
    logAudit(ctx.db, { userId: ctx.user.id, action: "targets.updated", entity: "target_ratios", detail: { keys: Object.keys(targets) } });
    ctx.redirect("/philosophy?msg=Target+balance+saved");
  });

  // Seed a suggested starting balance from the function benchmarks
  router.post("/philosophy/targets/suggest", (ctx) => {
    if (!requirePermission(ctx, canManageSettings)) return;
    const names = listDepartments(ctx.db).map((d) => d.name);
    const sug = P.suggestDepartmentTargets(names);
    saveDepartmentTargets(ctx.db, sug, "default", ctx.user.id);
    ctx.redirect("/philosophy?msg=Suggested+balance+applied+-+now+edit+freely");
  });
}

function num(name, label, value, attrs = "", hint = "") {
  return html`<label>${label} ${hint ? html`<span class="hint">${hint}</span>` : ""}
    <input type="number" name="${name}" value="${value}" ${raw(attrs)}></label>`;
}
function radio(name, value, current, label) {
  return html`<label class="radio"><input type="radio" name="${name}" value="${value}" ${String(current) === value ? raw("checked") : ""}> ${raw(label)}</label>`;
}

function page(ctx) {
  const s = getSettings(ctx.db);
  const depts = listDepartments(ctx.db);
  const targets = getDepartmentTargets(ctx.db);

  // actual department distribution from filled seats
  const roll = headcountRollup(ctx.db);
  const actualByDept = {};
  for (const d of roll.departments) actualByDept[d.department] = d.active;
  const targetByDept = {};
  for (const [k, v] of Object.entries(targets)) targetByDept[k] = v.target_pct;
  const mix = P.mixVsTarget(actualByDept, targetByDept);
  const targetSum = Object.values(targetByDept).reduce((a, b) => a + b, 0);

  const targetRows = depts.length ? depts.map((d) => {
    const row = mix.find((m) => m.name === d.name) || { actualPct: 0, variance: null };
    const tv = targets[d.name]?.target_pct ?? "";
    return html`<tr>
      <td><b>${d.name}</b></td>
      <td class="right muted">${row.actualPct}%</td>
      <td class="right"><input class="tcell" type="number" step="0.1" min="0" max="100" name="target_${encodeURIComponent(d.name)}" value="${tv}"></td>
      <td class="right">${row.variance == null ? "—" : varianceBadge(row.variance)}</td>
    </tr>`;
  }) : raw('<tr><td colspan="4" class="muted">Add departments (via the roster import) to set a target balance.</td></tr>');

  const body = html`
    <div class="pagehead">
      <h1>Headcount philosophy</h1>
      <p class="muted">The rules of the game — set these <b>before</b> modeling. Everything downstream
      (seats, requests, dashboards, runway) reads from here. Phase &amp; industry only suggest
      starting points; you have direct control over every value.</p>
    </div>

    <form method="post" action="/philosophy">
      ${csrfField(ctx)}
      <section class="card">
        <h2>Unit of approval &amp; backfill</h2>
        <fieldset class="radios">
          ${radio("seat_mode", "seat", s.seat_mode, "<b>Seat</b> — the position persists when someone leaves, ready to backfill.")}
          ${radio("seat_mode", "person", s.seat_mode, "<b>Person</b> — when someone leaves, the headcount dissolves; re-staffing needs a new approval.")}
        </fieldset>
        <fieldset class="radios">
          ${radio("backfill_policy", "auto", s.backfill_policy, "<b>Auto-backfill</b> a vacated seat (reopens as a req).")}
          ${radio("backfill_policy", "reapprove", s.backfill_policy, "<b>Require re-approval</b> — vacated seat freezes to the budget pool.")}
        </fieldset>
        <label class="radio"><input type="checkbox" name="require_csuite_approval" ${s.require_csuite_approval ? raw("checked") : ""}> New seats require C-suite approval</label>
      </section>

      <section class="card">
        <h2>Org shape</h2>
        <p class="muted small">Research: healthy span is ~5–10 (wider for standardized work); most orgs run 5–7 layers, &gt;8 is a red flag.</p>
        <div class="formgrid">
          ${num("target_span_of_control", "Target span of control", s.target_span_of_control, 'min="1" max="20" step="1"', "direct reports / manager")}
          ${num("max_layers", "Max management layers", s.max_layers, 'min="1" max="12" step="1"', "CEO → frontline")}
        </div>
      </section>

      <section class="card">
        <h2>Cost &amp; planning assumptions</h2>
        <p class="muted small">Fully-loaded cost is typically 1.25–1.4× base (higher for execs). Attrition drives backfills before any growth.</p>
        <div class="formgrid">
          ${num("loaded_cost_multiplier", "Fully-loaded cost multiplier", s.loaded_cost_multiplier, 'min="1" max="3" step="0.01"', "× base salary")}
          ${num("annual_attrition_pct", "Assumed annual attrition", s.annual_attrition_pct, 'min="0" max="100" step="0.5"', "% / year")}
          ${num("contractor_target_pct", "Target contractor mix", s.contractor_target_pct, 'min="0" max="100" step="1"', "% contingent")}
        </div>
        <fieldset class="radios" style="margin-top:10px">
          ${radio("budgeting_approach", "incremental", s.budgeting_approach, "<b>Incremental</b> — build on last cycle's plan.")}
          ${radio("budgeting_approach", "zero_based", s.budgeting_approach, "<b>Zero-based</b> — re-justify every seat each cycle.")}
        </fieldset>
      </section>

      <section class="card">
        <h2>Company phase &amp; industry</h2>
        <div class="formgrid">
          <label>Company phase
            <select name="company_phase">
              ${P.PHASES.map((v) => html`<option value="${v}" ${s.company_phase === v ? raw("selected") : ""}>${PHASE_LABELS[v]}</option>`)}
            </select>
          </label>
          <label>Industry <span class="hint">becomes a dropdown once benchmarks are seeded (M4.5)</span>
            <input name="industry" value="${s.industry}" placeholder="e.g. B2B SaaS, fintech, healthtech">
          </label>
        </div>
      </section>

      <button class="btn" type="submit">Save philosophy</button>
    </form>

    <form method="post" action="/philosophy/apply-phase" class="inline" style="margin-left:8px">
      ${csrfField(ctx)}<button class="btn ghost" type="submit">Apply ${s.company_phase}-phase suggestions to org shape &amp; cost</button>
    </form>

    <section class="card" style="margin-top:18px">
      <div class="row-between">
        <div><h2>Target balance (you control this directly)</h2>
          <p class="muted small">Each department's intended share of headcount. Edit any value; "Suggest a starting balance" seeds research-based defaults you can then override. Targets sum: <b>${Math.round(targetSum * 10) / 10}%</b>.</p>
        </div>
        ${depts.length ? html`<form method="post" action="/philosophy/targets/suggest" class="inline">
          ${csrfField(ctx)}<button class="btn ghost sm" type="submit">Suggest a starting balance</button>
        </form>` : ""}
      </div>
      <form method="post" action="/philosophy/targets">
        ${csrfField(ctx)}
        <table class="table">
          <thead><tr><th>Department</th><th class="right">Actual</th><th class="right">Target %</th><th class="right">Variance</th></tr></thead>
          <tbody>${targetRows}</tbody>
        </table>
        ${depts.length ? html`<button class="btn" type="submit" style="margin-top:12px">Save target balance</button>` : ""}
      </form>
    </section>`;
  return renderPage(ctx, { title: "Philosophy", body, active: "philosophy" });
}

function varianceBadge(v) {
  if (Math.abs(v) < 2) return html`<span class="pill ok2">on target</span>`;
  return v > 0
    ? html`<span class="pill warn2">+${v}% over</span>`
    : html`<span class="pill off">${v}% under</span>`;
}
