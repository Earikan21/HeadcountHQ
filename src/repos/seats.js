/** Seat persistence + lifecycle writes. Pure decisions live in domain/seats.js. */
import { nextStatusOnVacate, countSeats } from "../domain/seats.js";
import { logAudit } from "./audit.js";

export function createSeat(db, { departmentId = null, levelId = null, title = "", status = "proposed", occupantEmployeeId = null, loadedCost = null, sourceRequestId = null }) {
  const openedAt = status === "open" || status === "filled" ? "datetime('now')" : null;
  const info = db.prepare(
    `INSERT INTO seats (department_id, level_id, title, status, occupant_employee_id, loaded_cost_estimate, source_request_id, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${openedAt ? "datetime('now')" : "NULL"})`
  ).run(departmentId, levelId, title, status, occupantEmployeeId, loadedCost, sourceRequestId);
  return getSeat(db, info.lastInsertRowid);
}

export const getSeat = (db, id) => db.prepare("SELECT * FROM seats WHERE id = ?").get(id);

export function listSeats(db, { departmentId = null } = {}) {
  const where = departmentId == null ? "WHERE s.status != 'closed'" : "WHERE s.status != 'closed' AND s.department_id = ?";
  const sql = `
    SELECT s.*, d.name AS department_name, e.name AS occupant_name
      FROM seats s
      LEFT JOIN departments d ON d.id = s.department_id
      LEFT JOIN employees e ON e.id = s.occupant_employee_id
      ${where}
     ORDER BY d.name, s.status, s.title`;
  return departmentId == null ? db.prepare(sql).all() : db.prepare(sql).all(departmentId);
}

/** All seats (incl. closed) for roll-up math, optionally dept-scoped. */
export function seatsForRollup(db, { departmentId = null } = {}) {
  const where = departmentId == null ? "" : "WHERE department_id = ?";
  const sql = `SELECT s.status, s.department_id, d.name AS department_name
                 FROM seats s LEFT JOIN departments d ON d.id = s.department_id ${where}`;
  return departmentId == null ? db.prepare(sql).all() : db.prepare(sql).all(departmentId);
}

/** Ensure an imported employee occupies a FILLED seat (create or update). */
export function ensureSeatForEmployee(db, { employeeId, departmentId, title }) {
  const emp = db.prepare("SELECT seat_id FROM employees WHERE id = ?").get(employeeId);
  if (emp && emp.seat_id) {
    db.prepare("UPDATE seats SET department_id = ?, title = ?, updated_at = datetime('now') WHERE id = ?")
      .run(departmentId, title, emp.seat_id);
    return emp.seat_id;
  }
  const seat = createSeat(db, { departmentId, title, status: "filled", occupantEmployeeId: employeeId });
  db.prepare("UPDATE employees SET seat_id = ? WHERE id = ?").run(seat.id, employeeId);
  return seat.id;
}

/** Apply the vacancy transition dictated by settings; clears occupancy. */
export function vacateSeat(db, id, settings, actorId) {
  const seat = getSeat(db, id);
  if (!seat || seat.status !== "filled") return seat;
  const next = nextStatusOnVacate({ seatMode: settings.seat_mode, backfillPolicy: settings.backfill_policy });
  db.prepare("UPDATE seats SET status = ?, occupant_employee_id = NULL, updated_at = datetime('now') WHERE id = ?").run(next, id);
  if (seat.occupant_employee_id) db.prepare("UPDATE employees SET seat_id = NULL WHERE id = ?").run(seat.occupant_employee_id);
  logAudit(db, { userId: actorId, action: "seat.vacated", entity: "seat", entityId: id, detail: { from: "filled", to: next } });
  return getSeat(db, id);
}

export function setSeatStatus(db, id, next, actorId) {
  const seat = getSeat(db, id);
  if (!seat) return null;
  db.prepare("UPDATE seats SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, id);
  if (next === "closed" && seat.occupant_employee_id) {
    db.prepare("UPDATE employees SET seat_id = NULL WHERE id = ?").run(seat.occupant_employee_id);
    db.prepare("UPDATE seats SET occupant_employee_id = NULL WHERE id = ?").run(id);
  }
  logAudit(db, { userId: actorId, action: "seat.status", entity: "seat", entityId: id, detail: { from: seat.status, to: next } });
  return getSeat(db, id);
}

/** Roll up active-vs-approved per department + company. */
export function headcountRollup(db, scope = {}) {
  const rows = seatsForRollup(db, scope);
  const byDept = new Map();
  for (const r of rows) {
    const key = r.department_name || "(none)";
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key).push(r);
  }
  const departments = [...byDept.entries()].map(([department, seats]) => ({ department, ...countSeats(seats) }))
    .sort((a, b) => b.approved - a.approved);
  return { departments, totals: countSeats(rows) };
}
