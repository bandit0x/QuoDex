use super::Pool;
use windows::{
    core::{Interface, Result, PWSTR},
    Win32::{
        Foundation::{CloseHandle, HWND},
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_MULTITHREADED,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
            Variant::VARIANT,
        },
        UI::{
            Accessibility::*,
            WindowsAndMessaging::{
                FindWindowExW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
                SetForegroundWindow, ShowWindowAsync, SW_RESTORE,
            },
        },
    },
};

const WEB_TITLES: &[&str] = &[
    "Usage limits",
    "Usage Limits",
    "使用限额",
    "使用限額",
    "用量限制",
    "用量限额",
    "用量限額",
    "使用量限制",
    "使用限制",
];
const GROUPS: [&[&str]; 2] = [
    &["Gemini Models", "Gemini models", "Gemini 模型"],
    &[
        "Claude and GPT models",
        "Claude and GPT Models",
        "Claude 和 GPT 模型",
        "Claude 与 GPT 模型",
        "Claude 與 GPT 模型",
    ],
];
const AG_QUOTA_REFRESH: &[&str] = &[
    "Refresh quota and credit data",
    "Refresh quota and credits data",
    "刷新配额与额度数据",
];

static WEB_RESET_TIME: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
    regex::Regex::new(r"重置(?:时间|時間)[：:]\s*(?:\d{1,2}月\d{1,2}日\s*)?\d{1,2}:\d{2}").unwrap()
});

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() }
    }
}

unsafe fn process_name(hwnd: HWND) -> Option<String> {
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut path = [0u16; 1024];
    let mut length = path.len() as u32;
    let ok = QueryFullProcessImageNameW(
        process,
        PROCESS_NAME_WIN32,
        PWSTR(path.as_mut_ptr()),
        &mut length,
    )
    .is_ok();
    let _ = CloseHandle(process);
    if !ok {
        return None;
    }
    let path = String::from_utf16_lossy(&path[..length as usize]);
    Some(path.rsplit('\\').next()?.to_ascii_lowercase())
}

unsafe fn by_name(
    ui: &IUIAutomation,
    root: &IUIAutomationElement,
    names: &[&str],
) -> Option<IUIAutomationElement> {
    named_element(ui, root, names, true)
}

unsafe fn named_element(
    ui: &IUIAutomation,
    root: &IUIAutomationElement,
    names: &[&str],
    visible_only: bool,
) -> Option<IUIAutomationElement> {
    for name in names {
        let cond = ui
            .CreatePropertyCondition(UIA_NamePropertyId, &VARIANT::from(*name))
            .ok()?;
        if let Ok(el) = root.FindFirst(TreeScope_Descendants, &cond) {
            if !visible_only || !el.CurrentIsOffscreen().unwrap_or_default().as_bool() {
                return Some(el);
            }
        }
    }
    None
}

unsafe fn text_lines(ui: &IUIAutomation, root: &IUIAutomationElement) -> Result<Vec<String>> {
    let text = ui.CreatePropertyCondition(
        UIA_ControlTypePropertyId,
        &VARIANT::from(UIA_TextControlTypeId.0),
    )?;
    let list = root.FindAll(TreeScope_Descendants, &text)?;
    let count = list.Length()?;
    if count > 128 {
        return Ok(Vec::new());
    }
    let mut lines = Vec::new();
    for i in 0..count {
        let el = list.GetElement(i)?;
        let name = el.CurrentName()?.to_string();
        if name.len() <= 240 {
            lines.extend(name.lines().map(str::to_owned));
        }
    }
    Ok(lines)
}

