/**
 * Server-side sessions. The cookie holds a high-entropy opaque token; only its
 * SHA-256 hash is stored in the DB, so a leaked database does not reveal usable
 * session tokens. Each session carries a CSRF token.
 */
import { randomBytes, createHash } from "node:crypto";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Create a session; returns the raw cookie token + csrf token. */
export function createSession(db, userId, { ip = "", userAgent = "" } = {}) {
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  const id = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, csrf_token, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, csrf, expiresAt, ip, userAgent);
  return { token, csrf, expiresAt };
}

/** Resolve a cookie token to { session, user } or null if missing/expired. */
export function getSession(db, token) {
  if (!token) return null;
  const id = sha256(token);
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return null;
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  if (!user || user.status !== "active") return null;
  return { session, user };
}

export function destroySession(db, token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

export function destroyAllForUser(db, userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
