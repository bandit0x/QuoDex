# AG/gemini-quota：低风控事件驱动探测架构（参考 yuhuan-dev + CodexBar）

本分支针对 `v0.4.15` 原有后台探针的两大封号/风控隐患做了系统重构：
- 移除每 2 分钟冷启动全新 UUID 目录 + `--disable_telemetry` + `forceRefresh: true` 强刷云端的 AG 高频轮询。
- 移除每 5 分钟用主号登录态跑 `chrome.exe --headless --dump-dom` 抓取 `gemini.google.com/usage` 的无头浏览器轮询。

## 1. AG 额度三层安全优先级

| 优先级 | 来源 (`source`) | 实现方式 | 灵感来源 | 网络开销 |
| :--- | :--- | :--- | :--- | :--- |
| **L1（首选）** | `statusline` | 读取官方 `agy` `/statusline` 钩子写入的 `%LOCALAPPDATA%\QuoDex\GeminiQuota\statusline-quota.json`（35 分钟内视为新鲜） | `yuhuan-dev/antigravity-usage-monitor` | **0 次额外请求** |
| **L2（推荐）** | `cli` | 自动发现本机官方 `agy`（支持 `ANTIGRAVITY_CLI_PATH`、`PATH` 与默认目录），在隔离空目录执行官方无头命令 `agy -p /usage --output-format json`（禁用后台自更新干扰） | `steipete/CodexBar` | 仅事件驱动 / 冷却外触发 |
| **L3（回退）** | `desktop` | 未安装 `agy` 时：① 先尝试复用已运行 Hub 的 `~/.gemini/antigravity/daemon/hub_*.json`；② 无 discovery 时才用固定目录 `quodex-quota` 启动本机 `language_server.exe`，**移除 `--disable_telemetry` 与 `forceRefresh: true`** | `yuhuan-dev` discovery + 降噪改造 | 强制 5 分钟自动冷却 / 30 秒手动防抖 |

## 2. 触发时机改造（从高频轮询改为事件驱动）

- **任务完成事件驱动**：联动已有纯本地 [gemini_tasks.rs](../../../src-tauri/src/gemini_tasks.rs)，当 `conversation_summaries.db` 检测到一轮 Antigravity 对话刚刚进入 `Completed` 后，延迟 3 秒刷新一次 AG 额度——**不用打开 Models 面板即可自动同步**。
- **重置点触发**：在已知 `reset` 时间点后 +5 秒触发一次。
- **低频兜底**：30 分钟一次兜底刷新（若本地有新鲜的 `statusline` 推流，则全程零网络）。
- **取消 `visibilitychange` 触发**：切窗口不再反复唤醒云端请求。
- **Rust 硬冷却门控**：自动请求最小间隔 5 分钟、手动点刷新最小防抖 30 秒，并严格遵守 429 `Retry-After` 退避。

## 3. Gemini Web 仓安全策略

- 彻底删除 `--headless --dump-dom` 后台轮询逻辑，避免主 Google 账号 Cookie 触发反自动化/异常登录风控。
- 默认通过 Windows UI Automation（`windows_reader::read_web_only`）被动读取你正常浏览器里打开的 `gemini.google.com/usage`，零额外网络请求、零无头指纹。
- 点击“连接 Gemini 网页账号”仅打开正常可见浏览器窗口访问 `/usage`，打开期间自动本地同步。

## 4. 个人本机启用官方 `agy` CLI（可选但最推荐）

1. 安装官方 Antigravity CLI（`agy`）并在终端完成登录：
   ```powershell
   agy auth login
   agy -p /usage --output-format json
   ```
   装好后 QuoDex 会自动检测 `agy` 并优先走 **L2 (`agy CLI`)**，无需任何额外配置（若安装在自定义路径，可设置环境变量 `ANTIGRAVITY_CLI_PATH`）。
2. 如果你平时也用 `agy` 终端对话，可额外绑定配套零请求钩子脚本：
   ```text
   /statusline powershell -NoProfile -ExecutionPolicy Bypass -File "<仓库路径>\scripts\agy-statusline-bridge.ps1"
   ```
   绑定后 QuoDex 会优先走 **L1 (`agy 状态栏（零请求）`)**。
