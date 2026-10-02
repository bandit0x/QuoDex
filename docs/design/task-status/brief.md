# 任务状态设计与验收

Status: Acceptance pending

当前交付分支：`main`；修复来源分支：`fix/task-project-label-and-status`；原功能分支：`feature/v0.2.1-task-status`。本文件是任务状态的验收入口。

## 当前 v0.2.2 发布（2026-10-03）

发布及以下指定环境检查：Verified；功能使用验收仍为 Acceptance pending。源码 `340f74d454cc3a67622b90d8765fad0a2ff1bc53` 已推送 `main`，正式标签 `v0.2.2` 指向同一提交。[GitHub Release](https://github.com/bandit0x/QuoDex/releases/tag/v0.2.2) 已公开并设为 latest，非预发布；中文 body 与 [v0.2.2.md](../../releases/v0.2.2.md) 一致。[标签 CI](https://github.com/bandit0x/QuoDex/actions/runs/37038306351) 的 Windows / macOS 测试、两个打包任务和发布任务全部成功，[记录](../../../.impeccable/review/release-v0.2.2/published/ci.json)。本版本包含下方项目冠名和桌面终态修复，版本元数据统一为 0.2.2。

两个正式资产均从 Release 下载，文件大小和 SHA256 与 GitHub asset digest 一致：[publication.json](../../../.impeccable/review/release-v0.2.2/published/publication.json)。

| 正式资产 | 大小 / SHA256 |
| --- | --- |
| `QuoDex-0.2.2-win-x64-setup.exe` | 300232138 bytes / `e592dbc5d8aa78896293edb8d9b8cf3fe538a09e2fcf2c97e70e36041b009ff2` |
| `QuoDex_0.2.2_aarch64.dmg` | 101480219 bytes / `f3b46ccf6df82a0aab55dd868517f5584b35d4313d1a08f1f2b5df92728bffec` |

验证环境：Windows 11 x64 / PowerShell 7.6.5 / Node 24.18.0 / cargo 1.97.1 / 固定 WebView2 151.0.4129.78。发布前重新执行 76 项前端测试、88 项 Rust 测试和生产构建，均通过；3 项现场测试默认忽略。本机 0.2.2 exe 的 6 项原生检查通过：[前端](../../../.impeccable/review/release-v0.2.2/prepublish/frontend-tests.log) / [Rust](../../../.impeccable/review/release-v0.2.2/prepublish/rust-tests.log) / [构建](../../../.impeccable/review/release-v0.2.2/prepublish/native-build.log) / [原生记录](../../../.impeccable/review/release-v0.2.2/prepublish/result.json)。

正式 Windows 安装器解包到隔离目录，exe 的 FileVersion 为 0.2.2、SHA256 为 `80ba3c41c08d027b41fa7310738f54cfaa7773a0f7f4586dfe0d36515bb1aeda`，相邻 Codex 与 WebView2 运行时齐全：[内容记录](../../../.impeccable/review/release-v0.2.2/published/windows-content.json)。使用该 exe 和捆绑 WebView2、新配置 / SQLite / WebView 数据目录、真实窗口及 UI Automation 顺序执行：

| 执行步骤 | 实际结果与证据 |
| --- | --- |
| `node scripts/verify-task-status.mjs --repair-only` | 6 项通过：项目冠名、运行转等待、新终态覆盖旧中断历史、完成分钟数、溢出、过期和移除；[记录](../../../.impeccable/review/release-v0.2.2/published/repair/result.json) |
| `node scripts/verify-task-status.mjs --mixed-only` | 8 项通过：两种额度下混排、取消 / 等待 / 未知、项目 URI、失败移除持久化、溢出、来源故障隔离恢复、运行残留拦截和成功过期；[记录](../../../.impeccable/review/release-v0.2.2/published/mixed/result.json) |

正式产物截图与批准 V6 对照：[运行悬停](../../../.impeccable/review/release-v0.2.2/published/repair/project-running-hover-windows.png)保留单行水流圈和间隙、增加项目冠名；[等待](../../../.impeccable/review/release-v0.2.2/published/repair/project-waiting-windows.png)为琥珀暂停圈；[完成](../../../.impeccable/review/release-v0.2.2/published/repair/project-completed-stale-history-windows.png)保留绿色勾及 `10m`，无边缘重叠；[失败](../../../.impeccable/review/release-v0.2.2/published/repair/project-failed-windows.png)保留红色提醒、诊断编号及移除按钮；[溢出](../../../.impeccable/review/release-v0.2.2/published/repair/project-overflow-windows.png)为九圈加省略号、标题换行且分钟数可见；[ZCode 额度](../../../.impeccable/review/release-v0.2.2/published/mixed/mixed-zcode-quota-windows.png)同时显示两来源任务；[项目详情](../../../.impeccable/review/release-v0.2.2/published/mixed/project-details-windows.png)显示冠名及项目路径。截图全部使用虚构任务；`QuoDex-v0.2.1` 是夹具保存的项目名，按用户命名原样显示，不是程序版本。

macOS CI 产物和正式 DMG 的嵌入版本均为 0.2.2，DMG 内含可执行的 ARM64 Codex 运行时：[内容记录](../../../.impeccable/review/release-v0.2.2/published/macos-content.json)。仅在 Windows 检查包内容，没有进行 macOS 原生运行。

边界：此次按用户要求发布 GitHub，本机已安装的 0.2.1 修复版未替换。等待 / 完成切换及 ZCode 项目 URI 使用协议和系统处理器夹具，未证明真实 ZCode 项目窗口打开；普通工具 pending 仍可能显示未知。重启上移 36px 尚未修复，已写入发布说明。发布后验证记录另随 `main` 提交，不移动正式标签。

## 项目冠名与状态误判修复的本机验证（2026-10-03）

状态：Acceptance pending。用户确认悬停、溢出列表和可访问标题显示“项目名：聊天标题”，圆圈仅保留状态 / 分钟数。Codex 优先取应用保存的项目名，再匹配项目根目录，缺失时使用聊天目录名；ZCode 使用所属项目目录名。没有项目元数据时保留聊天标题，不自动附加版本号。本对话实际项目名为 `QuoDex`。

当时源码：`76e5b925ff3a326ddf72bc8acd136dbb81e5728a`，当时仅本地提交。生产 exe：[QuoDex-0.2.1-local-task-fix.exe](../../../release/QuoDex-0.2.1-local-task-fix.exe)，SHA256 `61061a57c856470723da1732edf5c4a0bee09338cfec9fcbe5689ed74db950d2`。该文件用于替换已安装目录内的 exe，依赖相邻 runtime，不是独立便携包。正常用户安装目录中的程序已替换并经桌面快捷方式启动；版本仍为 0.2.1，当时 GitHub 正式标签和安装包未变。旧 exe 保存在忽略目录 `.scratch/task-status-repair/previous-installed.exe`，可回滚。

根因：真实只读探测发现桌面当前轮次与 SQLite 的旧中断轮次不同。原代码在桌面 idle 时只接受与数据库同一轮次的终态，导致较新的已完成轮次被显示为未知。修复优先使用可信桌面终态及开始时间 + duration；真实运行探测仍由 active / flags / requests 判断，未用旧数据库记录猜测持续运行。缺失、溢出或未来时间保留 QDT-608；成功超过 30 分钟隐藏，失败保留，取消移除。[官方 duration 定义](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)和[历史终态投影](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/thread_history.rs)支持该时间计算。

环境：Windows 11 x64 / PowerShell 7.6.5 / Node 24.18.0 / cargo 1.97.1 / 固定 WebView2 151.0.4129.78 / Codex Desktop 26.930.2377.0。检查使用生产 exe、新配置、新 SQLite、独立 WebView 数据目录、真实窗口与鼠标；提交中的聊天和项目均为虚构数据。

| 执行步骤 | 实际结果与证据 |
| --- | --- |
| `npm.cmd test` / `npm.cmd run build` | 76 项前端测试通过，生产构建通过；[测试](../../../.impeccable/review/task-status-repair/frontend-tests.log) / [构建](../../../.impeccable/review/task-status-repair/frontend-build.log) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 88 项通过，3 项现场测试默认忽略；含不同轮次终态、过期、运行 / 等待 / 取消、无效时间、项目名称与旧 schema 回归；[日志](../../../.impeccable/review/task-status-repair/rust-tests-final.log) |
| `cargo test live_desktop_read_only_smoke -- --ignored --nocapture` | 显式运行通过；跨 18 秒刷新观察到真实运行聊天，无诊断；[日志](../../../.impeccable/review/task-status-repair/live-desktop.log) |
| `npm.cmd run tauri:build -- --no-bundle --config .scratch/installer/tauri.installer.conf.json` | release 生产 exe 构建通过；[日志](../../../.impeccable/review/task-status-repair/native-build.log) |
| `node scripts/verify-task-status.mjs --repair-only` | 6 项原生检查通过；冠名、运行转等待、旧中断历史与新完成轮次、分钟数、溢出、过期和移除；[记录](../../../.impeccable/review/task-status-repair/labels/result.json) |
| `node scripts/verify-task-status.mjs --mixed-only` | 8 项混合来源检查通过；包含 ZCode 冠名、两种额度视图、项目 URI、移除、来源隔离和恢复；[记录](../../../.impeccable/review/task-status-repair/mixed/result.json) |
| `node scripts/verify-task-status.mjs` | 原有 13 项桌面回归通过，含水流像素运动、减少动效、窄条、设置切换和过期；[记录](../../../.impeccable/review/task-status-repair/baseline/result.json) |
| 正常用户桌面快捷方式启动 + 当前聊天只读 / UIA 对照 | 安装 exe 哈希相同，6 个 WebView2 子进程使用安装目录内 runtime；本对话冠名匹配，状态运行中，3 个可见运行圈、0 个未知圈；[运行时](../../../.impeccable/review/task-status-repair/installed-runtime.json) / [当前聊天聚合结果](../../../.impeccable/review/task-status-repair/installed-current-chat.json) |

与批准 V6 的逐项对照：[悬停](../../../.impeccable/review/task-status-repair/labels/project-running-hover-windows.png)显示项目冠名，运行圈保留原水流；[成功](../../../.impeccable/review/task-status-repair/labels/project-completed-stale-history-windows.png)仍为绿色勾和 `10m`，无文字碰边；[失败](../../../.impeccable/review/task-status-repair/labels/project-failed-windows.png)保留可移除提醒及诊断；[溢出](../../../.impeccable/review/task-status-repair/labels/project-overflow-windows.png)仍是九圈加省略号，项目标题换行且显示结束分钟数；[窄条](../../../.impeccable/review/task-status-repair/baseline/narrow-windows.png)与原尺寸一致。圈尺寸、粗边、水流和驾驶舱间隙未修改，生产截图与原生坐标 / 动效断言通过。

限制：真实当前聊天的运行已核对；等待 / 完成切换使用桌面协议夹具复测，没有声称观察到本对话在本轮回复结束后的真实终态。ZCode 活跃与项目跳转仍采用原有夹具验证边界，macOS 未现场验证。首次原生启动探针指定 Codex 虚拟化 AppData runtime 时空白，使用生产产物相邻 runtime 后全部通过；正常用户安装启动已另核对。更新时的偏好文件字节比较失败，复测确认透明度、动效、来源、套餐均未改变，只有既有任务区展开逻辑在重启时令 y 上移 36px；已恢复复测前的位置，重启偏移尚未修复，[记录](../../../.impeccable/review/task-status-repair/preferences-restart.json)。原始复现及真实标题只留本机忽略目录。

## v0.2.1 正式发布与本机安装历史记录（2026-10-02）

发布、安装和指定环境检查：Verified；功能使用验收仍为 Acceptance pending。源码标签 `v0.2.1` 指向 `0bdf0c603c7c065841724d4e6430f89ecb4ea86f`，已推送 `main`。正式 [GitHub Release](https://github.com/bandit0x/QuoDex/releases/tag/v0.2.1) 含 Windows x64 安装器与 macOS arm64 DMG，并已写入中文发布说明。[标签 CI](https://github.com/bandit0x/QuoDex/actions/runs/37019826766) 的两个测试任务、两个打包任务和发布任务全部成功。

当时本机最终安装的是从正式 Release 下载的 Windows 包，300303110 bytes，SHA256 `47c6968ad8b6475dca05d09c5f3b526cbb86e10f8ef1a4c50f29119085076799`，与 GitHub asset digest 完全匹配；安装后的 exe SHA256 `9266080a0068e993077d913dc94e7881bf021b53e4b004ad4a73590b56d04f55`。发布资产与下载核对见 [publication.json](../../../.impeccable/review/release-v0.2.1/published/publication.json)，安装退出码 0、偏好文件未变见 [published-install-result.json](../../../.impeccable/review/release-v0.2.1/published/published-install-result.json)。

Windows 11 x64 / PowerShell 7.6.5 / 固定 WebView2 151.0.4129.78 上，使用隔离 SQLite、命名管道和虚构任务运行安装后的真实 exe，`node scripts/verify-task-status.mjs --mixed-only` 的 8 项原生检查全部通过；脚本 `732f7f2`，原生桥最终修订 `b1a1fb7`。检查包括额度切换时混排、取消、等待、未知、项目 URI、报错移除与重启、溢出、故障隔离恢复、重启残留拦截和 30 分钟过期，详见 [native-result.json](../../../.impeccable/review/release-v0.2.1/published/native-result.json)。

最终从普通桌面快捷方式启动，版本 0.2.1，驾驶舱与 4 个任务 / 2 个运行圈可见；6 个 WebView2 子进程全部使用 `%LOCALAPPDATA%\QuoDex\webview2-runtime`，相邻 Codex CLI 存在：[启动记录](../../../.impeccable/review/release-v0.2.1/published/published-startup-summary.json) / [运行时记录](../../../.impeccable/review/release-v0.2.1/published/runtime-check.json)。用户真实标题未进入提交。

正式包截图与批准的 V6 对照：[ZCode 额度混排](../../../.impeccable/review/release-v0.2.1/published/mixed-zcode-quota-windows.png) 保持透明单行、粗水流和圈内勾 / `10m`；[溢出](../../../.impeccable/review/release-v0.2.1/published/mixed-overflow-windows.png) 为九圈加省略号；[项目详情](../../../.impeccable/review/release-v0.2.1/published/project-details-windows.png) 与[空任务高度](../../../.impeccable/review/release-v0.2.1/published/mixed-empty-windows.png) 通过原生断言。渲染代码未改，动效与窄条的完整证据沿用下方已验证记录。截图数据为虚构夹具。

补充复测曾出现鼠标已移到报错圈、详情仍保留先前完成任务的情况；保存失败截图后，在激活窗口后等待 300ms 并重新读取按钮坐标，诊断脚本与移除探针后的正式脚本均通过全部 8 项检查。修订只在测试桥，未修改发布产品、注入 UI 状态或删除断言。复现留在忽略目录 `.scratch/release-v0.2.1/`。

旧 0.2.0 应用已停止、快捷方式已替换；纯应用目录核对后移出 `release`，归档到 `.scratch/retired-apps/QuoDex-0.2.0-win-x64`。永久删除被自动审批拒绝，归档副本仍在磁盘，用户配置未删除。macOS 只完成 CI 构建测试，真实 ZCode 活动 / 等待与项目窗口跳转仍待用户使用验收；不得扩大为所有平台与真实状态旅程均已验证。

## 发布前安装包验证记录（2026-10-02）

以下是正式 CI 包发布前的本地安装验证，该次最终安装包见上方 v0.2.1 历史记录。本地安装包构建来源 `678d510`，原生验证脚本 `732f7f2`。Windows 11 x64 / PowerShell 7.6.5，固定 WebView2 151.0.4129.78。安装产物为 `release/QuoDex-0.2.1-win-x64-setup.exe`，300331600 bytes，SHA256 `f7b683dd594ccdc0409048fdd2efabc39c2a6b3aa590e4782a13b15d58c77ef5`；当时安装的 exe SHA256 `6e2a15466bb7cfbe1251430ae35a72b9b7ebf6a1307f777450fcc703104fb78c`。

| 执行步骤 | 实际结果与证据 |
| --- | --- |
| PowerShell 7 执行 `scripts/package-installer.ps1 -WebView2RuntimePath release/QuoDex-0.2.1-win-x64/webview2-runtime` | TypeScript / Vite / Rust release / NSIS 构建通过；运行时作为相邻资源打包，避免 Tauri `fixedRuntime` 把开发机绝对路径带到运行时 |
| 在 Codex MSIX 外的普通 PowerShell 7 进程执行安装器 `/S` | 用户目录安装、卸载登记版本 0.2.1；安装前后偏好文件哈希一致，[install-result.json](../../../.impeccable/review/release-v0.2.1/install-result.json) |
| 设置交付 exe 与隔离数据目录，运行 `node scripts/verify-task-status.mjs --mixed-only` | 8 项原生旅程通过，[native-result.json](../../../.impeccable/review/release-v0.2.1/native-result.json)：混排、额度切换、项目 URI、失败移除及重启、溢出、两来源故障隔离及恢复、运行旧记录拦截、成功过期 |
| 普通桌面快捷方式启动安装版，检查窗口与子进程 | 驾驶舱可见、2 个运行任务；6 个 WebView2 子进程均使用安装目录内运行时，Codex CLI 文件存在，[startup-summary.json](../../../.impeccable/review/release-v0.2.1/startup-summary.json) / [runtime-check.json](../../../.impeccable/review/release-v0.2.1/runtime-check.json) |
| `cargo test live_ -- --ignored --nocapture` | 两项现场只读测试通过：Codex 4 个记录 / 2 个运行，ZCode 1 个报错 / 无运行；无诊断，[live-readonly.log](../../../.impeccable/review/release-v0.2.1/live-readonly.log) |
| 核对旧版清单、进程，再移出旧应用目录 | 0.2.0 的 260 文件哈希全部匹配、无额外文件、无进程。永久删除被自动审批拒绝，改为归档 `.scratch/retired-apps/QuoDex-0.2.0-win-x64`；快捷方式指向新安装版，不删除用户配置，[old-package-check.json](../../../.impeccable/review/release-v0.2.1/old-package-check.json) / [old-removal.json](../../../.impeccable/review/release-v0.2.1/old-removal.json) |
| GitHub `main` 来源 `678d510` 的 CI | Windows / macOS 类型检查、前端测试、生产构建与 Rust 测试通过：[run 37017148404](https://github.com/bandit0x/QuoDex/actions/runs/37017148404)。该运行不包含 tag 打包与发布 |

安装版截图对照：沿用批准的 V6，任务为同一透明单行、标准间隙与粗水流；[ZCode 额度混排](../../../.impeccable/review/release-v0.2.1/mixed-zcode-quota-windows.png) 保留绿色勾与 `10m`；[溢出](../../../.impeccable/review/release-v0.2.1/mixed-overflow-windows.png) 为九圈加省略号，[详情](../../../.impeccable/review/release-v0.2.1/project-details-windows.png) 和[空任务](../../../.impeccable/review/release-v0.2.1/mixed-empty-windows.png) 通过原生尺寸断言。截图使用虚构任务；真实用户窗口截图只保留在忽略目录。原渲染代码未改，运动及窄条证据见下方完整回归记录。

安装排查记录：首次生成器相对路径以 `src-tauri` 为基准导致打包失败；改为绝对输入后实际运行发现 Tauri 使用开发目录，改成映射相邻资源并由应用选择运行时。Codex MSIX 启动的安装器会虚拟化 AppData 与卸载登记，外部进程证明原位置不可访问后重新在普通用户进程安装；桌面快捷方式与外部注册检查通过。原生移除测试曾在详情窗口展开时提前取点击坐标；改为等待最终高度与移除结果，未降低产品断言。复现日志留在 `.scratch/release-v0.2.1/`。

测试保留用户正在运行的真实 ZCode 进程，通过把虚构执行记录设置为早于该进程创建来验证重启残留不继续动画。没有声称真实 ZCode 活动轮次或项目窗口跳转已通过；macOS 本轮只由 CI 编译和测试，现场边界仍见下方。

## 当前 ZCode 接入（2026-10-02）

状态：Acceptance pending。用户已批准接入并测试，接受 ZCode 圆圈打开所属项目；Codex 圆圈继续打开聊天。ZCode 与 Codex 在现有任务栏混排，不按来源分组，额度来源切换独立于任务来源。保留 V6 圈尺寸、间隙、粗水流与完成分钟数。

适配读取本机 ZCode 3.14.4 的 `v2/tasks-index.sqlite` 和 `cli/db/db.sqlite` 执行元数据，连接均为只读；不用任务索引中混合成功/中断的投影状态代替轮次结果。旧任务无 `turn_usage` 时仅选择末条消息的角色、结束时间、结束原因与错误类型，不读取正文。最新轮次取消移除；成功按实际结束时间保留 30 分钟；报错复用持久提醒。Windows 同一用户会话中的 ZCode 进程创建时间用于拦截退出/重启后的残留运行记录，两来源故障隔离。

限制：ZCode 没有公开聊天直达协议，因此采用已确认的 `zcode://workspace/open?path=...`；普通工具 pending 无法区分排队与批准，显示未知（QDT-625），`AskUserQuestion` 显示等待。根进程存活检查不能证明单个 Agent 子进程健康；ZCode 私有实时通道和非 Windows 活跃任务兼容性未承诺。

调研：选择复用 QuoDex 状态模型和界面，按 [ZCode 官方源码](https://github.com/zai-org/ZCode)适配本机版本（Apache-2.0，GitHub pushed 2026-09-29）；参考 [OpenCode](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/status.ts) 的每会话活动状态（MIT，pushed 2026-10-02），不套用其接口；[Claude Code](https://github.com/anthropics/claude-code) hooks 下载未完成且授权未核对，不作为依赖。源代码调研记录在忽略的 `.scratch/zcode-tasks/`。

### 本轮交付与验证

产品来源：`a7ede53`；最终原生验证脚本：`4a40f4f`。便携包 [QuoDex.exe](../../../release/QuoDex-0.2.1-win-x64/QuoDex.exe) / [manifest.json](../../../release/QuoDex-0.2.1-win-x64/manifest.json)，版本 0.2.1，须保留相邻 runtime。exe SHA256：`06afc8e76feeb082b7c5f9c6294771eceb4cf15192501a66e1164a4a4833fcfa`。

环境：Windows 11 x64 / NT 10.0.26200，PowerShell 7.6.5，Node 24.18.0 / npm 11.16.0，cargo 1.97.1，固定 WebView2 151.0.4129.78。原生脚本每次新建配置、SQLite 与 WebView 数据；实际鼠标 / UI Automation 操作发布 exe，聊天数据为虚构夹具，未注入前端状态。

| 执行步骤 | 实际结果 / 证据 |
| --- | --- |
| `npm.cmd test` | 7 文件 / 75 项通过，[前端日志](../../../.impeccable/review/zcode-tasks/frontend-tests.log)，含 ZCode 额度下同时显示两来源与项目点击 |
| `cargo test`（src-tauri） | 84 项通过 / 3 项默认忽略，[Rust 日志](../../../.impeccable/review/zcode-tasks/rust-tests.log)，含最新轮次、取消、结束时间、子任务排除、等待、旧记录与故障恢复 |
| `cargo test live_ -- --ignored --nocapture` | 上面两个现场读取测试显式运行通过，[只读日志](../../../.impeccable/review/zcode-tasks/live-readonly.log)：Codex 4 个可见记录 / 2 个运行；ZCode 1 个保留报错，无活动轮次。另一个已有 ZCode 额度现场探测测试不在本轮任务状态范围，未运行 |
| PowerShell 7 执行 `scripts/package-portable.ps1 -WebView2RuntimePath release/QuoDex-0.2.0-win-x64/webview2-runtime` | `tsc` / Vite / Rust release 构建通过，261 文件便携目录，[构建日志](../../../.impeccable/review/zcode-tasks/build.log) |
| 设置 `QUODEX_EXECUTABLE` 为交付 exe、`QUODEX_PWSH` 为 PowerShell 7、`QUODEX_TASK_REVIEW_DIR` 为本轮 review 目录，执行 `node scripts/verify-task-status.mjs --mixed-only` | 8 项混合原生检查通过，[result.json](../../../.impeccable/review/zcode-tasks/result.json) / [日志](../../../.impeccable/review/zcode-tasks/native-mixed.log)：两种额度下混排、取消移除、等待与未知、项目 URI、报错持久化、13 个任务溢出、两来源故障隔离、恢复、退出后不动画、30 分钟过期 |
| review 输出目录改为 `zcode-tasks/codex-regression`，执行 `node scripts/verify-task-status.mjs` | 13 项原有旅程通过，[result.json](../../../.impeccable/review/zcode-tasks/codex-regression/result.json) / [日志](../../../.impeccable/review/zcode-tasks/native-regression.log)，含水流、减少动效、设置、窄条、0m / 29m / 30m、Pro |
| 260 个清单文件哈希与测试前的系统配置核对 | 全部匹配；原 ZCode 协议处理器及 Desktop 快捷方式已恢复，[artifact-check.json](../../../.impeccable/review/zcode-tasks/artifact-check.json) |

| 与批准 V6 对照 | 本轮真实产物证据与观察 |
| --- | --- |
| 同一透明单行，不增加任务来源徽章 | [Codex 额度](../../../.impeccable/review/zcode-tasks/mixed-codex-quota-windows.png)、[ZCode 额度](../../../.impeccable/review/zcode-tasks/mixed-zcode-quota-windows.png)：相同状态栏，额度舱按选中来源显示 |
| 完成圈内勾与分钟、悬停和点击目标 | [项目详情](../../../.impeccable/review/zcode-tasks/project-details-windows.png)、[29m](../../../.impeccable/review/zcode-tasks/codex-regression/age-29m-windows.png)：圈内无重叠，详情展示所属路径；[系统 URI 捕获](../../../.impeccable/review/zcode-tasks/project-dispatch.json) 确认中文与空格路径解码正确 |
| 超额九圈加省略号，窄条排版保持 | [混合溢出](../../../.impeccable/review/zcode-tasks/mixed-overflow-windows.png)、[窄条](../../../.impeccable/review/zcode-tasks/codex-regression/narrow-windows.png)：其余任务可点，列表可滚动，未增加第二行 |
| V6 间隙与水流继续有效 | [尺寸记录](../../../.impeccable/review/zcode-tasks/codex-regression/layout-metrics.json)：标准 7.3px，与 7.4px 目标在 1px 原生取整容差内；窄条通过 3.9px 断言。渲染代码未改；[运动测量](../../../.impeccable/review/zcode-tasks/codex-regression/motion-summary.json) 为 61 帧 / 7645ms，亮纹移动 13.97px，减少动效 0.28px |

复核的数据流：ZCode 执行元数据 → 独立只读来源快照 → 两来源合并排序与持久提醒 → 与额度来源独立的任务栏 → 后端核对索引中所属项目 → 公共 workspace URI。身份包含来源 / 工作区，项目路径不是前端任意输入。简化为共用排序函数并每次快照只准备一次工具元数据查询；相应分支已由上述测试覆盖。

本轮验证脚本曾错误使用 UIA 的 `texts` 字段及混合大小写来源名，保存复现后改为真实返回的 `names` / `ZCODE`。截图背景还受到隐藏启动参数影响；改为仅显示自有验证窗口，并在截图前核对可见性及透明角落像素。以上修复均在验证脚本，产品没有为通过检查修改状态或降低断言；最终两套原生检查均重新运行。早期截图已被最终隔离背景截图替换，原始失败记录留在 `.scratch/zcode-tasks/`。

现场边界：真实 ZCode 旧任务读取已证明，但没有真实正在执行 / 等待的 ZCode 轮次可复测；运行、等待与退出检查使用执行元数据及同名进程夹具。项目点击只证明真实 QuoDex 鼠标点击进入系统协议处理器，使用临时捕获处理器并恢复原值，未声称实际 ZCode 项目窗口打开。真实活动轮次和项目窗口跳转仍待用户验收；不得把这些夹具检查扩大为现场全部旅程通过。

## 历史 V6 修订：间隙减半、运行水流加粗（2026-10-02）

修订状态：Acceptance pending。用户明确要求任务状态行与主窗间距缩短 50%、运行框线增加 100%；这是已批准 V5 风格中的精确尺寸调整。构建、测试与完整原生检查通过，独立视觉复核结论为 ship，等待用户验收。

- 标准 / 展开视图以可见圈下沿到驾驶舱上沿计，间隙 14.8 → 7.4 逻辑 px；窄条 7.8 → 3.9px。移动任务行而保留原点击尺寸与驾驶舱锚点，设置上方任务行同步移动。
- 运行水流实际宽度 0.72–1.2 → 1.44–2.4 逻辑 px，Canvas 未就绪的后备边框也翻倍；20.4px 外径继续保持，厚度向圈内增加。完成 / 等待 / 失败 / 未知描边不在这次修改范围中。
- 拖尾、波峰合分、轮廓变化和 2.8 秒轻呼吸继续沿用 V5。任务空间仍为 36px，窗口尺寸与各状态切换沿用；`0m` / `10m` / `29m` 排版继续使用统一 SVG。
- 产品与构建来源提交：`58a8f16`；最终原生交互脚本来源：`d4aae40`。TDD 先验证加粗水纹应进入圈内 7.3–8.1px 区间：旧实现像素绿色值 23，断言失败；新实现通过。

当前验收：真实紧凑 / 窄条可见间隙各减半（原生像素取整容差 1px）；运行圈边缘宽度翻倍且波峰仍移动形变；悬停、溢出、分钟与设置无裁切。证据保存在 `.impeccable/review/task-water-v6/`。

### 当前 V6 产物与证据

便携产物：[QuoDex.exe](../../../release/QuoDex-0.2.1-win-x64/QuoDex.exe)，须保留相邻 runtime；[manifest.json](../../../release/QuoDex-0.2.1-win-x64/manifest.json) 来源 `58a8f16`，版本 0.2.1。exe SHA256：`2861ce8924d9428e91ada6cb91219e26f80bd6450a590f1f70fd2f921d12af35`。

环境：Windows x64 / NT 10.0.26200，PowerShell 7.6.5，Node 24.18.0 / npm 11.16.0，cargo 1.97.1，固定 WebView2 151.0.4129.78。

| 执行步骤 | 本轮结果与证据 |
| --- | --- |
| `npm test` | 7 文件 / 74 项通过；[前端日志](../../../.impeccable/review/task-water-v6/frontend-tests.log)，含更厚边缘的像素断言和原动效生命周期 |
| `cargo test`（src-tauri） | 77 项通过 / 2 项默认忽略；[Rust 日志](../../../.impeccable/review/task-water-v6/rust-tests.log) |
| PowerShell 7 执行 `scripts/package-portable.ps1 -WebView2RuntimePath release/QuoDex-0.2.0-win-x64/webview2-runtime` | `tsc` / Vite / Rust release 通过，261 文件便携目录；[构建日志](../../../.impeccable/review/task-water-v6/build.log) |
| 以交付 exe、PowerShell 7 和 `.impeccable/review/task-water-v6` 分别设置 `QUODEX_EXECUTABLE` / `QUODEX_PWSH` / `QUODEX_TASK_REVIEW_DIR` 后执行 `node scripts/verify-task-status.mjs` | 新建隔离 SQLite / 配置 / WebView 数据，使用实际鼠标点击，通过完整原生旅程；[result.json](../../../.impeccable/review/task-water-v6/result.json)，原日志 `.scratch/task-water-logs/v6-native-physical.log` |
| `cargo test task_status::tests::live_desktop_read_only_smoke -- --ignored --nocapture` | 实际来源跨 18 秒刷新无诊断；[只读来源日志](../../../.impeccable/review/task-water-v6/live-readonly.log)。此项显式执行上面一个 ignored 测试，未扩展为现场等待或真实跳转检查 |
| 260 个文件哈希与原快捷方式核对 | 无哈希不匹配，原 Desktop 快捷方式与备份逐字节相同；[artifact-check.json](../../../.impeccable/review/task-water-v6/artifact-check.json) |
| 单次 layout detector 与 fresh impeccable finish-reviewer | detector `[]`；[独立视觉复核](../../../.impeccable/review/task-water-v6/finish-review.md) disposition: ship，全部 15 张场景与运动证据审查，无 material_fixes；其范围为视觉，不代替现场任务验收 |

| 对照项 | 原生证据 |
| --- | --- |
| 标准 / 窄条间隙减半 | [日常](../../../.impeccable/review/task-water-v6/compact-daily-windows.png)、[窄条](../../../.impeccable/review/task-water-v6/narrow-windows.png)；[UIA 中心测量](../../../.impeccable/review/task-water-v6/layout-metrics.json) 得标准间隙 7.3px，与目标 7.4px 一致。驾驶舱上沿按当前布局计算，窄条也通过 3.9px / 1px 取整容差断言 |
| 运行宽度加倍、流动形变继续 | [10 个运行](../../../.impeccable/review/task-water-v6/ten-running-windows.png)、[原生动图](../../../.impeccable/review/task-water-v6/native-water-motion.gif)，61 帧 / 7552ms，按原始时序未加速；[运动测量](../../../.impeccable/review/task-water-v6/motion-summary.json) 亮纹质心移动约 12.79px，减少动效约 0.39px |
| 完成分钟、弹层、设置与空态 | [0m](../../../.impeccable/review/task-water-v6/age-0m-windows.png)、[29m](../../../.impeccable/review/task-water-v6/age-29m-windows.png)、[溢出 29m](../../../.impeccable/review/task-water-v6/overflow-29m-windows.png)、[悬停](../../../.impeccable/review/task-water-v6/hover-windows.png)、[设置](../../../.impeccable/review/task-water-v6/settings-windows.png)、[空态](../../../.impeccable/review/task-water-v6/empty-windows.png)、[Pro](../../../.impeccable/review/task-water-v6/pro-windows.png) |

本轮自动化失效边界与修复：脚本动作 → UIA / 鼠标 → DOM click / hover → React 布局 → 原生窗口 → 高度断言。首次设置关闭时旧鼠标位置触发聊天 hover，导致正常详情区增加 160px；关闭设置后移开鼠标。一次过宽的移开处理又使溢出列表正常自动关闭，已收窄。随后记录证明 `ExpandCollapsePattern` 操作后仍保持紧凑标签与 166px，未触发 React click；交互脚本改为真实鼠标点击。设置最小往返先通过，再通过完整旅程。三份最小复现分别保留于 `.scratch/task-status-native-dY7kFf/`、`task-status-native-i0XFqQ/`、`task-status-native-wo9Gxt/`。诊断期间冻结产品改动，只修复测试动作语义，没有降低窗口尺寸断言。

单次 layout detector 为 `[]`。聚合 CPU 采样见 [performance.json](../../../.impeccable/review/task-water-v6/performance.json)，包含额度、后端与 WebView 进程，不能单独归因于水流。截图使用虚构聊天 / 额度但来自交付原生 exe；真实等待事件与本轮现场聊天跳转仍未证明，保持用户验收边界。

## 历史 V5 修订：呼吸灯与水流边缘（2026-10-02）

V5 当时状态：Acceptance pending。用户于 2026-10-02 明确“批准，可以实施”，批准 V5 逐帧变化的水纹。独立视觉复核结论为 ship；之后用户要求上方 V6 的间隙与运行框线调整。V3 因水流几乎看不见被拒绝，V4 因固定蒙版不够灵动被拒绝；旧稿保留用于复现。

- 可见直径从 24 降至 20.4 逻辑像素，边框从 1 增至 1.2；点击区域与单行容量继续沿用。
- 运行时柔和呼吸（2.8 秒）。水纹使用逐帧变化的非对称波峰，主流和追随流以约 2.6 / 3.9 秒的基础周期前进，速度、前沿宽度与拖尾长度持续变化；追赶时汇合，错开后分开。径向轮廓内收 0–0.34px，亮纹宽度 0.72–1.2px，局部起伏保持在 20.4px 外轮廓内。圆心留空，不增加内轨、准星或转子。
- 完成勾与分钟使用同一个 SVG 坐标系向圆心收拢，以最宽的 `29m` 检查边缘留白；溢出列表中的说明文字样式已限定在外层，避免覆盖圈内分钟。
- 减少动效时去除空间流动，保留低幅度呼吸；隐藏时暂停。具体成本及真实浮窗视觉须在实现后验证。
- 验收边界：真实产物的主任务行与溢出列表均使用新尺寸及边框；`0m` / `10m` / `29m` 不碰边；运行连续帧同时呈现呼吸、清楚的边缘流动，以及波峰和拖尾的形变；10 位单行、溢出操作和空任务收起继续有效。

失效边界：数据 → 运行状态 → 动画渲染 → 20.4px 栅格化 → 用户扫读。V3 的亮暗差与速度不足；V4 的形状只由固定渐变和固定环形蒙版旋转形成，缺少随时间变化的波峰宽度、拖尾与轮廓。问题在动画渲染，未发现任务数据问题。V5 重新计算波场和可变边缘，每帧绘制小幅形变，保留 V4 的可见度；实际尺寸直接可辨，放大图不能代替判断。

预览：[动态页面](../../../.impeccable/mocks/task-status/v3/index.html)、[浏览器截图](../../../.impeccable/mocks/task-status/v3/water-v5-preview.jpg)、[实际尺寸和放大细节动图](../../../.impeccable/mocks/task-status/v3/water-v5-motion.gif)。通过 CUA 在 304px 浏览器视口采集 225 帧，跨度 7199ms，按实际帧时间编码，未加速；原帧与时间记录在 `.scratch/task-water-v5-frames/`。设计脚本语法检查通过，浏览器中暂停/播放按钮已核对。绘制由一个共享循环驱动，上限 30 次/秒、DPR 上限 2，隐藏/暂停/减少动效时停止 Canvas 循环；真实原生产物的性能须在批准实现后测量。

页面中的驾驶舱为既有原生截图，任务圈为演示，不能作为真实产品验证，也不能代替用户对水流观感的审核。旧复杂方向保存在 `v3/rejected-orbit-options.html`；弱水流源码在 `155b0a7`，固定蒙版水流源码在 `246357a`，旧截图与动图保留以便复现。

### 历史 V5 产物与复现证据

当时产品源码：`499621b`；构建来源提交：`fa1655a`，分支 `feature/v0.2.1-task-status`。历史便携路径 `release/QuoDex-0.2.1-win-x64/QuoDex.exe` 与 manifest 已被 V6 产物覆盖；当时 manifest 记录 260 个文件哈希，exe SHA256：`cb965024462158098ef6029d3bed30ee0d518e04769bcf5cd5b82089b025f16d`。以下截图与日志仍仅覆盖 V5。

环境：Windows x64 / NT 10.0.26200，PowerShell 7.6.5，Node 24.18.0 / npm 11.16.0，cargo 1.97.1，固定 WebView2 151.0.4129.78。验证日志统一保留于忽略目录 `.scratch/task-water-logs/`。

| 执行步骤 | 本次实际结果 |
| --- | --- |
| `npm test` | 7 文件 / 74 项通过，含运行 Canvas → 完成 SVG 切换、逐帧变化、减少动效与卸载停止；`final-frontend.log` |
| `cargo test`（src-tauri） | 77 项通过、2 项默认忽略；`final-rust.log` |
| PowerShell 7 执行 `scripts/package-portable.ps1 -WebView2RuntimePath release/QuoDex-0.2.0-win-x64/webview2-runtime` | `tsc`、Vite、Rust release 构建通过，生成 261 文件便携目录；`final-package.log` |
| 指定 `QUODEX_EXECUTABLE` 为交付 exe、`QUODEX_PWSH` 为 PowerShell 7、`QUODEX_TASK_REVIEW_DIR=.impeccable/review/task-water-v5` 后执行 `node scripts/verify-task-status.mjs` | 新建 SQLite / 配置 / WebView 数据，完整启动实际 exe，通过运行、等待、报错移除及重启、单行溢出、分钟、减少动效、窄条、设置、取消、断连与 Pro 检查；[原生记录](../../../.impeccable/review/task-water-v5/result.json)，`final-native.log` |
| `cargo test task_status::tests::live_desktop_read_only_smoke -- --ignored --nocapture` | 真实来源观察到 4 个聊天状态，其中 2 个运行、0 个等待，跨 18 秒刷新无诊断；`final-live.log`。此项显式执行了上面的一个 ignored 测试 |
| 便携目录哈希与快捷方式恢复核对 | [artifact-check.json](../../../.impeccable/review/task-water-v5/artifact-check.json)：260 文件哈希匹配，原 Desktop 快捷方式与备份逐字节一致 |
| 单次 CSS detector、fresh impeccable finish-reviewer | detector `[]`；[独立视觉复核](../../../.impeccable/review/task-water-v5/finish-review.md) disposition: ship，15 个原生场景及选帧无 material_fixes；这是视觉文件复核，不扩大为现场等待或跳转验收 |

可审阅的本次日志副本：[前端](../../../.impeccable/review/task-water-v5/frontend-tests.log)、[Rust](../../../.impeccable/review/task-water-v5/rust-tests.log)、[构建](../../../.impeccable/review/task-water-v5/build.log)、[真实来源只读检查](../../../.impeccable/review/task-water-v5/live-readonly.log)。代码复核核对了按聊天保持身份、Canvas / 观察器 / 媒体事件的卸载清理、app 与系统减少动效接入、完成 SVG 的统一坐标及列表样式边界；相应运行切换与动效生命周期测试见前端日志。

| 批准项 | 当前原生对照 |
| --- | --- |
| 20.4px 可见直径、1.2px 名义边框、点击区域保留 | [日常](../../../.impeccable/review/task-water-v5/compact-daily-windows.png)、[10 个运行](../../../.impeccable/review/task-water-v5/ten-running-windows.png)；UIA 命中边界约 28 × 28 物理像素（原 27 × 28 逻辑尺寸取整） |
| 呼吸与变化的水流边缘 | [原生动图](../../../.impeccable/review/task-water-v5/native-water-motion.gif)、[61 帧测量](../../../.impeccable/review/task-water-v5/pulse.json)，跨度 7524ms，按原始帧时间编码未加速；波峰亮纹质心移动大于 2px |
| 完成勾与分钟不碰边 | [0m](../../../.impeccable/review/task-water-v5/age-0m-windows.png)、[10m](../../../.impeccable/review/task-water-v5/ten-slots-windows.png)、[29m](../../../.impeccable/review/task-water-v5/age-29m-windows.png)、[溢出 29m](../../../.impeccable/review/task-water-v5/overflow-29m-windows.png) |
| 10 位、溢出、等待、失败、空态与驾驶舱共存 | [10 位](../../../.impeccable/review/task-water-v5/ten-slots-windows.png)、[溢出](../../../.impeccable/review/task-water-v5/overflow-windows.png)、[等待与失败](../../../.impeccable/review/task-water-v5/attention-windows.png)、[空态](../../../.impeccable/review/task-water-v5/empty-windows.png)、[窄条](../../../.impeccable/review/task-water-v5/narrow-windows.png)、[设置](../../../.impeccable/review/task-water-v5/settings-windows.png)、[Pro](../../../.impeccable/review/task-water-v5/pro-windows.png) |
| 减少动效停止空间流动 | 原生设置开启后的 [15 帧](../../../.impeccable/review/task-water-v5/reduced-motion.json)，亮纹质心移动小于 1.5px；低幅度呼吸仍保留 |

本次原生运动检查的首次失败来自测量边界：28px 透明点击区包含桌面白色背景，掩盖了亮纹质心移动。复现保留在 `.scratch/task-water-diagnosis/`；修正为只采样圈内半径 8–9.6px 的不透明边缘后通过原有移动阈值，并要求每帧存在可见亮纹。尺寸、可见性和减少动效诊断均正常，诊断代码已移除，未为通过检查修改产品水流。

[聚合 CPU 采样](../../../.impeccable/review/task-water-v5/performance.json)：10 个运行时约 6.93s 内 1.609 CPU 秒，10 个完成时约 6.944s 内 0.844 CPU 秒；范围是整个自有 app 进程树，包含额度动效、后端和 WebView 进程启停，不能将差值归因于水流或当作系统 CPU 百分比。渲染实现共用一条 30fps 上限循环，隐藏与减少动效会停 Canvas。

所有新 UI 截图来自交付 exe 的虚构聊天与额度数据；透明区域保留捕获时真实桌面或原生验证背景。原生夹具不证明现场等待事件或真实聊天跳转；本次现场只读来源通过，真实跳转的历史证据在 V2 节。当前没有现场等待事件可复测，该旅程仍待用户验收；Desktop 内部协议对其他版本的兼容性不能保证。

## 已确认需求

监测当前电脑 Codex 桌面应用的所有聊天，包含其他项目。每个聊天一个圆圈，同一聊天再次执行时复用。

运行显示带持续活动动画的圆圈；成功在绿色圈内同时显示绿色勾与完成分钟数（如 `10m`），保留 30 分钟；等待批准或信息用琥珀色暂停圈；报错用红色感叹号圈；取消后移除。悬停显示名称与状态，点击打开对应聊天。任务区最多一行，超出容量用 `...` 表示，点击展开其余聊天列表，可继续打开对应聊天。

## 设计范围

沿用现有驾驶舱材质与内容。用户已选择 C：上方透明横排。以 300 × 130 紧凑驾驶舱为基准，包含双仓与 Pro 单仓兼容性。当前图为演示数据设计稿，未接入真实任务。

用户于 2026-10-02 批准 C / V2 完整设计并授权实现。该批准涵盖上方单行、圈内勾与完成分钟数、活动脉冲，以及点击 `...` 展开其余聊天列表。

用户补充确认：报错圈保留到再次运行或手动移除；没有可展示任务时收掉透明任务空间，恢复原窗口高度。

当前布局沿用 C / V2，取代先前的“两排 + 滚动”设想；圈的尺寸、分钟排版与运行动画采用 V5，间隙与运行水流宽度按用户要求采用上方 V6 修订。原 A/B/C 图仅作为方向选择记录。

## 方向合同与审查依据

以下五块整理已批准的 C 布局、V5 动效与 V6 尺寸修订，是收尾记录。

- **THESIS**：在原额度驾驶舱上方直接看见各聊天的运行与近期结果。
- **OWN-WORLD**：继承 QuoDex 已有透明浮窗、玻璃驾驶舱、字体与额度内容；新增任务圈使用同一青色 / 绿色视觉语言。
- **STORY**：扫读圆圈 → 悬停辨认聊天与原因 → 点击打开聊天；超出容量时通过 `...` 继续查看。
- **FIRST VIEWPORT**：真实紧凑窗口以原 300 × 130 为基础，任务行增加 36 逻辑像素；详情临时增加 160，空任务恢复原高度。
- **FORM**：上方透明单行 20.4px 圆圈；完成状态使用同一 SVG 中的勾与分钟，运行状态使用呼吸灯和逐帧变化的水流边缘，不增加转子或内轨。属于现有界面的局部组件扩展，适用 impeccable `reference/new-work.md` 的 “Extend an existing surface” 及 “Never run the script for a local extension or a precisely specified narrow request”。因此没有运行 concept-seed，也不存在 seed key；不事后补造 seed。

**QUALITY BAR**：标准 / 窄条的可见间隙分别减半到 7.4 / 3.9px，运行水流厚度翻倍到 1.44–2.4px；在实际 300px 窗口里勾与 `0m` / `10m` / `29m` 同时可辨且不碰边；运行水流的亮纹明确移动并有形变的真实连续帧证据；减少动效时水流位置稳定；单行容量与 `...` 符合规则；详情完整可操作且不遮额度数字；未知不冒充成功；驾驶舱材质保持既有实现。

V2 批准图是 1536 × 1024 多场景说明板，尺度以本文件的 300px 驾驶舱为准。V5 进一步批准实际圈直径 20.4 逻辑像素，仍容纳 10 位；`.impeccable/review/hero-repro.png` 是历史 V2 原生截图，当前 V5 证据使用独立目录。生成图的装饰比例不替代真实浮窗尺寸约束。

## V2 交互与布局规则（已批准）

- **最多一行**：紧凑视图目标为 10 个状态位；10 个以内全部显示，超出则显示 9 个聊天圈加 `...`。窄条按可用宽度减少容量，不换行、不扩大任务条高度、不增加任务条滚动。
- **溢出入口**：点击 `...` 展开其余聊天的临时列表，列出名称、状态与完成分钟数，可点击打开对应聊天。关闭列表后仍只保留单行任务条。
- **完成标识**：绿色勾在圈内上半部，`10m` 等分钟数在圈内下半部。使用真实完成时间按分钟向下取整，从 `0m` 开始；距完成时间达到 30 分钟时移除。不能从发现任务的时间或启动 QuoDex 的时间重新计时。
- **活动动画**：运行圈采用上方 V5 修订的 2.8 秒呼吸与变化的水流边缘。等待、完成、报错与未知圈不做活动动画。减少动效时保留低幅度透明度脉冲，停止空间流动。
- **排序与身份**：每个聊天只有一个圈，最新执行轮次复用它；运行、等待与报错优先显示，近期成功随后。同状态顺序保持稳定，不能每次轮询随机重排。更多运行任务被收进列表时，`...` 也需给出轻微活动提示。
- **报错提醒**：保留到同一聊天再次运行或手动移除；手动移除只针对该次报错，未来新一轮仍正常出现。悬停提示中的“移除提醒”是低风险操作，一次提交。
- **空状态**：确认没有可展示聊天时收掉整个任务区，恢复原窗口高度。尽量维持驾驶舱在屏幕上的位置；靠近屏幕边界时按实际工作区约束摆放。
- **未知状态**：有已知聊天但无法确认运行状态时用灰色未知圈；没有任何已知聊天且读取失败时显示明确的“任务状态不可用”，不能伪造某个聊天、伪造 0 个任务或绿色完成。
- **弹出层**：悬停详情与溢出列表要完整可读、可交互；不得被原生窗口裁切，不得挡住驾驶舱关键数字。任务圈显示不随额度源轮播而消失。

图中的逻辑尺寸用于尺度参考；圈内勾与分钟数必须同时可读。实际动画、对比度、命中区域与原生窗口行为需要在批准实现后用真实产物验证。

## V2 完整状态图（已批准）

| 设计图 | 展示场景 |
| --- | --- |
| [日常状态](../../../.impeccable/mocks/task-status/c-daily-states-v2.png) | 两个运行圈与圈内勾 / `10m`；完成后的分钟数变化；Pro 单仓；空任务区收起 |
| [等待、报错与详情](../../../.impeccable/mocks/task-status/c-attention-states-v2.png) | 悬停详情；琥珀暂停；报错常驻与手动移除；灰色未知 |
| [单行、溢出与动效分镜](../../../.impeccable/mocks/task-status/c-layout-motion-v2.png) | 10 个状态位；9 个聊天圈加 `...` 与其余聊天列表；窄条；运行圈呼吸脉冲分镜 |

以上为演示数据设计图。运行圈的三个时间帧是同一个聊天的动画分镜，不是三个任务；静态分镜不能证明动画已经运行。批准后须在真实产物中录制或连续采集至少一个完整脉冲周期，并核对单行容量、圈内分钟数、30 分钟移除和空任务收起。

## 历史 V2 验收证据（2026-10-02，已被 V5 产物替代）

当时产品源码版本：`262dc77`，分支 `feature/v0.2.1-task-status`。当时便携路径为 `release/QuoDex-0.2.1-win-x64/QuoDex.exe`，该目录与 manifest 现已由上方 V5 产物覆盖。历史可执行文件 SHA256：`cf8a68cc7d05e1c2096a1a9b9f3c11abc22198ed9ab3cfac6aefb19287db6573`；以下记录只证明当时的 V2 检查。

验证环境：Windows x64 / NT 10.0.26200；PowerShell 7.6.5；Node 24.18.0 / npm 11.16.0；cargo 1.97.1；包内 WebView2 151.0.4129.78。任务实际来源为本机 Codex Desktop 26.930.2377.0 / app-server 0.159.0-alpha12.1。

| 执行步骤 | 实际结果与证据 |
| --- | --- |
| `npm test` | 7 文件 / 72 项通过；最终日志 `.scratch/task-status-logs/full-frontend.log` |
| `cargo test`（src-tauri） | 77 项通过，2 项默认忽略；本轮任务真实来源检查另行显式执行，另一项为既有 ZCode 人工检查；日志 `full-rust.log` |
| `scripts/package-portable.ps1 -WebView2RuntimePath release/QuoDex-0.2.0-win-x64/webview2-runtime`（PowerShell 7） | `tsc`、Vite 和 Rust release 构建通过，便携目录生成；日志 `package-v021.log` |
| `node scripts/verify-task-status.mjs`，`QUODEX_EXECUTABLE` 指向交付 exe | 使用新建数据 / 配置 / WebView 目录启动真实产物，SQLite 与命名管道采用虚构数据但走完整 Rust 读取接口；运行、等待、失败、取消、溢出、分钟、窗口与重启移除均通过；[原生记录](../../../.impeccable/review/task-status/result.json) |
| `cargo test task_status::tests::live_desktop_read_only_smoke -- --ignored --nocapture` | 真实只读来源观察到 4 个状态，含 2 个运行；跨 18 秒刷新仍无诊断；原始聚合日志 `live-desktop.log` |
| 原生浮窗点击另一个真实运行聊天，再点击当前聊天 | Desktop 的非隐藏 Document 标题分别匹配目标聊天与当前聊天；已恢复原聊天；私有复现 `.scratch/task-status-source/live-native.mjs`，只保存聚合结果，不将真实标识或正文提交 |
| 单次 CSS 设计检测、独立 impeccable 审查 | 检测 `[]`；[完整视觉审查](../../../.impeccable/review/task-status/finish-review.md) 未要求修改产品视觉；唯一合同记录补项由 [verdict](../../../.impeccable/review/task-status/verdict.md) 评分 resolved，disposition: ship；此 verdict 只覆盖该项修复 |

测试启动会触发既有桌面快捷方式创建行为；本轮每次启动后仅在链接仍指向测试 exe 时恢复原快捷方式。原 v0.2.0 进程未用于新版本验证。日志均位于忽略目录 `.scratch/task-status-logs/`；可复现原生脚本位于 `scripts/`，截图与审查记录已保留。

### 批准设计逐项对照

| 批准项 | 原生产物对照 |
| --- | --- |
| 上方透明单行、圈内勾与 `10m` | [日常截图](../../../.impeccable/review/task-status/compact-daily-windows.png)，300 × 166，无新增整块任务容器 |
| 暂停 / 报错 / 未知、悬停详情与移除 | [状态截图](../../../.impeccable/review/task-status/attention-windows.png)、[报错详情](../../../.impeccable/review/task-status/failure-details-windows.png)；原生命令移除后重启不复现该提醒 |
| 10 位、9 圈加 `...` 与其余列表 | [10 位](../../../.impeccable/review/task-status/ten-slots-windows.png)、[溢出](../../../.impeccable/review/task-status/overflow-windows.png)；13 个聊天时列表有 4 项并可滚动 |
| 运行必须持续活动 | [原生连续帧与时序](../../../.impeccable/review/task-status/pulse.json) 覆盖 1770ms，圈内像素亮度变化；不是生成图分镜 |
| `29m`、30 分钟移除、恢复原高度 | [29m](../../../.impeccable/review/task-status/age-29m-windows.png)、[空态](../../../.impeccable/review/task-status/empty-windows.png)；基于落盘结束时间，不重置计时，空态高度 130 |
| 窄条、Pro、设置共存且不裁切 | [窄条](../../../.impeccable/review/task-status/narrow-windows.png)、[Pro](../../../.impeccable/review/task-status/pro-windows.png)、[设置](../../../.impeccable/review/task-status/settings-windows.png)；设置关闭后的圆圈原生边界检查通过 |

以上 UI 截图使用虚构聊天与额度数据，来自交付原生 exe；部分使用真实 Windows 桌面背景，部分使用原生验证背景。真实来源与跳转检查单独执行。

### 已知限制与用户验收

- 本轮现场没有等待批准 / 输入的真实事件；其接口和原生等待 UI 已用同格式夹具验证，现场等待旅程待用户确认。
- 状态通道是 Windows Desktop 内部协议，已检查版本与结构；其他版本兼容性尚不能保证。未知 / 断连显示灰圈与诊断，稍后重连。
- 初次交付为带固定运行时的便携目录；后续已制作并安装 v0.2.1 安装器，当前产物与安装验证见本文件顶部。
- 请实际运行两个聊天、查看任务圈与跳转，并在一个聊天等待批准 / 补充信息时核对琥珀暂停圈。用户确认“能用”前保持 `Acceptance pending`。

不能将独立额度 app-server 进程的空闲状态当作桌面聊天的运行状态。

## 执行前接入调查（2026-10-02）

本机桌面协调 IPC 的只读 follower 订阅已实测：Windows 命名管道 `\\.\pipe\codex-ipc` 使用 UInt32LE 长度前缀和 UTF-8 JSON；初始化、查找 owner、订阅现有聊天可返回桌面状态快照。探测收到两个 active 聊天和一个 idle 聊天，并在退出时全部退订，没有启动、恢复或修改聊天。

候选聊天来自只读 SQLite 元数据的所有根聊天；桌面 owner 确认后包含从 CLI 导入的聊天。没有 owner 时，仅明确标记 `source=vscode`、`originator=Codex Desktop` 的聊天采用已落盘终态。来源字段允许为空，不能因此中断读取。运行状态取自快照的 `threadRuntimeStatus`，等待请求在 `requests` 中；当前轮次可能位于 `turnHistory` 的 canonical 实体，不能只读取 `turns`。侧会话与临时会话不重复计数。

该通道是桌面内部协议，尚不是公开稳定 API。实现必须检测消息版本、快照结构与 revision 连续性；失联、缺少 owner 或无法辨认状态时显示未知，不能使用持久化的 started 事件猜测持续运行。此次运行/空闲只读探测不等于等待状态已经验证。

用户已确认 `tdd` 两个公开验证边界：任务读取接口语义，以及用户界面的溢出、分钟数、动画、移除和聊天跳转。证据与现场限制见上方验收入口。

真实 Codex Desktop 26.930.2377.0 / app-server 0.159.0-alpha12.1 的只读检查已通过：观察到运行聊天，并跨过 18 秒刷新周期，未收到协议诊断。无 owner 的路由错误不带 `method`，使用请求 UUID 关联；成功响应仍核对 method。成功提醒独立保留到期时间，即使来源变未知也在原结束时间加 30 分钟移除。

悬停最小复现定位到原生窗口增高时产生临时 mouseleave：160ms 后详情错误关闭。修复在关闭前核对原生鼠标坐标，并用递增序号丢弃过期查询。验收增加“窗口增高过程中，鼠标仍在任务圈或详情内时详情保持打开”。第二个失效边界是根容器允许焦点滚动：设置关闭后圈坐标落到窗口外。改用 `overflow: clip` 并禁止焦点恢复滚动，原生坐标断言与最终截图通过。重现和红绿日志位于忽略目录 `.scratch/task-status-logs/`。

## 布局方向（C 已选定）

以下是 V1 方向选择记录；其中两排、滚动和未带分钟数的符号均已被 V2 规则替代。

三张图都采用演示场景：两个聊天正在运行，一个聊天近期成功。图是 AI 生成的布局概念，不是应用截图；现有驾驶舱渲染以源码与原始截图为准，生成图的材质或字形差异不是更改现有驾驶舱的授权。

| 方向 | 图 | 组成与代价 | 参考及采用 / 拒绝 |
| --- | --- | --- | --- |
| A 下方横排，推荐 | [a-below.png](../../../.impeccable/mocks/task-status/a-below.png) | 原驾驶舱下方留透明空位；优先一排，最多两排；增加高度 | [Windows Progress controls](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/progress-controls)：采用不确定进度圈表达正在执行；不展示没有客观依据的完成百分比 |
| B 右侧两排 | [b-right.png](../../../.impeccable/mocks/task-status/b-right.png) | 透明区域在驾驶舱右侧；保持高度，增加宽度；右侧最多两排、更多可滚动 | [Liquid Glass demo](https://github.com/archisvaze/liquid-glass)：采用控件与透明背景分离；不为小圆圈复制整块厚玻璃和大面积折射 |
| C 上方横排 | [c-above.png](../../../.impeccable/mocks/task-status/c-above.png) | 驾驶舱上方留透明空位，任务状态先进入视线；需协调上方设置展开空间 | [Apple Live Activities](https://developer.apple.com/videos/play/wwdc2023/10194/)：采用紧凑、可扫读的持续状态区域；不复制黑色 Dynamic Island 容器替换现有驾驶舱 |

运行圈拟采用呼吸脉冲并可配合短亮弧缓慢旋转；成功圈为绿色轮廓，勾在圈内上半部，分钟数在圈内下半部。静态图与动画分镜不证明实际动画和交互已经实现。

原始生成 prompt、参考图与未批准标记保存于每张图的同名 JSON，并嵌入 PNG 元数据。

## 组件调研

调研本地参考仓库的源码与许可证；下表日期是本地参考版本日期，不代表 GitHub 当前维护状态。

| 参考 | 本地版本 | 许可证 / 风险 / 适配 |
| --- | --- | --- |
| [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) | ac48eab，2025-06-13 | MIT；源码将 backdrop 层与清晰内容层分开。借鉴内容清晰度，不引入逐圆圈的复杂 SVG 折射与新依赖 |
| [archisvaze/liquid-glass](https://github.com/archisvaze/liquid-glass) | 69f026a，2026-03-02 | 可参考源码中的边缘折射和高光；代码复用前需另核许可证。整体 SVG/WebGL Demo 对小任务圈适配成本高，仅作视觉参考 |
| [tauri-apps/window-vibrancy](https://github.com/tauri-apps/window-vibrancy) | 4756332，2026-07-16 | MIT / Apache-2.0；源码注明部分 Windows 11 blur API 存在拖动性能问题。当前新增任务区只需透明空位，不引入原生 blur 改造 |

选择沿用 QuoDex 现有材质与渲染基础，因为新增内容是小型状态控件；上述项目用于参考，不作为本轮新增依赖。

## 状态来源调研证据

初期 schema 调查只查看源码、版本与数据库结构。后续真实接入在本机内存中使用聊天标识和状态快照，不将真实标识、标题或正文写入提交与截图；持久化的验证证据只含聚合结果。

- [Codex protocol.rs](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/protocol/src/protocol.rs)：`task_started` / `task_complete`（兼容 `turn_started` / `turn_complete`）与 `turn_aborted` 提供开始、结束、取消语义；完成时间字段可能为空。
- [Rollout persistence policy](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/rollout/src/policy.rs)：开始、完成、取消事件落盘；批准与输入请求不落盘，因此历史文件不足以精确表达等待。
- [Thread status](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/app-server/src/thread_status.rs) 与 [turn normalization](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/app-server/src/request_processors/thread_processor.rs#L4656)：状态属于 app-server 进程，新建进程可能把其他进程的进行中轮次读成 interrupted。
- 本机 schema 有 turn 的状态、开始时间、完成时间和终态错误字段，未发现等待状态列。实际格式与桌面任务覆盖范围仍需实施时验证，不能只凭历史数据断言一直运行。
- [Codex deep links](https://learn.chatgpt.com/docs/reference/commands)：公开支持 `codex://threads/<thread-id>`；本轮已从真实浮窗核对另一个聊天被选中并恢复当前聊天。

设计稿中的等待状态是已确认产品需求，尚不是已验证能力。读取不可用、缺失终态或缺失完成时间必须呈现未知，而不是伪造成功。
