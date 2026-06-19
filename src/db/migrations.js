/**
 * Ordered list of schema migrations. Each has a unique, sortable `name` and an
 * `up(db)` that applies it. Auth, roster, requests, etc. arrive as new entries
 * in later milestones — never by editing an already-applied migration.
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
];
