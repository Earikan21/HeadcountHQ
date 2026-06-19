import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/database.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { buildApp } from "../src/app.js";

/** Start a fully-migrated app on an ephemeral port; returns { base, server, db }. */
export async function startTestServer() {
  const config = loadConfig({
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret-0123456789abcdef",
    DATABASE_PATH: ":memory:",
    COOKIE_SECURE: "false",
  });
  const db = openDb(":memory:");
  migrateToLatest(db);
  const server = buildApp({ config, db });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    server,
    db,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
