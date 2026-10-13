# macOS 任务透明区域输入修复

0.4.1 修复包核心点击：Verified（用户真实鼠标验收通过）；0.4.2 构建、干净数据启动与安装冒烟：Verified；0.4.2 点击复验及扩展原生回归：Acceptance pending。

## 来源与产物

- 来源基线：`cc6c844`；修复源码提交：`72278ea`；v0.4.2 发布源码：`59c9529`。
- 环境：macOS 27.0.1 / 26A434，arm64，Node 24，Tauri 2 / WKWebView。
- 当前产物：`release/macos/QuoDex.app`、`release/macos/QuoDex_0.4.2_aarch64.dmg`；安装路径 `/Applications/QuoDex.app`，版本 `0.4.2`。
- 安装版与打包版主程序 SHA-256 相同：`20350f7a2585c52025d176348c80c078ba31a73ba73774b99130a566b24bb6e4`。
- DMG SHA-256：`98449ba3dfc140df6d1965f755b7243cedad2d47a405ac9b04e6bc7d3ff2a55d`；`hdiutil verify` 通过。
- 当前包由 `npm run package:app` 注入锁定的 Codex 运行时并重新签名；安装前后 `codesign --verify --deep --strict` 通过。
- 2026-10-11，按用户明确要求升级 v0.4.2 并删除已识别的 20 个旧 `.app` 副本，包括此前 0.4.1 测试包及回滚包。仅删除应用包，保留配置、数据库、日志和源码。清理后可读范围内扫描仅剩三个 0.4.2 副本（安装版、发布包、Tauri 构建包）；macOS 隐私保护目录不可读，扫描并非全磁盘无遗漏证明。清理明细位于忽略目录 `.scratch/release-v0.4.2/cleanup.json`。
- 历史用户点击验收使用 0.4.1 无探针修复包，主程序 SHA-256 `db8bcea9bde19c49618539bbb3e90e75982102ab493c7499d58ae89d903eae9d`。v0.4.2 的输入修复源码相同，仅版本与发布记录变更；没有把此前手工结果冒充新包复测。
- 从 `/Applications/QuoDex.app` 正常启动，通过真实 WKWebView 可访问性状态与截图确认主界面出现、Codex 配额读取完成、真实任务状态恢复。未使用测试启动脚本或虚构任务环境。

## 原因与修复

任务栏存在时常驻预留 44 + 160 逻辑像素，详情关闭只移除 DOM；macOS 原材质模块忽略 `visibleRegions`，未据此管理原生窗口输入。

新增原生输入模块复用这些区域，含圆角命中。AppKit 本地/全局鼠标监听负责及时切换 `ignoresMouseEvents`；32ms 主线程协调负责静止光标下的窗口移动和手动穿透到期。监听不修改、重放或截获其他应用的输入。拖动捕获只从可交互区域开始；手动穿透优先，到期回到自动策略。版本同时过滤旧输入和旧材质更新。失败区分原生句柄、坐标视图、监听创建与状态回读，以 QDT-632 / QDT-633 报告。

