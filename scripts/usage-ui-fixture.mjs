// QA only: anonymous on-disk source records, never reads the user's data directory.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, periodRange, sumRange, todayKey } from "../src-tauri/usage-page/usage-core.js";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function createUsageFixture() {
  const root = await mkdtemp("/private/tmp/quodex-usage-ui-");
  const today = todayKey();
  const daily = { codex: {}, zcode: {} };
  const gaps = [addDays(today, -11), addDays(today, -6)];
  await mkdir(path.join(root, "config"), { recursive: true });
  await mkdir(path.join(root, "zcode-config"), { recursive: true });
  await mkdir(path.join(root, ".zcode/cli/db"), { recursive: true });
  await mkdir(path.join(root, ".zcode/v2"), { recursive: true });
  const db = new DatabaseSync(path.join(root, ".zcode/cli/db/db.sqlite"));
  db.exec(`CREATE TABLE model_usage (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, query_source TEXT NOT NULL,
    status TEXT NOT NULL, started_at INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
    computed_total_tokens INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE session(id TEXT, parent_id TEXT, task_type TEXT);
    CREATE TABLE turn_usage(session_id TEXT, turn_id TEXT, status TEXT, started_at INTEGER, completed_at INTEGER, error_code TEXT);
    CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part(id TEXT, message_id TEXT, session_id TEXT, time_updated INTEGER, data TEXT);`);
  const insert = db.prepare("INSERT INTO model_usage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (let index = 0; index < 20; index += 1) {
    const day = addDays(today, index - 19);
    if (gaps.includes(day)) continue; // Historical missing days must remain unknown, not zero.
    const codex = 220000 + ((index * 13) % 11) * 95000;
    const zcode = 120000 + ((index * 7) % 9) * 61000;
    daily.codex[day] = codex;
    daily.zcode[day] = zcode;
    const lines = [];
    for (let request = 0; request < 2; request += 1) {
      // Local noon avoids DST/day-boundary ambiguity; each source uses its actual ingestion timestamp.
      const [year, month, date] = day.split("-").map(Number);
      const localTime = new Date(year, month - 1, date, 12, request * 3, 0, 0);
      const cTotal = request === 0 ? Math.floor(codex * 0.6) : codex - Math.floor(codex * 0.6);
      const cOutput = Math.floor(cTotal * 0.2);
      const record = {
        timestamp: localTime.toISOString(), type: "token_usage_record",
        payload: { thread_id: `qa-thread-${day}`, response_id: `qa-response-${day}-${request}`,
          usage: { input_tokens: cTotal - cOutput, output_tokens: cOutput,
            cached_input_tokens: Math.floor(cTotal * 0.1), cache_write_input_tokens: 0,
            reasoning_output_tokens: Math.floor(cOutput * 0.25), total_tokens: cTotal } },
      };
      lines.push(JSON.stringify(record));
      if (request === 0) lines.push(JSON.stringify(record)); // Exact replay must not inflate a day.
      const zTotal = request === 0 ? Math.floor(zcode * 0.55) : zcode - Math.floor(zcode * 0.55);
      const output = Math.floor(zTotal * 0.2);
      const read = Math.floor(zTotal * 0.1);
      const write = Math.floor(zTotal * 0.04);
      insert.run(`qa-z-${day}-${request}`, `qa-session-${day}`, request ? "subagent" : "main_turn",
        "completed", localTime.getTime(), zTotal - output, output,
        Math.floor(output * 0.2), write, read, zTotal);
    }
    const sourceDir = path.join(root, ".codex/sessions", day.replaceAll("-", "/"));
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, `rollout-qa-${day}.jsonl`), `${lines.join("\n")}\n`);
  }
  db.close();
  for (const [filename, schema] of [
    ["state_5.sqlite", "CREATE TABLE threads(id TEXT,title TEXT,source TEXT,originator TEXT,archived INTEGER,updated_at INTEGER); CREATE TABLE thread_spawn_edges(child_thread_id TEXT);"],
    ["thread_history_1.sqlite", "CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT,rollout_ordinal INTEGER);"],
    [".zcode/v2/tasks-index.sqlite", "CREATE TABLE tasks(workspace_key TEXT,workspace_path TEXT,workspace_identity TEXT,task_id TEXT,title TEXT,task_status TEXT,deleted INTEGER,meta_json TEXT);"],
  ]) {
    const taskDb = new DatabaseSync(path.join(root, filename));
    taskDb.exec(schema); taskDb.close();
  }
  await writeFile(path.join(root, "quota.json"), JSON.stringify({ code: 200, success: true, data: {
    limits: [{ type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 480, remaining: 1520, percentage: 24, nextResetTime: Date.now() + 7200000 },
      { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 10000, currentValue: 5800, remaining: 4200, percentage: 58, nextResetTime: Date.now() + 86400000 }], level: "pro",
  } }));
  await writeFile(path.join(root, "resets.json"), JSON.stringify({ code: 0, data: {
    available_five_hour_resets: [], available_week_resets: [],
  } }));
  const earliest = Object.keys(daily.codex).sort()[0];
  const ranges = Object.fromEntries(["7d", "30d", "3m", "6m", "1y", "total"].map(key => {
    const range = periodRange(key, today, earliest);
    const codex = sumRange(daily.codex, range.start, range.endExclusive);
    const zcode = sumRange(daily.zcode, range.start, range.endExclusive);
    return [key, { ...range, codex, zcode, merged: codex + zcode }];
  }));
  const expected = { today, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    earliest, gaps, daily, requestCount: 36, ranges };
  await writeFile(path.join(root, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
  const env = {
    ...process.env,
    ZCODE_DATA_BASE_DIR: root, CODEX_CREDITS_CONFIG_DIR: path.join(root, "config"),
    CODEX_SQLITE_HOME: root, QUODEX_TASK_IPC_ENDPOINT: path.join(root, "unused-qa.sock"),
    CODEX_CREDITS_ZCODE_CONFIG_DIR: path.join(root, "zcode-config"),
    CODEX_CREDITS_ZCODE_QUOTA_RESPONSE_FILE: path.join(root, "quota.json"),
    CODEX_CREDITS_ZCODE_RESET_RESPONSE_FILE: path.join(root, "resets.json"),
    CODEX_CREDITS_APP_SERVER_EXECUTABLE: process.execPath,
    CODEX_CREDITS_APP_SERVER_ARGS: JSON.stringify([path.join(repo, "fixtures/app-server-fixture.mjs")]),
    CODEX_CREDITS_FIXTURE_SCENARIO: "healthy", CODEX_CREDITS_FIXTURE_DELAY_MS: "0",
    CODEX_CREDITS_HEALTH_ENDPOINT: "http://127.0.0.1:9/qa-unavailable",
    CODEX_CREDITS_COUNTRY_ENDPOINT: "http://127.0.0.1:9/qa-unavailable",
  };
  return { root, expected, env };
}