unsafe fn web_panel(
    ui: &IUIAutomation,
    doc: &IUIAutomationElement,
    url: &tauri::Url,
) -> Option<Pool> {
    if let Some(panel) = named_panel(ui, doc, WEB_TITLES) {
        return Some(Pool::from_lines(&text_lines(ui, &panel).ok()?));
    }
    if matches!(
        url.path().trim_end_matches('/').rsplit('/').next(),
        Some("usage" | "usage-limits")
    ) && by_name(ui, doc, WEB_TITLES).is_some()
    {
        if let Some(list) = by_name(ui, doc, &["Usage cycles", "用量周期", "用量週期"]) {
            return Some(Pool::from_lines(&web_cycle_lines(ui, &list).ok()?));
        }
        return Some(Pool::from_lines(&text_lines(ui, doc).ok()?));
    }
    None
}

unsafe fn web_cycle_lines(ui: &IUIAutomation, list: &IUIAutomationElement) -> Result<Vec<String>> {
    let items = ui.CreatePropertyCondition(
        UIA_ControlTypePropertyId,
        &VARIANT::from(UIA_ListItemControlTypeId.0),
    )?;
    let items = list.FindAll(TreeScope_Children, &items)?;
    let mut lines = Vec::new();
    for index in 0..items.Length()?.min(8) {
        let item = items.GetElement(index)?;
        let mut row = text_lines(ui, &item)?;
        // The reset timestamp can exist only in the list item's accessible label.
        if !row.iter().any(|line| super::is_reset(&line.to_lowercase())) {
            let label = item.CurrentName()?.to_string();
            if let Some(reset) = WEB_RESET_TIME.find(&label) {
                row.push(reset.as_str().to_owned());
            }
        }
        lines.extend(row);
    }
    Ok(lines)
}

// A menu item or a matching model heading in a conversation is insufficient.
unsafe fn named_panel(
    ui: &IUIAutomation,
    doc: &IUIAutomationElement,
    titles: &[&str],
) -> Option<IUIAutomationElement> {
    let role = ui
        .CreatePropertyCondition(UIA_AriaRolePropertyId, &VARIANT::from("dialog"))
        .ok()?;
    let dialog = ui
        .CreatePropertyCondition(UIA_IsDialogPropertyId, &VARIANT::from(true))
        .ok()?;
    let dialogs = doc
        .FindAll(
            TreeScope_Descendants,
            &ui.CreateOrCondition(&role, &dialog).ok()?,
        )
        .ok()?;
    for i in 0..dialogs.Length().ok()?.min(8) {
        let item = dialogs.GetElement(i).ok()?;
        if item.CurrentIsOffscreen().ok()?.as_bool() {
            continue;
        }
        let name = item.CurrentName().ok()?.to_string();
        if titles.iter().any(|title| name.eq_ignore_ascii_case(title))
            || by_name(ui, &item, titles).is_some()
        {
            return Some(item);
        }
    }
    None
}

unsafe fn ag_panel(
    ui: &IUIAutomation,
    doc: &IUIAutomationElement,
    url: Option<&tauri::Url>,
) -> Option<IUIAutomationElement> {
    let titles = [
        "View Usage",
        "Model Usage",
        "Usage",
        "Models",
        "Models & Quota",
        "查看用量",
        "模型",
        "用量",
    ];
    if let Some(panel) = named_panel(ui, doc, &titles) {
        return Some(panel);
    }
    if url.is_some_and(|u| {
        matches!(
            u.path().trim_end_matches('/'),
            "/settings/models" | "/settings/usage"
        )
    }) {
        return Some(doc.clone());
    }
    // In the model selector the quota rows can be revealed by a disclosure button.
    // Search only the button's enclosing section, never use the entire chat document.
    let settings = url.is_some_and(|url| {
        url.query_pairs()
            .any(|(key, value)| key == "settingsOpen" && value == "true")
    });
    let anchor = by_name(ui, doc, &["View Usage", "查看用量"]).or_else(|| {
        settings
            .then(|| named_element(ui, doc, AG_QUOTA_REFRESH, false))
            .flatten()
    })?;
    if anchor.CurrentControlType().ok()? != UIA_ButtonControlTypeId {
        return None;
    }
    let walker = ui.ControlViewWalker().ok()?;
    let mut parent = anchor;
    for _ in 0..8 {
        parent = walker.GetParentElement(&parent).ok()?;
        if ui.CompareElements(&parent, doc).ok()?.as_bool() {
            break;
        }
        if GROUPS
            .iter()
            .any(|group| named_element(ui, &parent, group, false).is_some())
        {
            return Some(parent);
        }
    }
    None
}

