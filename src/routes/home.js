import { html, raw } from "../html.js";
import { renderPage } from "../views/ui.js";
import { countUsers } from "../repos/users.js";
import { listDepartments } from "../repos/departments.js";
import { ROLE_LABELS } from "../authz.js";

export function registerHomeRoutes(router) {
  router.get("/", (ctx) => {
    if (!ctx.user) {
      return ctx.redirect(countUsers(ctx.db) === 0 ? "/setup" : "/login");
    }
    const depts = listDepartments(ctx.db).length;
    const people = countUsers(ctx.db);
    const isAdmin = ctx.user.role === "finance_admin";

    const tiles = [
      tile("Roster", "Import and review your current people & compensation.", "/roster"),
      tile("Hiring requests", "Submit and track structured requests for new roles.", "/requests"),
    ];
    if (ctx.user.role !== "manager") tiles.push(tile("Planning", "Budgets, scenarios, and runway.", "/planning"));
    if (isAdmin) tiles.push(tile("Accounts", "Manage who can sign in.", "/accounts"));

    const body = html`
      <div class="pagehead">
        <h1>Welcome, ${ctx.user.name.split(" ")[0]}</h1>
        <p class="muted">You're signed in as <b>${ROLE_LABELS[ctx.user.role]}</b>. ${roleNote(ctx.user.role)}</p>
      </div>
      <div class="kpis">
        ${kpi("People with access", people)}
        ${kpi("Departments", depts)}
      </div>
      <div class="tiles">${tiles}</div>
      ${depts === 0 && isAdmin ? html`<div class="flash">Get started by adding your <a href="/departments">departments</a>, then importing your <a href="/roster">roster</a>.</div>` : ""}
    `;
    return ctx.html(200, renderPage(ctx, { title: "Dashboard", body, active: "dashboard" }));
  });
}

const roleNote = (role) =>
  role === "finance_admin" ? "You can see exact compensation and manage everything."
  : role === "c_suite" ? "You see all departments with compensation as totals and bands."
  : "You see your own department, with compensation shown as bands.";

const tile = (title, desc, href) => html`<a class="tile" href="${href}"><b>${title}</b><span>${desc}</span></a>`;
const kpi = (label, val) => html`<div class="kpi"><div class="lbl">${label}</div><div class="val">${val}</div></div>`;
