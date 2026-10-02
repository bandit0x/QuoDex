# v0.2.1 任务状态设计

Status: Acceptance pending

分支：`feature/v0.2.1-task-status`。本文件是本轮设计状态入口。

## 当前修订：呼吸灯与水流边缘（2026-10-02）

修订状态：Not built。用户指出现有圈偏大、边框偏细、运行动效简陋、完成分钟与边缘接近；随后拒绝过于复杂的动效方案，并明确指定“呼吸灯 + 边缘水流”。V3 水流又因几乎看不见而被拒绝。冻结新增功能与装饰，保存旧稿，重做当前 V4 水流预览，待用户审核后修改产品。此前的构建与原生验证仅覆盖下面记录的 V2 产物。

- 可见直径从 24 降至 20.4 逻辑像素，边框从 1 增至 1.2；点击区域与单行容量继续沿用。
- 运行时柔和呼吸（2.8 秒），明显浅色波峰带青色长尾沿同一条边缘流动（2.6 / 3.9 秒），叠加追随水纹。波峰面积与底圈的亮暗差增大，降低微小位移以保持 20.4px 圈的清晰度。圆心留空，不增加内轨、准星或转子。
- 完成勾与分钟向圆心收拢，以最宽的 `29m` 检查边缘留白；产品实现还须修正溢出列表中 `.task-list-entry small` 对完成圈分钟样式的覆盖。
- 减少动效时去除空间流动，保留低幅度呼吸；隐藏时暂停。具体成本及真实浮窗视觉须在实现后验证。
- 验收边界：真实产物的主任务行与溢出列表均使用新尺寸及边框；`0m` / `10m` / `29m` 不碰边；运行连续帧呈现呼吸和水光流动；10 位单行、溢出操作和空任务收起继续有效。

失效边界：V3 边缘水光与常亮底圈颜色接近，透明尾部仍露出亮底圈，且周期偏长；缩小后移动位置缺乏可追踪的亮暗差。数据 → 运行状态 → 动画样式 → 20.4px 栅格化 → 用户扫读，问题出现在动画样式与实际尺寸的呈现，未发现任务数据问题。新验收要求在实际尺寸直接看出亮峰沿边移动，放大图不能代替这一判断。

预览：[动态页面](../../../.impeccable/mocks/task-status/v3/index.html)、[浏览器截图](../../../.impeccable/mocks/task-status/v3/water-v4-preview.jpg)、[实际尺寸和放大细节动图](../../../.impeccable/mocks/task-status/v3/water-v4-motion.gif)。通过 CUA 在 304px 浏览器视口采集 200 帧，跨度 5717ms，按实际帧时间编码，未加速；原帧与时间记录在 `.scratch/task-water-v4-frames/`。页面中的驾驶舱为既有原生截图，任务圈为演示，不能作为真实产品验证，也不能代替用户对水流观感的审核。旧复杂方向保存在 `v3/rejected-orbit-options.html`；被拒绝的弱水流源码可从 `155b0a7` 复现，相应截图为 `v3/water-preview-full.jpg`。

## 已确认需求

监测当前电脑 Codex 桌面应用的所有聊天，包含其他项目。每个聊天一个圆圈，同一聊天再次执行时复用。

运行显示带持续活动动画的圆圈；成功在绿色圈内同时显示绿色勾与完成分钟数（如 `10m`），保留 30 分钟；等待批准或信息用琥珀色暂停圈；报错用红色感叹号圈；取消后移除。悬停显示名称与状态，点击打开对应聊天。任务区最多一行，超出容量用 `...` 表示，点击展开其余聊天列表，可继续打开对应聊天。

## 设计范围

沿用现有驾驶舱材质与内容。用户已选择 C：上方透明横排。以 300 × 130 紧凑驾驶舱为基准，包含双仓与 Pro 单仓兼容性。当前图为演示数据设计稿，未接入真实任务。

