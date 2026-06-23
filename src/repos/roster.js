/** Data access for roster import batches, departments-by-name, and employees. */
import { getDepartment } from "./departments.js";
import { matrixToRows } from "../domain/csv.js";

// ---- import batches ----
export function createBatch(db, { filename, matrix, headerRow, mapping, createdBy }) {
  const info = db.prepare(
    `INSERT INTO import_batches (filename, status, raw_rows, mapping, header_row, row_count, created_by)
     VALUES (?, 'draft', ?, ?, ?, ?, ?)`
  ).run(filename, JSON.stringify(matrix), JSON.stringify(mapping), headerRow, Math.max(0, matrix.length - headerRow - 1), createdBy);
  return getBatch(db, info.lastInsertRowid);
}

export function getBatch(db, id) {
  const b = db.prepare("SELECT * FROM import_batches WHERE id = ?").get(id);
  if (!b) return null;
  const matrix = JSON.parse(b.raw_rows || "[]");
  const headerRow = b.header_row || 0;
  const { headers, rows } = matrixToRows(matrix, headerRow);
  return {
    ...b,
    matrix,
    headerRow,
    headers,
    rawRows: rows,
    mapping: JSON.parse(b.mapping || "{}"),
    assumptions: b.assumptions ? JSON.parse(b.assumptions) : null,
  };
}

export const setBatchHeaderRow = (db, id, headerRow, rowCount) =>
  db.prepare("UPDATE import_batches SET header_row = ?, row_count = ? WHERE id = ?").run(headerRow, rowCount, id);

export const updateBatchMapping = (db, id, mapping) =>
  db.prepare("UPDATE import_batches SET mapping = ? WHERE id = ?").run(JSON.stringify(mapping), id);

export const setBatchStatus = (db, id, status, cleanCount = null) =>
  db.prepare("UPDATE import_batches SET status = ?, clean_count = COALESCE(?, clean_count), committed_at = CASE WHEN ?='committed' THEN datetime('now') ELSE committed_at END WHERE id = ?")
    .run(status, cleanCount, status, id);

export const listBatches = (db) =>
  db.prepare("SELECT * FROM import_batches ORDER BY id DESC LIMIT 20").all();

// ---- departments by name (auto-create on import) ----
export function upsertDepartmentByName(db, name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const existing = db.prepare("SELECT id FROM departments WHERE name = ? COLLATE NOCASE").get(clean);
  if (existing) return existing.id;
  const info = db.prepare("INSERT INTO departments (name) VALUES (?)").run(clean);
  return info.lastInsertRowid;
}

// ---- employees + compensation ----
export function upsertEmployee(db, row, departmentId) {
  const info = db.prepare(
    `INSERT INTO employees (employee_ext_id, name, department_id, job_title, manager, employee_type, employment_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(workspace_id, employee_ext_id) DO UPDATE SET
       name=excluded.name, department_id=excluded.department_id, job_title=excluded.job_title,
       manager=excluded.manager, employee_type=excluded.employee_type,
       employment_status=excluded.employment_status, updated_at=datetime('now')`
  ).run(row.employee_id, row.name, departmentId, row.job_title, row.manager, row.employee_type, row.employment_status);
  // fetch id (lastInsertRowid is 0 on update path in some drivers)
  const emp = db.prepare("SELECT id FROM employees WHERE workspace_id = 1 AND employee_ext_id = ?").get(row.employee_id);
  const empId = emp.id;
  db.prepare(
    `INSERT INTO compensation (employee_id, amount, unit, annual_salary)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(employee_id) DO UPDATE SET amount=excluded.amount, unit=excluded.unit, annual_salary=excluded.annual_salary`
  ).run(empId, row.compensation_amount, row.compensation_unit, row.annual_salary);
  return empId;
}

/** List employees joined to department + compensation. Optional dept scope. */
export function listEmployees(db, { departmentId = null } = {}) {
  const where = departmentId == null ? "" : "WHERE e.department_id = ?";
  const sql = `
    SELECT e.*, d.name AS department_name,
           c.amount AS comp_amount, c.unit AS comp_unit, c.annual_salary AS annual_salary
      FROM employees e
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN compensation c ON c.employee_id = e.id
      ${where}
     ORDER BY d.name, e.name`;
  return departmentId == null ? db.prepare(sql).all() : db.prepare(sql).all(departmentId);
}

export const countEmployees = (db) =>
  db.prepare("SELECT COUNT(*) AS n FROM employees").get().n;
