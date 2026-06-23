/**
 * Ordered list of schema migrations. Each has a unique, sortable `name` and an
 * `up(db)` that applies it. Never edit an already-applied migration — add a new
 * one.
 */

/** @typedef {{ name: string, up: (db: import("node:sqlite").DatabaseSync) => void }} Migration */

/** @type {Migration[]} */
export const MIGRATIONS = [
  {
    name: "2026_06_19_000_init",
    up(db) {
      db.exec(`
        CREATE TABLE workspaces (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.prepare("INSERT INTO workspaces (name) VALUES (?)").run("Default Workspace");
    },
  },
  {
    name: "2026_06_19_001_auth",
    up(db) {
      db.exec(`
        CREATE TABLE departments (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id    INTEGER NOT NULL DEFAULT 1,
          name            TEXT NOT NULL,
          parent_id       INTEGER,
          manager_user_id INTEGER,
          created_at      TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE users (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id          INTEGER NOT NULL DEFAULT 1,
          email                 TEXT NOT NULL UNIQUE,
          name                  TEXT NOT NULL,
          role                  TEXT NOT NULL CHECK (role IN ('finance_admin','c_suite','manager')),
          password_hash         TEXT,
          password_salt         TEXT,
          status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
          must_change_password  INTEGER NOT NULL DEFAULT 0,
          department_id         INTEGER REFERENCES departments(id),
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          last_login_at         TEXT
        );

        CREATE TABLE sessions (
          id         TEXT PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          csrf_token TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          ip         TEXT,
          user_agent TEXT
        );

        CREATE TABLE invites (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          token_hash    TEXT NOT NULL UNIQUE,
          email         TEXT NOT NULL,
          role          TEXT NOT NULL,
          department_id INTEGER,
          expires_at    TEXT NOT NULL,
          accepted_at   TEXT,
          created_by    INTEGER,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE audit_log (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          user_id      INTEGER,
          action       TEXT NOT NULL,
          entity       TEXT,
          entity_id    TEXT,
          detail       TEXT,
          created_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_sessions_user ON sessions(user_id);
        CREATE INDEX idx_audit_created ON audit_log(id DESC);
      `);
    },
  },
  {
    name: "2026_06_19_002_roster",
    up(db) {
      db.exec(`
        CREATE TABLE levels (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          name         TEXT NOT NULL,
          rank         INTEGER,
          band_min     REAL,
          band_max     REAL
        );

        CREATE TABLE employees (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id      INTEGER NOT NULL DEFAULT 1,
          employee_ext_id   TEXT NOT NULL,
          name              TEXT NOT NULL,
          department_id     INTEGER REFERENCES departments(id),
          job_title         TEXT,
          manager           TEXT,
          employee_type     TEXT,
          employment_status TEXT,
          level_id          INTEGER REFERENCES levels(id),
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX idx_emp_ext ON employees(workspace_id, employee_ext_id);

        -- Sensitive compensation is split into its own table so the authz layer
        -- can withhold it cleanly from roles that may not see exact figures.
        CREATE TABLE compensation (
          employee_id   INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
          amount        REAL,
          unit          TEXT,
          annual_salary REAL
        );

        CREATE TABLE import_batches (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          filename     TEXT,
          status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','committed','discarded')),
          headers      TEXT,
          raw_rows     TEXT,
          mapping      TEXT,
          assumptions  TEXT,
          row_count    INTEGER DEFAULT 0,
          clean_count  INTEGER DEFAULT 0,
          created_by   INTEGER,
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          committed_at TEXT
        );
        CREATE INDEX idx_emp_dept ON employees(department_id);
      `);
    },
  },
  {
    name: "2026_06_19_003_import_header_row",
    up(db) {
      db.exec(`ALTER TABLE import_batches ADD COLUMN header_row INTEGER NOT NULL DEFAULT 0;`);
    },
  },
];
