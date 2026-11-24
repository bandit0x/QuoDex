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
        "Claude 與 GPT 模型",
    ],
];

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
    for name in names {
        let cond = ui
            .CreatePropertyCondition(UIA_NamePropertyId, &VARIANT::from(*name))
            .ok()?;
        if let Ok(el) = root.FindFirst(TreeScope_Descendants, &cond) {
            if !el.CurrentIsOffscreen().unwrap_or_default().as_bool() {
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
        return Some(Pool::from_lines(&text_lines(ui, doc).ok()?));
    }
    None
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
    let anchor = by_name(ui, doc, &["View Usage", "查看用量"])?;
    if anchor.CurrentControlType().ok()? != UIA_ButtonControlTypeId {
        return None;
    }
    let walker = ui.ControlViewWalker().ok()?;
    let mut parent = anchor;
    for _ in 0..4 {
        parent = walker.GetParentElement(&parent).ok()?;
        if ui.CompareElements(&parent, doc).ok()?.as_bool() {
            break;
        }
        if GROUPS
            .iter()
            .any(|group| by_name(ui, &parent, group).is_some())
        {
            return Some(parent);
        }
    }
    None
}

unsafe fn ag_group(ui: &IUIAutomation, doc: &IUIAutomationElement, names: &[&str]) -> Option<Pool> {
    let heading = by_name(ui, doc, names)?;
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
    mut visit: impl FnMut(&IUIAutomation, &IUIAutomationElement, &tauri::Url, bool, bool),
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
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
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
            if !desktop && !(browser && (title.contains("gemini") || title.contains("antigravity")))
            {
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
                visit(&ui, &doc, &url, browser, desktop);
            }
        }
        Ok(())
    }
}

pub(super) fn read() -> Result<[Pool; 3]> {
    let mut pools = std::array::from_fn(|_| Pool::unavailable("absent"));
    let mut saw_ag_panel = false;
    visit_documents(|ui, doc, url, browser, desktop| unsafe {
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

pub(crate) fn web_chats() -> Result<crate::task_status::SourceTaskSnapshot> {
    use crate::task_status::{now_ms, ChatTask, SourceTaskSnapshot, TaskSource, TaskState};
    let observed_at_ms = now_ms();
    let mut tasks = std::collections::BTreeMap::new();
    let mut readable = false;
    visit_documents(|ui, doc, url, browser, _| unsafe {
        if !browser
            || url.host_str() != Some("gemini.google.com")
            || doc.CurrentIsOffscreen().unwrap_or_default().as_bool()
        {
            return;
        }
        let Some(chat_url) = crate::gemini_tasks::web_chat_url(url.path()) else {
            // The home page has no stable chat identity.
            readable |= url.path() == "/app"
                && by_name(ui, doc, &["Send message", "发送消息", "傳送訊息"]).is_some();
            return;
        };
        if by_name(ui, doc, WEB_TITLES).is_some() {
            return;
        }
        let state = if by_name(
            ui,
            doc,
            &[
                "Stop response",
                "Stop generating",
                "停止回答",
                "停止生成",
                "停止回覆",
            ],
        )
        .is_some_and(|element| {
            element
                .CurrentControlType()
                .is_ok_and(|kind| kind == UIA_ButtonControlTypeId)
        }) {
            Some(TaskState::Running)
        } else if by_name(ui, doc, &["Send message", "发送消息", "傳送訊息"]).is_some() {
            None
        } else {
            Some(TaskState::Unknown)
        };
        readable = true;
        let Some(state) = state else {
            return;
        };
        let id = format!("gemini-web:{}", chat_url.path());
        let name = doc.CurrentName().unwrap_or_default().to_string();
        let title = if name.is_empty() {
            "Gemini 网页聊天".into()
        } else {
            name.chars().take(160).collect()
        };
        tasks
            .entry(id.clone())
            .and_modify(|task: &mut ChatTask| {
                if state == TaskState::Running {
                    task.state = state;
                    task.detail = None;
                }
            })
            .or_insert_with(|| ChatTask {
                source: TaskSource::GeminiWeb,
                id,
                title,
                state,
                turn_id: String::new(),
                completed_at_ms: None,
                expires_at_ms: None,
                project_path: None,
                project_name: None,
                detail: (state == TaskState::Unknown)
                    .then(|| "无法从网页确认当前执行状态 · QDT-641".into()),
            });
    })?;
    Ok(SourceTaskSnapshot {
        tasks: tasks.into_values().collect(),
        observed_at_ms,
        diagnostic: (!readable)
            .then(|| crate::capacity::Diagnostic::new("QDT-641", "打开 Gemini 网页聊天后读取状态")),
    })
}
