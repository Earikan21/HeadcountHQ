/** Workspace philosophy settings (one row, workspace 1). */
import { normalizeSettings } from "../domain/seats.js";

export function getSettings(db) {
  const row = db.prepare("SELECT * FROM workspace_settings WHERE workspace_id = 1").get();
  return row || normalizeSettings({});
}

export function updateSettings(db, fields, userId) {
  const n = normalizeSettings(fields);
  db.prepare(
    `UPDATE workspace_settings
        SET seat_mode = ?, backfill_policy = ?, company_phase = ?, industry = ?,
            updated_at = datetime('now'), updated_by = ?
      WHERE workspace_id = 1`
  ).run(n.seat_mode, n.backfill_policy, n.company_phase, n.industry, userId);
  return getSettings(db);
}
