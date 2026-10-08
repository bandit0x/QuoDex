import { DatabaseSync } from "node:sqlite";

export function openFixtureDatabase(filename) {
  const database = new DatabaseSync(filename);
  // Native task readers must not block the fixture writer during state changes.
  database.exec("PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;");
  return database;
}

export function replaceFixtureRows(database, write) {
  database.exec("BEGIN IMMEDIATE;");
  try {
    write();
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