## 可复现检查与实际结果

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml --offline
npm run package:app
node scripts/launch-macos-input-review.mjs release/macos/QuoDex.app/Contents/MacOS/codex-credits-view
```

- 前端：12 个测试文件、171 项通过。新增关闭详情后区域移除、版本递增检查先失败（版本缺失），修复后通过。
- Rust：137 项通过，5 项既有本机外部环境测试 ignored。与输入修复相关的两项策略测试通过；明确区分策略正确与原生点击投递正确。
- Rust 首轮有 3 项因沙箱禁止绑定 TCP/Unix socket 失败；取得自动审批后在可绑定本机 socket 的环境重新执行，全部非 ignored 测试通过。
- 构建：TypeScript 与 Vite 通过，release 原生程序与 `.app` 生成。
- 启动：最终无探针产物在新建数据目录读取虚构 SQLite 任务及 Unix socket 协议；真实 WKWebView 主界面出现，任务显示“鼠标穿透验收任务”。未复用用户的任务数据库或配置缓存。
- 原生界面：通过 CUA 读取并截取真实应用，关闭态和列表打开态均为 600×668 截图，任务栏与额度面板位置保持一致；Codex 列表可打开，Escape 后列表消失。截图在本次聊天的工具记录中，未保存为仓库图片文件。
- 静态检查：`git diff --check`、验证启动脚本语法检查通过；临时 `[DEBUG-qdi]` 源码探针已删除。
- 审查：Standards 发现的失败原因丢失和事件魔数已修复；Spec 发现的过期材质更新及透明处无条件捕获已修复。首次真实点击时序已由用户手工验收；此结果限定于本次环境与操作，未据此宣称所有极端时序均通过。

本轮日志保存在 `.scratch/task-hover-input/`（忽略目录）。源码提交不包含测试缓存、虚构数据库、截图或构建产物。

v0.4.2 在版本变更后重新运行前端 171 项、Rust 137 项（5 项既有 ignored）、原生 SQLite fixture 2 项及 strict Clippy，均通过；重新执行完整 macOS 打包。在新建数据目录启动正式发布包，原生 WKWebView 出现虚构验收任务及额度；退出后从 `/Applications/QuoDex.app` 启动，真实任务与 Codex PRO 配额读取正常，两次真实产物截图见聊天工具记录。此次发布日志位于 `.scratch/release-v0.4.2/`。

## v0.4.2 远程发布

- `59c9529` 与注释标签 `v0.4.2` 已推送到 `bandit0x/QuoDex`；提交、标签及 [Release](https://github.com/bandit0x/QuoDex/releases/tag/v0.4.2) 均使用用户 `bandit0x` 身份。macOS DMG 已正式发布，GitHub 返回的 SHA-256 与上述本机值一致。
- [标签 CI](https://github.com/bandit0x/QuoDex/actions/runs/38115044039) 的双平台前端 171 项、SQLite fixture、Rust 测试及 strict Clippy 通过；macOS Rust 137 项（5 ignored），Windows Rust 140 项（4 ignored），macOS 打包通过。Windows 安装后的验收在应用启动之前失败：测试背景窗口未在旧脚本 4 秒上限内就绪，没有据此宣称 Windows 应用验收通过。
- 最小原生预检实测背景冷启动需要 5.074 秒，窗口真实可见、进程 stderr 为空。后续 `e93d06c` 增加可单独执行的预检，`e8fd930` 按真实可见信号等待（30 秒上限），保留所有窗口和截图断言，记录启动错误及耗时。应用源码、依赖、安装器脚本与标签相比无差异。[后续 CI](https://github.com/bandit0x/QuoDex/actions/runs/38116512945) 的双平台检查和完整 Windows 安装验收通过：NSIS 静默安装、两次冷启动、ZCode 数据路径、原生详情保持与移开关闭、正常退出、等待与取消状态、设置往返后的九个背景 RGB 样本均通过。
- 该次 Windows manifest 的 `sourceDirty=true` 未记录具体文件，不能追溯其来源；该轮安装器没有发布。`f0ad813` 增加构建前、构建后、原生验收后三阶段的 porcelain、tracked diff 与未跟踪文件记录，并拒绝脏的初始构建目录。[来源复验 CI](https://github.com/bandit0x/QuoDex/actions/runs/38118070844) 全部通过：构建前 status 为空；构建后与验收后仅 `src-tauri/Cargo.toml` 被标记 modified；三个阶段相对 HEAD 的 binary diff 均为空，无未跟踪文件。manifest 如实保留 `sourceDirty=true`；这证明本轮 Git 内容比较没有 tracked 差异，不宣称原始文件字节完全一致，也不据此追溯旧运行。两份锁文件均按 CRLF 换行转换与标签内容核对一致。
- 本轮已正式发布的 Windows 安装器 `QuoDex-0.4.2-win-x64-setup.exe` 的 SHA-256 为 `be190694ecc53a21bd964477ed18d24651fa179104f7da1c2c598d7d96ca6273`，与下载的 CI manifest 及 GitHub Release 返回的 digest 一致；安装后主程序 SHA-256 为 `b4242cfc3b5bb37859a1a0208608481baab1c2c0b1ddc15edad3f6962c484d13`。来源为 `f0ad813`，产品源码、依赖及打包输入与标签 `v0.4.2` 相同，额外提交仅补充 CI 与验收脚本。环境为 Windows NT 10.0.26100.0、Node 24.18.0、Rust 1.97.1、WebView2 151.0.4129.78。NSIS 安装及完整原生回归通过；本轮背景冷启动耗时 10.419 秒，最终窗口可见且 stderr 为空，验证了固定 4 秒等待上限确实不足。
- 已检查本轮原生冷启动、任务列表及设置截图，九个背景颜色样本全部与期望 RGB 一致，窗口高度设置往返为 334 → 498 → 334。截图与来源文件保存于忽略目录 `.scratch/release-v0.4.2/windows-source-verified-evidence/`，CI 中对应 `windows-evidence-f0ad813…` artifact。匿名协议与 SQLite fixtures 不证明真实 ZCode 活跃任务、真实账号等待请求或聊天跳转；截图显示 TomatoCloud 路由不可用，本轮不验证其联网连通性。125% / 150% DPI 与多屏仍需单独验收。

## 手工验收结果与剩余覆盖

2026-10-11，用户对本次聊天中的测试问题回复“两步都正常”：

- 悬停任务后移开，点击原详情透明区，下层应用可以收到点击。
- 快速返回任务栏，第一次点击 Codex 正常。

这两项结果来自用户真实鼠标操作，解除核心 bug 的原生点击投递验证阻塞。没有把此回复扩展为对拖动、连续切换任务、设置、手动穿透到期及跨屏的确认；这些原生组合场景仍待补充，相关策略已有自动测试覆盖。

可复现步骤：

启动上述干净验证环境，把其他应用可点击控件放在任务详情的后方：

1. 悬停任务圆圈，详情出现；移开后详情消失。
2. 点击原详情透明区域，确认下层应用确实收到第一次点击。
3. 快速移回任务栏，第一次点击 Codex 必须展开列表；圆圈悬停必须重新显示详情。
4. 重复反向快速移出后点击，连续切换任务，再验证拖动、设置开关及“穿透 10 秒”到期恢复。
5. 有第二块屏幕时补查不同缩放比例跨屏。

当前工具的坐标点击将事件投给指定应用窗口，事件坐标与系统 `NSEvent.mouseLocation` 不一致。已用临时事件边界探针确认这一限制；因此工具点击不能作为 WindowServer 把透明区域点击投给下层的证据，也不能证明快速返回的首次点击。核心点击投递结果已由上述用户真实鼠标操作补足；工具限制仍适用于扩展场景。

AppKit monitor 修改窗口接收状态不会重新投递已选定目标的点击。若上述真实首击验收出现稳定失败，应按已确认设计停止此路线，改用有序缩窗；不得仅缩短轮询或增加延迟掩盖。
