/**
 * THE authorization module. Every permission and compensation-visibility
 * decision lives here so rules cannot drift across the app. Routes and views
 * ask these functions; they never re-implement the logic.
 *
 * Roles (from the product vision):
 *   finance_admin — owns the model; sees ALL departments and EXACT salaries.
 *   c_suite       — sees ALL departments; comp as TOTALS & BANDS only.
 *   manager       — sees OWN department only; comp as BANDS only.
 */
export const ROLES = ["finance_admin", "c_suite", "manager"];

export const ROLE_LABELS = {
  finance_admin: "Finance Admin",
  c_suite: "C-Suite",
  manager: "Department Manager",
};

export function isRole(user, ...roles) {
  return !!user && roles.includes(user.role);
}

/** Account/workspace administration is the Finance Admin's alone. */
export const canManageAccounts = (u) => isRole(u, "finance_admin");
export const canManageDepartments = (u) => isRole(u, "finance_admin");
export const canImportRoster = (u) => isRole(u, "finance_admin");
export const canSetBudgets = (u) => isRole(u, "finance_admin", "c_suite");
export const canApproveRequests = (u) => isRole(u, "finance_admin", "c_suite");
export const canCreateRequest = (u) => isRole(u, "finance_admin", "manager");
export const canRunScenarios = (u) => isRole(u, "finance_admin", "c_suite");
export const canViewAudit = (u) => isRole(u, "finance_admin");
/** Who may see aggregate compensation totals (managers see headcount only). */
export const canViewCompTotals = (u) => isRole(u, "finance_admin", "c_suite");

/** 'exact' | 'bands' — how much compensation detail this user may see. */
export function compVisibility(user) {
  return isRole(user, "finance_admin") ? "exact" : "bands";
}

/** Can the user see every department, or only their own? */
export const canSeeAllDepartments = (u) => isRole(u, "finance_admin", "c_suite");

/**
 * Department id this user is limited to, or null for "all".
 * Managers are scoped to their assigned department.
 */
export function departmentScope(user) {
  if (canSeeAllDepartments(user)) return null;
  return user?.department_id ?? -1; // -1 = a department that matches nothing
}

/** Whether a user may view a given department's data. */
export function canViewDepartment(user, departmentId) {
  const scope = departmentScope(user);
  return scope === null || scope === departmentId;
}
