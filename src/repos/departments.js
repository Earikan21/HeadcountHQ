export const listDepartments = (db) =>
  db.prepare("SELECT * FROM departments ORDER BY name").all();

export const getDepartment = (db, id) =>
  db.prepare("SELECT * FROM departments WHERE id = ?").get(id);

export function createDepartment(db, { name, parentId = null, managerUserId = null }) {
  const info = db.prepare(
    "INSERT INTO departments (name, parent_id, manager_user_id) VALUES (?, ?, ?)"
  ).run(name, parentId, managerUserId);
  return getDepartment(db, info.lastInsertRowid);
}