unsafe fn ag_group(ui: &IUIAutomation, doc: &IUIAutomationElement, names: &[&str]) -> Option<Pool> {
    // Loaded rows remain readable outside a settings pane's scroll viewport.
    let heading = named_element(ui, doc, names, false)?;
    let walker = ui.ControlViewWalker().ok()?;
    let mut element = heading;
    // A heading, its wrapper and its enclosing group often occupy separate nodes.
    for _ in 0..6 {
        element = walker.GetParentElement(&element).ok()?;
        let kind = element.CurrentControlType().ok()?;
        let lines = text_lines(ui, &element).ok()?;
        if let Some(index) = lines
            .iter()
            .position(|line| names.iter().any(|n| line.eq_ignore_ascii_case(n)))
        {
            let group: Vec<_> = lines
                .into_iter()
                .skip(index + 1)
                .take_while(|line| {
                    !GROUPS
                        .into_iter()
                        .flatten()
                        .any(|name| line.eq_ignore_ascii_case(name))
                })
                .collect();
            if group
                .iter()
                .any(|line| super::period(&line.to_lowercase()).is_some())
            {
                return Some(Pool::from_lines(&group));
            }
        }
        if ui.CompareElements(&element, doc).ok()?.as_bool()
            || kind == UIA_DocumentControlTypeId
            || kind == UIA_WindowControlTypeId
        {
            break;
        }
    }
    Some(Pool::unavailable("unreadable"))
}

unsafe fn document_url(doc: &IUIAutomationElement) -> Option<tauri::Url> {
    let value = doc
        .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
        .and_then(|p| p.CurrentValue())
        .or_else(|_| {
            doc.GetCurrentPatternAs::<IUIAutomationLegacyIAccessiblePattern>(
                UIA_LegacyIAccessiblePatternId,
            )
            .and_then(|p| p.CurrentValue())
        })
        .ok()?;
    tauri::Url::parse(&value.to_string()).ok()
}

fn insert(target: &mut Pool, pool: Option<Pool>) {
    if let Some(pool) = pool {
        *target = if target.state == "absent" {
            pool
        } else {
            Pool::unavailable("ambiguous")
        };
    }
}

fn visit_documents(
    restore_antigravity: bool,
    mut visit: impl FnMut(&IUIAutomation, &IUIAutomationElement, &tauri::Url, bool, bool, HWND),
) -> Result<()> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let _apartment = Apartment;
        let ui: IUIAutomation = CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER)?;
        let ui2: IUIAutomation2 = ui.cast()?;
        ui2.SetConnectionTimeout(800)?;
        ui2.SetTransactionTimeout(1000)?;
        let document = ui.CreatePropertyCondition(
            UIA_ControlTypePropertyId,
            &VARIANT::from(UIA_DocumentControlTypeId.0),
        )?;
        let mut previous = None;
        while let Ok(hwnd) = FindWindowExW(None, previous, None, None) {
            previous = Some(hwnd);
            if !IsWindowVisible(hwnd).as_bool() {
                continue;
            }
            let mut title = [0u16; 300];
            let len = GetWindowTextW(hwnd, &mut title);
            if len == 0 {
                continue;
            }
            let title = String::from_utf16_lossy(&title[..len as usize]).to_lowercase();
            let Some(exe) = process_name(hwnd) else {
                continue;
            };
            let desktop = matches!(exe.as_str(), "antigravity.exe" | "antigravity ide.exe");
            let browser = matches!(exe.as_str(), "chrome.exe" | "msedge.exe");
            if IsIconic(hwnd).as_bool() {
                if restore_antigravity && desktop {
                    let _ = ShowWindowAsync(hwnd, SW_RESTORE);
                }
                continue;
            }
            if !desktop && !(browser && browser_candidate_title(&title)) {
                continue;
            }
            let Ok(root) = ui.ElementFromHandle(hwnd) else {
                continue;
            };
            // Desktop 2.35 exposes a blank data: document before the main app's
            // loopback document. Browser windows must use the top-level page only.
            let Ok(docs) = root.FindAll(TreeScope_Descendants, &document) else {
                continue;
            };
            for index in 0..docs.Length()?.min(if desktop { 8 } else { 1 }) {
                let Ok(doc) = docs.GetElement(index) else {
                    continue;
                };
                let Some(url) = document_url(&doc) else {
                    continue;
                };
                if browser && (url.scheme() != "https" || url.port().is_some()) {
                    continue;
                }
                visit(&ui, &doc, &url, browser, desktop, hwnd);
            }
        }
        Ok(())
    }
}

