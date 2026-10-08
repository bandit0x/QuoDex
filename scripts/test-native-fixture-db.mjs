// Run with Node 24's real SQLite API, independently of the frontend jsdom runner.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openFixtureDatabase, replaceFixtureRows } from "./native-fixture-db.mjs";

test("native fixture updates can commit while the app holds a read snapshot", () => {
  const root = mkdtempSync(path.join(tmpdir(), "quodex-fixture-db-"));
  const filename = path.join(root, "state_5.sqlite");
  const writer = openFixtureDatabase(filename);
  writer.exec("CREATE TABLE threads(title TEXT); INSERT INTO threads VALUES('running');");
  const reader = new DatabaseSync(filename, { readOnly: true });
  try {
    reader.exec("BEGIN;");
    assert.equal(reader.prepare("SELECT title FROM threads").get().title, "running");
    replaceFixtureRows(writer, () => writer.exec("DELETE FROM threads; INSERT INTO threads VALUES('cancelled');"));
    assert.equal(reader.prepare("SELECT title FROM threads").get().title, "running");
    reader.exec("ROLLBACK;");
    assert.equal(reader.prepare("SELECT title FROM threads").get().title, "cancelled");
  } finally { reader.close(); writer.close(); rmSync(root, { recursive: true }); }
});

test("a failed fixture replacement preserves the previous snapshot", () => {
  const database = openFixtureDatabase(":memory:");
  try {
    database.exec("CREATE TABLE threads(title TEXT); INSERT INTO threads VALUES('running');");
    const failure = new Error("QWS-112: anonymous fixture update failed");
    assert.throws(() => replaceFixtureRows(database, () => {
      database.exec("DELETE FROM threads;");
      throw failure;
    }), error => error === failure);
    assert.equal(database.prepare("SELECT title FROM threads").get().title, "running");
  } finally { database.close(); }
});