用户于 2026-10-02 批准 C / V2 完整设计并授权实现。该批准涵盖上方单行、圈内勾与完成分钟数、活动脉冲，以及点击 `...` 展开其余聊天列表。

用户补充确认：报错圈保留到再次运行或手动移除；没有可展示任务时收掉透明任务空间，恢复原窗口高度。

当前版本为 C / V2，取代先前的“两排 + 滚动”设想。原 A/B/C 图仅作为方向选择记录，最终状态以 V2 图与以下规则为准。

## 方向合同与审查依据

以下五块整理已批准的 C / V2 决策，是收尾记录，不是重新选择设计方向。

- **THESIS**：在原额度驾驶舱上方直接看见各聊天的运行与近期结果。
- **OWN-WORLD**：继承 QuoDex 已有透明浮窗、玻璃驾驶舱、字体与额度内容；新增任务圈使用同一青色 / 绿色视觉语言。
- **STORY**：扫读圆圈 → 悬停辨认聊天与原因 → 点击打开聊天；超出容量时通过 `...` 继续查看。
- **FIRST VIEWPORT**：真实紧凑窗口以原 300 × 130 为基础，任务行增加 36 逻辑像素；详情临时增加 160，空任务恢复原高度。
- **FORM**：上方透明单行圆圈；精确 SVG 状态符号和持续活动脉冲。属于现有界面的局部组件扩展，适用 impeccable `reference/new-work.md` 的 “Extend an existing surface” 及 “Never run the script for a local extension or a precisely specified narrow request”。因此没有运行 concept-seed，也不存在 seed key；不事后补造 seed。

**QUALITY BAR**：在实际 300px 窗口里勾与分钟同时可辨；运行状态有真实连续帧证据；单行容量与 `...` 符合规则；详情完整可操作且不遮额度数字；未知不冒充成功；驾驶舱材质保持既有实现。

批准图是 1536 × 1024 多场景说明板，未批准把整张板变成应用窗口。尺度以本文件的 300px 驾驶舱为准，实际圈直径 24 逻辑像素以容纳约 10 位；`.impeccable/review/hero-repro.png` 是 300 × 166 原生单场景截图。生成图的装饰比例不替代真实浮窗尺寸约束。

## V2 交互与布局规则（已批准）

- **最多一行**：紧凑视图目标为 10 个状态位；10 个以内全部显示，超出则显示 9 个聊天圈加 `...`。窄条按可用宽度减少容量，不换行、不扩大任务条高度、不增加任务条滚动。
- **溢出入口**：点击 `...` 展开其余聊天的临时列表，列出名称、状态与完成分钟数，可点击打开对应聊天。关闭列表后仍只保留单行任务条。
- **完成标识**：绿色勾在圈内上半部，`10m` 等分钟数在圈内下半部。使用真实完成时间按分钟向下取整，从 `0m` 开始；距完成时间达到 30 分钟时移除。不能从发现任务的时间或启动 QuoDex 的时间重新计时。
- **活动动画**：运行圈持续做约 1.4 秒周期的呼吸脉冲，可配合亮弧缓慢旋转。等待、完成、报错与未知圈不做活动动画。减少动效时保留低幅度透明度脉冲，以满足活动提示，同时去除旋转与大面积辉光。
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

## 验收与交付证据（2026-10-02）

产品源码版本：`262dc77`，分支 `feature/v0.2.1-task-status`。交付文件：[QuoDex.exe](../../../release/QuoDex-0.2.1-win-x64/QuoDex.exe)，相邻 runtime 目录须完整保留；[manifest.json](../../../release/QuoDex-0.2.1-win-x64/manifest.json) 记录各文件 SHA256。可执行文件 SHA256：`cf8a68cc7d05e1c2096a1a9b9f3c11abc22198ed9ab3cfac6aefb19287db6573`。

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
- 未制作安装器；交付为带固定运行时的便携目录。验收时先退出旧浮窗，再启动上述 v0.2.1 exe，避免两个版本并行显示。
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