fn browser_candidate_title(title: &str) -> bool {
    title.contains("gemini")
        || title.contains("antigravity")
        || matches!(
            title.split(" - ").next(),
            Some("usage" | "用量" | "使用情况" | "使用狀況")
        )
}

pub(super) fn read() -> Result<[Pool; 3]> {
    let mut pools = std::array::from_fn(|_| Pool::unavailable("absent"));
    let mut saw_ag_panel = false;
    visit_documents(false, |ui, doc, url, browser, desktop, _| unsafe {
        match url.host_str() {
            Some("gemini.google.com") if browser => {
                insert(&mut pools[0], web_panel(ui, doc, url));
            }
            Some("antigravity.google.com") | Some("127.0.0.1" | "localhost")
                if desktop || url.host_str() == Some("antigravity.google.com") =>
            {
                if let Some(panel) = ag_panel(ui, doc, Some(url)) {
                    for (i, names) in GROUPS.iter().enumerate() {
                        if saw_ag_panel {
                            pools[i + 1] = Pool::unavailable("ambiguous");
                        } else {
                            insert(&mut pools[i + 1], ag_group(ui, &panel, names));
                        }
                    }
                    saw_ag_panel = true;
                }
            }
            _ => {}
        }
    })?;
    Ok(pools)
}

const WEB_STOP: &[&str] = &[
    "Stop response",
    "Stop generating",
    "停止回答",
    "停止生成",
    "停止回覆",
];
const WEB_PROMPT: &[&str] = &["Copy prompt", "复制提示", "複製提示"];
const WEB_QUERY_ID: &str = "user-query-content-";
const WEB_REDO: &[&str] = &["Redo", "Regenerate", "重做", "重新生成"];
const WEB_COPY_RESPONSE: &[&str] = &["Copy", "Copy response", "复制", "複製"];

#[derive(Default)]
struct WebControls {
    running: bool,
    prompts: usize,
    response_ready: bool,
}

unsafe fn web_controls(ui: &IUIAutomation, doc: &IUIAutomationElement) -> Result<WebControls> {
    let buttons = ui.CreatePropertyCondition(
        UIA_ControlTypePropertyId,
        &VARIANT::from(UIA_ButtonControlTypeId.0),
    )?;
    let list = doc.FindAll(TreeScope_Descendants, &buttons)?;
    let mut controls = WebControls::default();
    let (mut redo, mut copy_response) = (false, false);
    for index in 0..list.Length()? {
        let Ok(element) = list.GetElement(index) else {
            continue;
        };
        let name = element.CurrentName().unwrap_or_default().to_string();
        let name = name.trim();
        if WEB_STOP.contains(&name) {
            controls.running = true;
        }
        if WEB_PROMPT.contains(&name) {
            controls.prompts += 1;
            (redo, copy_response) = (false, false);
        }
        redo |= WEB_REDO.contains(&name);
        copy_response |= redo && WEB_COPY_RESPONSE.contains(&name);
    }
    controls.response_ready = controls.prompts > 0 && copy_response && !controls.running;
    // Gemini keeps only a few prompts mounted. The stable ordinal is carried
    // by the prompt group's automation ID even when older prompts scroll out.
    if let Ok(condition) = ui.CreatePropertyConditionEx(
        UIA_AutomationIdPropertyId,
        &VARIANT::from(WEB_QUERY_ID),
        PropertyConditionFlags_MatchSubstring,
    ) {
        if let Ok(items) = doc.FindAll(TreeScope_Descendants, &condition) {
            for index in 0..items.Length().unwrap_or_default() {
                let Some(id) = items
                    .GetElement(index)
                    .ok()
                    .and_then(|item| item.CurrentAutomationId().ok())
                else {
                    continue;
                };
                if let Some(ordinal) = query_ordinal(&id.to_string()) {
                    controls.prompts = controls.prompts.max(ordinal);
                }
            }
        }
    }
    Ok(controls)
}

