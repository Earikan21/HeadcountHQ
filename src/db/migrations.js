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
  {
    name: "2026_06_24_004_seats",
    up(db) {
      db.exec(`
        CREATE TABLE workspace_settings (
          workspace_id    INTEGER PRIMARY KEY DEFAULT 1,
          seat_mode       TEXT NOT NULL DEFAULT 'seat'   CHECK (seat_mode IN ('seat','person')),
          backfill_policy TEXT NOT NULL DEFAULT 'auto'   CHECK (backfill_policy IN ('auto','reapprove')),
          company_phase   TEXT NOT NULL DEFAULT 'early'  CHECK (company_phase IN ('early','growth','mid','scale')),
          industry        TEXT NOT NULL DEFAULT '',
          updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
          updated_by      INTEGER
        );
        INSERT INTO workspace_settings (workspace_id) VALUES (1);

        CREATE TABLE seats (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id         INTEGER NOT NULL DEFAULT 1,
          department_id        INTEGER REFERENCES departments(id),
          level_id             INTEGER REFERENCES levels(id),
          title                TEXT,
          status               TEXT NOT NULL DEFAULT 'proposed'
                                 CHECK (status IN ('proposed','approved','open','filled','frozen','closed')),
          occupant_employee_id INTEGER REFERENCES employees(id),
          loaded_cost_estimate REAL,
          source_request_id    INTEGER,
          opened_at            TEXT,
          created_at           TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_seats_dept ON seats(department_id);
        CREATE INDEX idx_seats_status ON seats(status);

        ALTER TABLE employees ADD COLUMN seat_id INTEGER REFERENCES seats(id);
      `);
    },
  },
  {
    name: "2026_06_24_005_philosophy",
    up(db) {
      db.exec(`
        ALTER TABLE workspace_settings ADD COLUMN target_span_of_control  REAL    NOT NULL DEFAULT 6;
        ALTER TABLE workspace_settings ADD COLUMN max_layers              INTEGER NOT NULL DEFAULT 6;
        ALTER TABLE workspace_settings ADD COLUMN loaded_cost_multiplier  REAL    NOT NULL DEFAULT 1.3;
        ALTER TABLE workspace_settings ADD COLUMN annual_attrition_pct    REAL    NOT NULL DEFAULT 10;
        ALTER TABLE workspace_settings ADD COLUMN contractor_target_pct   REAL    NOT NULL DEFAULT 0;
        ALTER TABLE workspace_settings ADD COLUMN budgeting_approach      TEXT    NOT NULL DEFAULT 'incremental';
        ALTER TABLE workspace_settings ADD COLUMN require_csuite_approval INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE target_ratios (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          family       TEXT NOT NULL,        -- 'department_mix'
          key          TEXT NOT NULL,        -- department name
          target_pct   REAL NOT NULL,
          source       TEXT NOT NULL DEFAULT 'manual',  -- 'default' | 'manual'
          updated_by   INTEGER,
          updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (workspace_id, family, key)
        );
      `);
    },
  },
  {
    name: "2026_06_24_006_requests",
    up(db) {
      db.exec(`
        ALTER TABLE workspace_settings ADD COLUMN budget_enforcement TEXT NOT NULL DEFAULT 'soft'
          CHECK (budget_enforcement IN ('soft','hard'));

        CREATE TABLE budget_envelopes (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id     INTEGER NOT NULL DEFAULT 1,
          department_id    INTEGER REFERENCES departments(id),
          period           TEXT NOT NULL DEFAULT 'current',
          headcount_budget INTEGER NOT NULL DEFAULT 0,
          money_budget     REAL NOT NULL DEFAULT 0,
          set_by           INTEGER,
          updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (workspace_id, department_id, period)
        );

        CREATE TABLE hiring_requests (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id          INTEGER NOT NULL DEFAULT 1,
          department_id         INTEGER REFERENCES departments(id),
          title                 TEXT NOT NULL,
          level_id              INTEGER REFERENCES levels(id),
          band_min              REAL,
          band_max              REAL,
          target_start_month    TEXT,
          type                  TEXT NOT NULL CHECK (type IN ('net_new','backfill')),
          justification         TEXT,
          current_hc_narrative  TEXT,
          new_hc_narrative      TEXT,
          expected_value_basis  TEXT,
          expected_value_amount REAL,
          estimated_cost        REAL,
          status                TEXT NOT NULL DEFAULT 'submitted'
                                 CHECK (status IN ('submitted','under_review','approved','deferred','declined')),
          requester_id          INTEGER,
          decided_by            INTEGER,
          decided_at            TEXT,
          decision_note         TEXT,
          seat_id               INTEGER REFERENCES seats(id),
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE request_status_history (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id  INTEGER NOT NULL REFERENCES hiring_requests(id) ON DELETE CASCADE,
          from_status TEXT,
          to_status   TEXT NOT NULL,
          actor_id    INTEGER,
          note        TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_req_dept ON hiring_requests(department_id);
        CREATE INDEX idx_req_status ON hiring_requests(status);
      `);
    },
  },
];
