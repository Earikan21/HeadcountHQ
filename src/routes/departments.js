import { html, raw } from "../html.js";
import { renderPage, csrfField, errorList } from "../views/ui.js";
import { requirePermission } from "../middleware.js";
import { canManageDepartments } from "../authz.js";
import { listDepartments, createDepartment } from "../repos/departments.js";
import { logAudit } from "../repos/audit.js";

export function registerDepartmentRoutes(router) {
  router.get("/departments", (ctx) => {
    if (!requirePermission(ctx, canManageDepartments)) return;
    ctx.html(200, page(ctx, {}));
  });
  router.post("/departments", (ctx) => {
    if (!requirePermission(ctx, canManageDepartments)) return;
    const { name = "", parent_id = "" } = ctx.body;
    if (!name.trim()) return ctx.html(400, page(ctx, { errors: ["Department name is required."] }));
    const dept = createDepartment(ctx.db, { name: name.trim(), parentId: parent_id ? Number(parent_id) : null });
    logAudit(ctx.db, { userId: ctx.user.id, action: "department.created", entity: "department", entityId: dept.id });
    ctx.redirect("/departments?msg=Department+added");
  });
}

function page(ctx, { errors }) {
  const depts = listDepartments(ctx.db);
  const byId = new Map(depts.map((d) => [d.id, d.name]));
  const rows = depts.length
    ? depts.map((d) => html`<tr><td><b>${d.name}</b></td><td>${d.parent_id ? byId.get(d.parent_id) || "—" : "—"}</td></tr>`)
    : raw('<tr><td colspan="2" class="muted">No departments yet.</td></tr>');
  const body = html`
    <div class="pagehead"><h1>Departments</h1><p class="muted">Define your org structure. Managers are scoped to a department; budgets and roll-ups group by it.</p></div>
    ${errorList(errors)}
    <div class="grid2">
      <section class="card">
        <h2>Departments</h2>
        <table class="table"><thead><tr><th>Name</th><th>Parent</th></tr></thead><tbody>${rows}</tbody></table>
      </section>
      <section class="card">
        <h2>Add a department</h2>
        <form method="post" action="/departments">
          ${csrfField(ctx)}
          <label>Name<input name="name" required></label>
          <label>Parent (optional)
            <select name="parent_id"><option value="">—</option>${depts.map((d) => html`<option value="${d.id}">${d.name}</option>`)}</select>
          </label>
          <button class="btn" type="submit">Add department</button>
        </form>
      </section>
    </div>`;
  return renderPage(ctx, { title: "Departments", body, active: "accounts" });
}