fn query_ordinal(id: &str) -> Option<usize> {
    id.strip_prefix(WEB_QUERY_ID)?
        .parse::<usize>()
        .ok()?
        .checked_add(1)
}

#[derive(Default)]
pub(crate) struct WebChatTracker {
    windows: std::collections::HashMap<usize, WebFrame>,
    completed: std::collections::BTreeMap<String, crate::task_status::ChatTask>,
}

struct WebFrame {
    route: Option<String>,
    seen_at: u64,
    controls: WebControls,
    highest_prompt: usize,
    pending: Option<(u64, u64)>,
}

impl WebFrame {
    fn observe(
        previous: Option<&Self>,
        route: Option<String>,
        controls: WebControls,
        now: u64,
    ) -> (Self, Option<u64>) {
        let continuing = previous.filter(|frame| {
            frame.route == route
                || (frame.route.is_none()
                    && frame.pending.is_some()
                    && route.is_some()
                    && controls.prompts <= 1)
        });
        let previous_prompt = continuing.map_or(0, |frame| frame.highest_prompt);
        let highest_prompt = previous_prompt.max(controls.prompts);
        let new_prompt = previous_prompt > 0 && controls.prompts > previous_prompt;
        let active = controls.running || new_prompt;
        let pending = continuing
            .and_then(|frame| frame.pending)
            .filter(|(_, until)| *until >= now);
        let pending = if active {
            Some((pending.map_or(now, |(started, _)| started), now + 20_000))
        } else {
            pending
        };
        let completed =
            if route.is_some() && controls.response_ready && controls.prompts == highest_prompt {
                pending.map(|(started, _)| started)
            } else {
                None
            };
        (
            Self {
                route,
                seen_at: now,
                controls,
                highest_prompt,
                pending: if completed.is_some() { None } else { pending },
            },
            completed,
        )
    }
}

