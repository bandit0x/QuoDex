//! Durable, request-level synchronization. Transport never owns the usage totals.

use crate::capacity::Diagnostic;
use crate::usage_ledger::{local_day, UsageEvent, UsageLedger};
use chrono::FixedOffset;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

pub const MAX_BATCH_BYTES: usize = 1024 * 1024;
pub const MAX_BATCH_RECORDS: usize = 1000;

pub fn error(code: &'static str, message: &str) -> Diagnostic {
    Diagnostic::new(code, message)
}
fn storage(_: rusqlite::Error) -> Diagnostic {
    error(
        "QDS-109",
        "同步账本无法保存；请检查本机磁盘空间和权限后重试",
    )
}
fn malformed() -> Diagnostic {
    error(
        "QDS-105",
        "同步文件格式或校验值不正确；已保留本机账本，请更新或重试",
    )
}
pub fn digest(value: &impl Serialize) -> String {
    crate::usage_sources::sha256_hex(&serde_json::to_vec(value).expect("serializable sync value"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Record {
    pub source: String,
    pub timestamp: i64,
    pub total: i64,
    pub input: i64,
    pub output: i64,
    pub cached: i64,
    pub reasoning: i64,
}
impl From<&UsageEvent> for Record {
    fn from(e: &UsageEvent) -> Self {
        Self {
            source: e.source.into(),
            timestamp: e.source_ts_ms,
            total: e.total_tokens,
            input: e.input_tokens,
            output: e.output_tokens,
            cached: e.cached_input_tokens,
            reasoning: e.reasoning_tokens,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Observation {
    pub id: String,
    pub key: String,
    pub observer: String,
    pub previous: Option<String>,
    pub record: Record,
}
impl Observation {
    fn checksum(&self) -> String {
        digest(&(&self.key, &self.observer, &self.previous, &self.record))
    }
    fn valid(&self) -> bool {
        let r = &self.record;
        self.id == self.checksum()
            && self.key.len() == 64
            && self.key.bytes().all(|c| c.is_ascii_hexdigit())
            && uuid::Uuid::parse_str(&self.observer).is_ok()
            && self
                .previous
                .as_ref()
                .is_none_or(|p| p.len() == 64 && p != &self.id)
            && matches!(r.source.as_str(), "codex" | "zcode")
            && r.timestamp > 0
            && r.timestamp < 253_402_300_800_000
            && [r.total, r.input, r.output, r.cached, r.reasoning]
                .iter()
                .all(|v| *v >= 0 && *v <= 9_007_199_254_740_991)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Batch {
    pub schema: u32,
    pub space: String,
    pub id: String,
    pub observations: Vec<Observation>,
    pub checksum: String,
}
impl Batch {
    fn checksum(&self) -> String {
        digest(&(self.schema, &self.space, &self.id, &self.observations))
    }
    pub fn encode(&self) -> Result<Vec<u8>, Diagnostic> {
        serde_json::to_vec(self).map_err(|_| malformed())
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, Diagnostic> {
        if bytes.len() > MAX_BATCH_BYTES {
            return Err(malformed());
        }
        let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| malformed())?;
        if value["schema"].as_u64().is_some_and(|n| n != 1) {
            return Err(error(
                "QDS-110",
                "此账本使用新版同步协议；本机继续记账，请升级 QuoDex",
            ));
        }
        serde_json::from_value(value).map_err(|_| malformed())
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub codex: BTreeMap<String, i64>,
    pub zcode: BTreeMap<String, i64>,
    pub codex_count: u64,
    pub zcode_count: u64,
    pub conflicts: u64,
    pub incomplete: u64,
    pub unidentified: u64,
}

pub fn initialize(conn: &Connection) -> Result<(), Diagnostic> {
    let tx = conn.unchecked_transaction().map_err(storage)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS sync_observations (
        id TEXT PRIMARY KEY, event_key TEXT NOT NULL, observer TEXT NOT NULL,
        body TEXT NOT NULL, local INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS sync_event_key ON sync_observations(event_key);
        CREATE TABLE IF NOT EXISTS sync_identity (source TEXT NOT NULL, request_key TEXT NOT NULL,
            event_key TEXT NOT NULL, PRIMARY KEY(source, request_key));
        CREATE TABLE IF NOT EXISTS sync_heads (event_key TEXT PRIMARY KEY, observation_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_batches (id TEXT PRIMARY KEY, space TEXT NOT NULL, body TEXT NOT NULL, ack INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sync_members (space TEXT NOT NULL, observation_id TEXT NOT NULL, batch_id TEXT NOT NULL,
            PRIMARY KEY(space, observation_id));
        CREATE TABLE IF NOT EXISTS sync_inbox (space TEXT NOT NULL, id TEXT NOT NULL, checksum TEXT NOT NULL,
            PRIMARY KEY(space,id));").map_err(storage)?;
    tx.execute(
        "INSERT OR IGNORE INTO usage_meta VALUES ('sync.observer', ?1)",
        [uuid::Uuid::new_v4().to_string()],
    )
    .map_err(storage)?;
    // Additive migration: never rewrite/delete the original request rows.
    let mut statement = tx.prepare("SELECT source,request_key,source_ts_ms,total_tokens,input_tokens,output_tokens,cached_input_tokens,reasoning_tokens FROM usage_events").map_err(storage)?;
    let rows = statement
        .query_map([], |r| {
            Ok(UsageEvent {
                source: if r.get::<_, String>(0)? == "codex" {
                    "codex"
                } else {
                    "zcode"
                },
                request_key: r.get(1)?,
                source_ts_ms: r.get(2)?,
                total_tokens: r.get(3)?,
                input_tokens: r.get(4)?,
                output_tokens: r.get(5)?,
                cached_input_tokens: r.get(6)?,
                reasoning_tokens: r.get(7)?,
            })
        })
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    drop(statement);
    for event in rows {
        observe(&tx, &event, false)?;
    }
    tx.commit().map_err(storage)
}

/// Called inside the same transaction as the local usage write.
pub fn observe(
    conn: &Connection,
    event: &UsageEvent,
    immutable_conflict: bool,
) -> Result<(), Diagnostic> {
    let key = if event.source == "codex" {
        event
            .request_key
            .strip_prefix("codex:")
            .and_then(|s| s.split_once(':'))
            .filter(|(t, r)| !t.is_empty() && !r.is_empty() && !r.contains(':'))
            .map(|(t, r)| digest(&("codex", t, r)))
    } else {
        conn.query_row(
            "SELECT event_key FROM sync_identity WHERE source=?1 AND request_key=?2",
            params![event.source, event.request_key],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(storage)?
    };
    let Some(key) = key else {
        return Ok(());
    };
    let record = Record::from(event);
    let previous: Option<String> = conn
        .query_row(
            "SELECT observation_id FROM sync_heads WHERE event_key=?1",
            [&key],
            |r| r.get(0),
        )
        .optional()
        .map_err(storage)?;
    if let Some(id) = &previous {
        let body: String = conn
            .query_row(
                "SELECT body FROM sync_observations WHERE id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(storage)?;
        let old: Observation = serde_json::from_str(&body).map_err(|_| malformed())?;
        if old.record == record {
            return Ok(());
        }
    }
    let observer: String = conn
        .query_row(
            "SELECT value FROM usage_meta WHERE key='sync.observer'",
            [],
            |r| r.get(0),
        )
        .map_err(storage)?;
    let mut observation = Observation {
        id: String::new(),
        key: key.clone(),
        observer,
        previous: if immutable_conflict { None } else { previous },
        record,
    };
    observation.id = observation.checksum();
    if !observation.valid() {
        return Ok(());
    } // Retained locally; counted as unidentified below.
    conn.execute(
        "INSERT OR IGNORE INTO sync_observations VALUES (?1,?2,?3,?4,1)",
        params![
            observation.id,
            key,
            observation.observer,
            serde_json::to_string(&observation).map_err(|_| malformed())?
        ],
    )
    .map_err(storage)?;
    if !immutable_conflict {
        conn.execute("INSERT INTO sync_heads VALUES (?1,?2) ON CONFLICT(event_key) DO UPDATE SET observation_id=excluded.observation_id",
            params![key, observation.id]).map_err(storage)?;
    }
    conn.execute(
        "INSERT OR IGNORE INTO sync_identity VALUES (?1,?2,?3)",
        params![event.source, event.request_key, key],
    )
    .map_err(storage)?;
    Ok(())
}

impl UsageLedger {
    pub fn identify_zcode(
        &self,
        request_key: &str,
        session: &str,
        id: &str,
    ) -> Result<(), Diagnostic> {
        if session.is_empty() || id.is_empty() {
            return Ok(());
        }
        let key = digest(&("zcode", session, id));
        self.conn.execute("INSERT INTO sync_identity VALUES ('zcode',?1,?2) ON CONFLICT(source,request_key) DO UPDATE SET event_key=excluded.event_key",
            params![request_key,key]).map_err(storage)?;
        Ok(())
    }

    pub fn sync_batch(&self, space: &str) -> Result<Option<Batch>, Diagnostic> {
        let pending: Option<String> = self
            .conn
            .query_row(
                "SELECT body FROM sync_batches WHERE space=?1 AND ack=0 ORDER BY rowid LIMIT 1",
                [space],
                |r| r.get(0),
            )
            .optional()
            .map_err(storage)?;
        if let Some(body) = pending {
            return Batch::decode(body.as_bytes()).map(Some);
        }
        let tx = self.conn.unchecked_transaction().map_err(storage)?;
        let mut query = tx.prepare("SELECT body FROM sync_observations o WHERE local=1 AND NOT EXISTS
            (SELECT 1 FROM sync_members m WHERE m.space=?1 AND m.observation_id=o.id) ORDER BY o.rowid LIMIT 1000").map_err(storage)?;
        let rows = query
            .query_map([space], |r| r.get::<_, String>(0))
            .map_err(storage)?;
        let mut observations = Vec::new();
        let mut bytes = 0;
        for row in rows {
            let body = row.map_err(storage)?;
            bytes += body.len();
            if bytes > MAX_BATCH_BYTES - 4096 {
                break;
            }
            observations.push(serde_json::from_str(&body).map_err(|_| malformed())?);
        }
        drop(query);
        if observations.is_empty() {
            return Ok(None);
        }
        let mut batch = Batch {
            schema: 1,
            space: space.into(),
            id: uuid::Uuid::new_v4().to_string(),
            observations,
            checksum: String::new(),
        };
        batch.checksum = batch.checksum();
        tx.execute(
            "INSERT INTO sync_batches(id,space,body) VALUES (?1,?2,?3)",
            params![
                batch.id,
                space,
                String::from_utf8(batch.encode()?).map_err(|_| malformed())?
            ],
        )
        .map_err(storage)?;
        for observation in &batch.observations {
            tx.execute(
                "INSERT INTO sync_members VALUES (?1,?2,?3)",
                params![space, observation.id, batch.id],
            )
            .map_err(storage)?;
        }
        tx.commit().map_err(storage)?;
        Ok(Some(batch))
    }

    pub fn sync_ack(&self, space: &str, id: &str) -> Result<(), Diagnostic> {
        self.conn
            .execute(
                "UPDATE sync_batches SET ack=1 WHERE space=?1 AND id=?2",
                params![space, id],
            )
            .map_err(storage)?;
        Ok(())
    }
    pub fn sync_has_batch(&self, space: &str, id: &str) -> Result<bool, Diagnostic> {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_inbox WHERE space=?1 AND id=?2)",
                params![space, id],
                |r| r.get(0),
            )
            .map_err(storage)
    }
    pub fn sync_pending(&self, space: &str) -> Result<u64, Diagnostic> {
        self.conn.query_row("SELECT COUNT(*) FROM sync_observations o WHERE local=1 AND NOT EXISTS
            (SELECT 1 FROM sync_members m JOIN sync_batches b ON m.batch_id=b.id WHERE m.space=?1 AND m.observation_id=o.id AND b.ack=1)",
            [space], |r| r.get::<_,i64>(0).map(|n| n as u64)).map_err(storage)
    }
    pub fn sync_import(&self, space: &str, batch: &Batch) -> Result<(), Diagnostic> {
        if batch.schema != 1 {
            return Err(error(
                "QDS-110",
                "此账本使用新版同步协议；本机继续记账，请升级 QuoDex",
            ));
        }
        if batch.space != space {
            return Err(error("QDS-107", "同步空间不匹配；请检查所连接的个人账本"));
        }
        if uuid::Uuid::parse_str(&batch.id).is_err()
            || batch.observations.len() > MAX_BATCH_RECORDS
            || batch.checksum != batch.checksum()
            || batch.encode()?.len() > MAX_BATCH_BYTES
            || batch.observations.iter().any(|o| !o.valid())
        {
            return Err(malformed());
        }
        let tx = self.conn.unchecked_transaction().map_err(storage)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT checksum FROM sync_inbox WHERE space=?1 AND id=?2",
                params![space, batch.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(storage)?;
        if let Some(sum) = existing {
            return if sum == batch.checksum {
                Ok(())
            } else {
                Err(malformed())
            };
        }
        for observation in &batch.observations {
            tx.execute(
                "INSERT OR IGNORE INTO sync_observations VALUES (?1,?2,?3,?4,0)",
                params![
                    observation.id,
                    observation.key,
                    observation.observer,
                    serde_json::to_string(observation).map_err(|_| malformed())?
                ],
            )
            .map_err(storage)?;
        }
        tx.execute(
            "INSERT INTO sync_inbox VALUES (?1,?2,?3)",
            params![space, batch.id, batch.checksum],
        )
        .map_err(storage)?;
        tx.commit().map_err(storage)
    }

    pub fn sync_totals(&self) -> Result<Totals, Diagnostic> {
        let mut groups: BTreeMap<String, Vec<Observation>> = BTreeMap::new();
        let mut stmt = self
            .conn
            .prepare("SELECT body FROM sync_observations")
            .map_err(storage)?;
        for row in stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(storage)?
        {
            let observation: Observation =
                serde_json::from_str(&row.map_err(storage)?).map_err(|_| malformed())?;
            groups
                .entry(observation.key.clone())
                .or_default()
                .push(observation);
        }
        let mut result = Totals::default();
        result.unidentified = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM usage_events e WHERE NOT EXISTS
            (SELECT 1 FROM sync_identity i JOIN sync_observations o ON i.event_key=o.event_key
             WHERE i.source=e.source AND i.request_key=e.request_key)",
                [],
                |r| r.get::<_, i64>(0).map(|n| n as u64),
            )
            .map_err(storage)?;
        for observations in groups.values() {
            let by_id: HashMap<_, _> = observations.iter().map(|o| (o.id.as_str(), o)).collect();
            let mut parents = HashSet::new();
            let mut incomplete = false;
            for o in observations {
                if let Some(id) = &o.previous {
                    match by_id.get(id.as_str()) {
                        Some(parent) if parent.observer == o.observer => {
                            parents.insert(id.as_str());
                        }
                        _ => incomplete = true,
                    }
                }
            }
            if incomplete {
                result.incomplete += 1;
                continue;
            }
            let heads: Vec<_> = observations
                .iter()
                .filter(|o| !parents.contains(o.id.as_str()))
                .collect();
            let mut writers = HashSet::new();
            if heads.is_empty()
                || heads.iter().any(|o| !writers.insert(&o.observer))
                || heads.iter().any(|o| o.record != heads[0].record)
            {
                result.conflicts += 1;
                continue;
            }
            let record = &heads[0].record;
            let day = local_day(record.timestamp, FixedOffset::east_opt(8 * 3600).unwrap());
            let days = if record.source == "codex" {
                result.codex_count += 1;
                &mut result.codex
            } else {
                result.zcode_count += 1;
                &mut result.zcode
            };
            let value = days.entry(day).or_insert(0);
            *value = value
                .checked_add(record.total)
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or_else(malformed)?;
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use crate::usage_ledger::{UsageEvent, UsageLedger};

    fn ledger() -> UsageLedger {
        UsageLedger::open(
            &std::env::temp_dir().join(format!("quodex-sync-{}.sqlite", uuid::Uuid::new_v4())),
        )
        .unwrap()
    }

    fn event(id: &str, total: i64) -> UsageEvent {
        UsageEvent {
            source: "codex",
            request_key: format!("codex:thread:{id}"),
            source_ts_ms: 1_791_307_800_000,
            total_tokens: total,
            input_tokens: total - 10,
            output_tokens: 10,
            cached_input_tokens: 0,
            reasoning_tokens: 0,
        }
    }

    #[test]
    fn two_devices_merge_requests_without_counting_copied_history_twice() {
        let mut a = ledger();
        let mut b = ledger();
        a.upsert_codex(&event("shared", 80)).unwrap();
        a.upsert_codex(&event("a", 100)).unwrap();
        b.upsert_codex(&event("shared", 80)).unwrap();
        b.upsert_codex(&event("b", 200)).unwrap();
        let batch_a = a.sync_batch("test-space").unwrap().unwrap();
        let batch_b = b.sync_batch("test-space").unwrap().unwrap();
        a.sync_import("test-space", &batch_b).unwrap();
        b.sync_import("test-space", &batch_a).unwrap();
        b.sync_import("test-space", &batch_a).unwrap();
        for db in [&a, &b] {
            let totals = db.sync_totals().unwrap();
            assert_eq!(totals.codex.values().sum::<i64>(), 380);
            assert_eq!(totals.conflicts, 0);
        }
    }

    #[test]
    fn same_total_different_usage_is_a_conflict_not_a_revision() {
        let mut a = ledger();
        let original = event("r", 100);
        a.upsert_codex(&original).unwrap();
        let mut changed = original.clone();
        changed.input_tokens = 80;
        changed.output_tokens = 20;
        a.upsert_codex(&changed).unwrap();
        let merged = a.sync_totals().unwrap();
        assert_eq!(merged.conflicts, 1);
        assert!(merged.codex.is_empty());
    }

    #[test]
    fn zcode_revisions_wait_for_their_parent_and_converge_in_reverse_order() {
        let mut a = ledger();
        let b = ledger();
        let mut e = event("z", 90);
        e.source = "zcode";
        e.request_key = "local-db:z".into();
        a.identify_zcode(&e.request_key, "sess-1", "usage-1")
            .unwrap();
        a.upsert_zcode(&e).unwrap();
        let first = a.sync_batch("s").unwrap().unwrap();
        a.sync_ack("s", &first.id).unwrap();
        e.total_tokens = 180;
        e.input_tokens = 170;
        a.upsert_zcode(&e).unwrap();
        let second = a.sync_batch("s").unwrap().unwrap();
        b.sync_import("s", &second).unwrap();
        assert_eq!(b.sync_totals().unwrap().incomplete, 1);
        assert!(b.sync_totals().unwrap().zcode.is_empty());
        b.sync_import("s", &first).unwrap();
        b.sync_import("s", &second).unwrap();
        assert_eq!(b.sync_totals().unwrap().zcode.values().sum::<i64>(), 180);
        assert_eq!(b.sync_totals().unwrap().zcode_count, 1);
    }

    #[test]
    fn corrupt_batch_is_rejected_atomically_and_future_schema_pauses() {
        let mut a = ledger();
        let b = ledger();
        a.upsert_codex(&event("one", 100)).unwrap();
        a.upsert_codex(&event("two", 200)).unwrap();
        let mut batch = a.sync_batch("s").unwrap().unwrap();
        batch.observations[1].record.total = 999;
        // Re-sign the container but leave the altered observation invalid.
        batch.checksum = batch.checksum();
        assert!(b.sync_import("s", &batch).is_err());
        assert_eq!(b.sync_totals().unwrap().codex_count, 0);
        assert!(!b.sync_has_batch("s", &batch.id).unwrap());
        assert_eq!(
            super::Batch::decode(br#"{"schema":2,"newField":true}"#)
                .unwrap_err()
                .code,
            "QDS-110"
        );
    }

    #[test]
    fn legacy_zcode_is_retained_locally_without_inventing_identity() {
        let mut a = ledger();
        let mut e = event("old", 100);
        e.source = "zcode";
        e.request_key = "old-db:old".into();
        a.upsert_zcode(&e).unwrap();
        assert_eq!(a.request_count("zcode").unwrap(), 1);
        assert_eq!(a.sync_totals().unwrap().unidentified, 1);
        assert!(a.sync_batch("s").unwrap().is_none());
        a.identify_zcode(&e.request_key, "session", "id").unwrap();
        a.upsert_zcode(&e).unwrap();
        assert_eq!(a.sync_totals().unwrap().unidentified, 0);
        assert_eq!(a.sync_totals().unwrap().zcode_count, 1);
    }

    #[test]
    fn midnight_is_shanghai_and_observation_contains_no_native_identifiers() {
        let mut a = ledger();
        let mut e = event("private-request", 100);
        e.source_ts_ms = chrono::DateTime::parse_from_rfc3339("2026-10-13T16:00:00Z")
            .unwrap()
            .timestamp_millis();
        a.upsert_codex(&e).unwrap();
        assert_eq!(a.sync_totals().unwrap().codex["2026-10-14"], 100);
        let encoded =
            String::from_utf8(a.sync_batch("s").unwrap().unwrap().encode().unwrap()).unwrap();
        assert!(!encoded.contains("private-request"));
        assert!(!encoded.contains("thread"));
    }

    #[test]
    fn backlog_is_bounded_and_every_record_survives_three_acknowledged_batches() {
        let mut a = ledger();
        let b = ledger();
        for i in 0..2501 {
            a.upsert_codex(&event(&format!("request-{i}"), 100))
                .unwrap();
        }
        let mut sizes = Vec::new();
        while let Some(batch) = a.sync_batch("s").unwrap() {
            assert!(batch.encode().unwrap().len() <= super::MAX_BATCH_BYTES);
            assert_eq!(a.sync_batch("s").unwrap().unwrap().id, batch.id);
            sizes.push(batch.observations.len());
            b.sync_import("s", &batch).unwrap();
            a.sync_ack("s", &batch.id).unwrap();
        }
        assert_eq!(sizes, vec![1000, 1000, 501]);
        assert_eq!(a.sync_pending("s").unwrap(), 0);
        assert_eq!(b.sync_totals().unwrap().codex.values().sum::<i64>(), 250100);
    }
}
