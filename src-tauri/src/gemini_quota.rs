use crate::capacity::Diagnostic;
use regex::Regex;
use serde::Serialize;
use std::sync::LazyLock;

#[cfg(windows)]
mod windows_reader;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    period: &'static str,
    remaining_percent: f64,
    reset: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pool {
    pub state: &'static str,
    pub windows: Vec<Window>,
}

impl Pool {
    fn unavailable(state: &'static str) -> Self {
        Self {
            state,
            windows: Vec::new(),
        }
    }
    fn from_lines(lines: &[String]) -> Self {
        match windows_from_lines(lines) {
            Some(windows) if !windows.is_empty() => Self {
                state: "available",
                windows,
            },
            _ => Self::unavailable("unreadable"),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiQuota {
    pools: [Pool; 3],
    observed_at_ms: i64,
}

#[tauri::command]
pub async fn read_gemini_quota() -> Result<GeminiQuota, Diagnostic> {
    #[cfg(windows)]
    let pools = tauri::async_runtime::spawn_blocking(windows_reader::read)
        .await
        .map_err(|_| Diagnostic::new("QGM-204", "额度读取任务中断，请重新读取"))?
        .map_err(|_| Diagnostic::new("QGM-204", "无法读取窗口辅助功能，请重新打开额度面板"))?;
    #[cfg(not(windows))]
    let pools = std::array::from_fn(|_| Pool::unavailable("unsupported"));
    Ok(GeminiQuota {
        pools,
        observed_at_ms: chrono::Utc::now().timestamp_millis(),
    })
}

static PERCENT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[-+]?\d+(?:[.,]\d+)?\s*[%％]").unwrap());
static FIVE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:five|5)[ -]?hours?\b|(?:5|五)\s*[个個]?\s*小[時时]").unwrap()
});

fn period(line: &str) -> Option<&'static str> {
    if is_reset(line) {
        return None;
    }
    if line.contains("weekly")
        || line.contains("week limit")
        || line.contains("每周")
        || line.contains("每週")
        || line.contains("本周")
        || line.contains("本週")
        || line.contains("周限")
        || line.contains("週限")
    {
        Some("weekly")
    } else if FIVE.is_match(line) {
        Some("fiveHour")
    } else {
        None
    }
}

fn is_reset(line: &str) -> bool {
    line.starts_with("reset")
        || line.contains("fully refresh in")
        || line.starts_with("refreshes")
        || line.contains("重置")
        || line.starts_with("刷新时间")
}

fn direction(line: &str) -> Option<bool> {
    if is_reset(line) {
        return None;
    }
    let used = ["used", "consumed", "已用", "已使用", "已消耗"]
        .iter()
        .any(|w| line.contains(w));
    let left = ["remaining", "left", "剩余", "剩餘", "可用"]
        .iter()
        .any(|w| line.contains(w));
    if used == left {
        None
    } else {
        Some(used)
    }
}

// A period heading starts one row. Numbers must explicitly say used or remaining,
// either in the heading or next to the percentage. An incomplete row invalidates
// the pool, since it could be more restrictive than the rows we can read.
fn windows_from_lines(lines: &[String]) -> Option<Vec<Window>> {
    let mut windows = Vec::new();
    let mut row = Vec::new();
    let mut current = None;
    for original in lines {
        let trimmed = original.trim();
        if trimmed.is_empty() {
            continue;
        }
        let line = trimmed.to_lowercase();
        if let Some(next) = period(&line) {
            if let Some(previous) = current {
                windows.push(parse_row(previous, &row)?);
            }
            if windows.iter().any(|window| window.period == next) {
                return None;
            }
            current = Some(next);
            row.clear();
        }
        if current.is_some() {
            row.push(trimmed);
        }
    }
    if let Some(previous) = current {
        windows.push(parse_row(previous, &row)?);
    }
    Some(windows)
}

fn parse_row(period: &'static str, row: &[&str]) -> Option<Window> {
    let mut value = None;
    let mut reset = None;
    let heading = direction(&row.first()?.to_lowercase());
    for (index, text) in row.iter().enumerate() {
        let line = text.to_lowercase();
        if is_reset(&line) {
            let hint = text
                .split_once(", it will ")
                .map_or(*text, |(prefix, _)| &text[prefix.len() + 2..]);
            if hint.chars().count() <= 100 {
                reset = Some(hint.to_owned());
            }
            continue;
        }
        for cap in PERCENT.find_iter(&line) {
            if value.is_some() {
                return None;
            }
            let nearby = index
                .checked_sub(1)
                .and_then(|i| direction(&row[i].to_lowercase()));
            let inline = direction(&line);
            let used = inline.or(nearby).or(heading)?;
            if [inline, nearby, heading]
                .into_iter()
                .flatten()
                .any(|d| d != used)
            {
                return None;
            }
            let pct: f64 = cap
                .as_str()
                .trim_end_matches(['%', '％'])
                .trim()
                .replace(',', ".")
                .parse()
                .ok()?;
            if !(0.0..=100.0).contains(&pct) {
                return None;
            }
            value = Some(if used { 100.0 - pct } else { pct });
        }
    }
    Some(Window {
        period,
        remaining_percent: value?,
        reset,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(text: &str) -> Pool {
        Pool::from_lines(&text.lines().map(str::to_owned).collect::<Vec<_>>())
    }
    #[test]
    fn reads_independent_periods_and_directions() {
        let p = parse("Five Hour Limit Remaining\n100%\nResets in 5 hours\nWeekly usage\n100% used\nResets Tuesday");
        assert_eq!(p.state, "available");
        assert_eq!(p.windows[0].remaining_percent, 100.);
        assert_eq!(p.windows[1].remaining_percent, 0.);
        assert_eq!(p.windows[1].reset.as_deref(), Some("Resets Tuesday"));
        let cn = parse("5 小时限额\n已用 35％\n每周剩余 9.3%");
        assert_eq!(cn.windows[0].remaining_percent, 65.);
        assert_eq!(cn.windows[1].remaining_percent, 9.3);
    }
    #[test]
    fn refresh_hint_between_heading_and_value_belongs_to_the_same_window() {
        let p = parse("Weekly Limit Remaining\nYou have used some of your weekly limit, it will fully refresh in 5 days, 12 hours.\n83%");
        assert_eq!(p.state, "available");
        assert_eq!(p.windows.len(), 1);
        assert_eq!(p.windows[0].remaining_percent, 83.);
        assert_eq!(
            p.windows[0].reset.as_deref(),
            Some("it will fully refresh in 5 days, 12 hours.")
        );
    }
    #[test]
    fn refuses_unknown_direction_incomplete_and_contradictory_panels() {
        for text in [
            "Weekly limit\n52%",
            "Weekly remaining\n101%",
            "Weekly remaining\n-1%",
            "Weekly remaining 90%\nFive Hour Limit",
            "Weekly remaining 60%\nWeekly remaining 40%",
            "Weekly remaining\n10% or 20%",
            "Weekly remaining\n10% used",
        ] {
            assert_eq!(parse(text).state, "unreadable", "{text}");
        }
    }
}