impl WebChatTracker {
    pub(crate) fn read(&mut self) -> Result<crate::task_status::SourceTaskSnapshot> {
        use crate::task_status::{now_ms, ChatTask, SourceTaskSnapshot, TaskSource, TaskState};
        let now = now_ms();
        let mut tasks = std::collections::BTreeMap::new();
        let mut readable = false;
        self.windows
            .retain(|_, frame| now.saturating_sub(frame.seen_at) < 12_000);
        self.completed
            .retain(|_, task| task.expires_at_ms.is_some_and(|time| time > now));
        visit_documents(false, |ui, doc, url, browser, _, hwnd| unsafe {
            if !browser
                || url.host_str() != Some("gemini.google.com")
                || doc.CurrentIsOffscreen().unwrap_or_default().as_bool()
            {
                return;
            }
            let route =
                crate::gemini_tasks::web_chat_url(url.path()).map(|url| url.path().to_owned());
            let home = url.path().trim_end_matches('/') == "/app";
            if (route.is_none() && !home) || named_panel(ui, doc, WEB_TITLES).is_some() {
                return;
            }
            let Ok(controls) = web_controls(ui, doc) else {
                return;
            };
            readable = true;
            let window = hwnd.0 as usize;
            let (frame, completed) =
                WebFrame::observe(self.windows.get(&window), route.clone(), controls, now);
            let running = frame.controls.running;
            let turn_started = completed
                .or_else(|| frame.pending.map(|(started, _)| started))
                .unwrap_or(now);
            self.windows.insert(window, frame);
            let completed = completed.is_some();
            let Some(route) = route else {
                return;
            };
            let id = format!("gemini-web:{route}");
            if running {
                self.completed.remove(&id);
            }
            if !running && !completed {
                return;
            }
            let title = doc.CurrentName().unwrap_or_default().to_string();
            let task = ChatTask {
                source: TaskSource::GeminiWeb,
                id: id.clone(),
                title: if title.is_empty() {
                    "Gemini 网页聊天".into()
                } else {
                    title.chars().take(160).collect()
                },
                state: if completed {
                    TaskState::Completed
                } else {
                    TaskState::Running
                },
                turn_id: turn_started.to_string(),
                completed_at_ms: completed.then_some(now),
                expires_at_ms: completed.then_some(now + 1_800_000),
                project_path: None,
                project_name: None,
                detail: None,
            };
            if completed {
                self.completed
                    .entry(id)
                    .and_modify(|old| {
                        if old.completed_at_ms.is_none_or(|ended| ended < turn_started) {
                            *old = task.clone();
                        }
                    })
                    .or_insert(task);
            } else {
                tasks.insert(id, task);
            }
        })?;
        for (id, task) in &self.completed {
            tasks.entry(id.clone()).or_insert_with(|| task.clone());
        }
        Ok(SourceTaskSnapshot {
            tasks: tasks.into_values().collect(),
            observed_at_ms: now,
            diagnostic: (!readable).then(|| {
                crate::capacity::Diagnostic::new("QDT-641", "打开 Gemini 网页聊天后读取状态")
            }),
        })
    }
}

fn local_antigravity(url: &tauri::Url) -> bool {
    url.scheme() == "https" && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
}

fn matches_conversation(url: &tauri::Url, id: uuid::Uuid) -> bool {
    url.path()
        .strip_prefix("/c/")
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
        == Some(id)
}

pub(crate) fn open_antigravity_chat(id: uuid::Uuid) -> bool {
    let mut deadline = std::time::Instant::now() + std::time::Duration::from_secs(6);
    let mut launched = false;
    let mut invoked = false;
    let mut opened_sidebar = false;
    loop {
        let mut saw_app = false;
        let mut opened = false;
        let _ = visit_documents(true, |ui, doc, url, _, desktop, hwnd| unsafe {
            if !desktop || !local_antigravity(url) {
                return;
            }
            saw_app = true;
            if matches_conversation(url, id) {
                let _ = SetForegroundWindow(hwnd);
                opened = true;
                return;
            }
            if invoked {
                return;
            }
            let Ok(condition) = ui.CreatePropertyCondition(
                UIA_ControlTypePropertyId,
                &VARIANT::from(UIA_HyperlinkControlTypeId.0),
            ) else {
                return;
            };
            let Ok(links) = doc.FindAll(TreeScope_Descendants, &condition) else {
                return;
            };
            if let Ok(length) = links.Length() {
                for index in 0..length {
                    let Ok(link) = links.GetElement(index) else {
                        continue;
                    };
                    let Some(target) = document_url(&link) else {
                        continue;
                    };
                    if target.origin() != url.origin() || !matches_conversation(&target, id) {
                        continue;
                    }
                    if let Ok(action) =
                        link.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                    {
                        let _ = SetForegroundWindow(hwnd);
                        invoked = action.Invoke().is_ok();
                    }
                    return;
                }
            }
            if !opened_sidebar && by_name(ui, doc, &["Sidebar", "侧边栏", "側邊欄"]).is_none()
            {
                if let Some(toggle) =
                    by_name(ui, doc, &["Toggle Sidebar", "切换侧边栏", "切換側邊欄"])
                {
                    if let Ok(action) = toggle
                        .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
                    {
                        opened_sidebar = action.Invoke().is_ok();
                    }
                }
            }
        });
        if opened {
            return true;
        }
        if !saw_app && !launched {
            launched = true;
            for base in [
                std::env::var_os("LOCALAPPDATA")
                    .map(|path| std::path::PathBuf::from(path).join("Programs")),
                std::env::var_os("ProgramFiles").map(std::path::PathBuf::from),
            ]
            .into_iter()
            .flatten()
            {
                let executable = base.join("antigravity/Antigravity.exe");
                if executable.is_file() {
                    if std::process::Command::new(executable).spawn().is_ok() {
                        // A cold Electron launch has to restore the account and paint
                        // its conversation list before an exact link can be invoked.
                        deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
                    }
                    break;
                }
            }
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

#[cfg(test)]
mod web_task_tests {
    use super::*;

    fn controls(prompts: usize, running: bool, response_ready: bool) -> WebControls {
        WebControls {
            prompts,
            running,
            response_ready,
        }
    }

    #[test]
    fn virtualized_prompt_ordinal_recovers_a_turn_that_finishes_between_polls() {
        let route = Some("/app/example".into());
        let old = query_ordinal("user-query-content-7").unwrap();
        let next = query_ordinal("user-query-content-8").unwrap();
        let (previous, _) = WebFrame::observe(None, route.clone(), controls(old, false, true), 100);
        assert_eq!(
            WebFrame::observe(Some(&previous), route, controls(next, false, true), 3_100).1,
            Some(3_100)
        );
        assert_eq!(query_ordinal("not-user-query-content-8"), None);
    }

    #[test]
    fn reloading_or_scrolling_an_existing_chat_does_not_reissue_success() {
        let route = Some("/app/example".into());
        let (loading, _) = WebFrame::observe(None, route.clone(), controls(0, false, false), 100);
        let (ready, completed) = WebFrame::observe(
            Some(&loading),
            route.clone(),
            controls(8, false, true),
            3_100,
        );
        assert_eq!(completed, None);
        let (older_view, completed) =
            WebFrame::observe(Some(&ready), route.clone(), controls(5, false, true), 6_100);
        assert_eq!(completed, None);
        assert_eq!(
            WebFrame::observe(Some(&older_view), route, controls(8, false, true), 9_100).1,
            None
        );
    }

    #[test]
    fn completion_survives_a_poll_between_stop_and_final_actions() {
        let route = Some("/app/example".into());
        let (baseline, completed) =
            WebFrame::observe(None, route.clone(), controls(1, false, true), 100);
        assert_eq!(completed, None);
        let (running, _) = WebFrame::observe(
            Some(&baseline),
            route.clone(),
            controls(2, true, false),
            3_100,
        );
        let (settling, completed) = WebFrame::observe(
            Some(&running),
            route.clone(),
            controls(2, false, false),
            6_100,
        );
        assert_eq!(completed, None);
        let (finished, completed) = WebFrame::observe(
            Some(&settling),
            route.clone(),
            controls(2, false, true),
            9_100,
        );
        assert_eq!(completed, Some(3_100));
        assert_eq!(
            WebFrame::observe(Some(&finished), route, controls(2, false, true), 12_100).1,
            None
        );
    }

    #[test]
    fn new_chat_keeps_pending_work_until_a_stable_route_exists() {
        let (running, _) = WebFrame::observe(None, None, controls(1, true, false), 100);
        let (settling, _) =
            WebFrame::observe(Some(&running), None, controls(1, false, true), 3_100);
        let route = Some("/app/new".into());
        assert_eq!(
            WebFrame::observe(
                Some(&settling),
                route.clone(),
                controls(1, false, true),
                6_100
            )
            .1,
            Some(100)
        );
        assert_eq!(
            WebFrame::observe(Some(&settling), route, controls(1, false, true), 21_100).1,
            None
        );
    }
}
