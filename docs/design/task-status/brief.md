# v0.2.1 任务状态设计

Status: Not built

分支：`feature/v0.2.1-task-status`。本文件是本轮设计状态入口。

## 已确认需求

监测当前电脑 Codex 桌面应用的所有聊天，包含其他项目。每个聊天一个圆圈，同一聊天再次执行时复用。

运行显示圆圈；成功显示绿色圈和绿色勾，保留 30 分钟；等待批准或信息用琥珀色暂停圈；报错用红色感叹号圈；取消后移除。悬停显示名称与状态，点击打开对应聊天。最多两排，更多可滚动查看。

## 设计范围

沿用现有驾驶舱材质与内容，比较下方、右侧、上方三种透明任务区域。以 300 × 130 紧凑驾驶舱为基准，包含双仓与 Pro 单仓兼容性。当前图为演示数据设计稿，未接入真实任务。

设计方向待用户选定。选定后补充正常、运行、成功、等待、报错、读取不可用、窄条与溢出状态图。最终设计图审核通过后才实现。

## 尚待核实

- 桌面实时等待批准/输入状态的可靠只读通道，以及异常退出后的运行状态校验。
- 打开对应聊天的实际跳转验证。
- 报错状态保留时长、首次启动是否补回最近 30 分钟的成功任务。

不能将独立额度 app-server 进程的空闲状态当作桌面聊天的运行状态。

## 布局方向（待审核）

三张图都采用演示场景：两个聊天正在运行，一个聊天近期成功。图是 AI 生成的布局概念，不是应用截图；现有驾驶舱渲染以源码与原始截图为准，生成图的材质或字形差异不是更改现有驾驶舱的授权。

| 方向 | 图 | 组成与代价 | 参考及采用 / 拒绝 |
| --- | --- | --- | --- |
| A 下方横排，推荐 | [a-below.png](../../../.impeccable/mocks/task-status/a-below.png) | 原驾驶舱下方留透明空位；优先一排，最多两排；增加高度 | [Windows Progress controls](https://learn.microsoft.com/en-us/windows/apps/develop/ui/controls/progress-controls)：采用不确定进度圈表达正在执行；不展示没有客观依据的完成百分比 |
| B 右侧两排 | [b-right.png](../../../.impeccable/mocks/task-status/b-right.png) | 透明区域在驾驶舱右侧；保持高度，增加宽度；右侧最多两排、更多可滚动 | [Liquid Glass demo](https://github.com/archisvaze/liquid-glass)：采用控件与透明背景分离；不为小圆圈复制整块厚玻璃和大面积折射 |
| C 上方横排 | [c-above.png](../../../.impeccable/mocks/task-status/c-above.png) | 驾驶舱上方留透明空位，任务状态先进入视线；需协调上方设置展开空间 | [Apple Live Activities](https://developer.apple.com/videos/play/wwdc2023/10194/)：采用紧凑、可扫读的持续状态区域；不复制黑色 Dynamic Island 容器替换现有驾驶舱 |

运行圈拟采用短亮弧旋转表示活动；成功圈为绿色轮廓和绿色勾。悬停提示与点击反馈、30 分钟到期、两排溢出、等待/报错/未知及窄条形态均在方向选定后出下一轮状态图。静态图不证明动画与交互已经实现。

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

调查仅查看源码、版本与数据库 schema，没有读取聊天正文或真实聊天标识。

- [Codex protocol.rs](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/protocol/src/protocol.rs)：`task_started` / `task_complete`（兼容 `turn_started` / `turn_complete`）与 `turn_aborted` 提供开始、结束、取消语义；完成时间字段可能为空。
- [Rollout persistence policy](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/rollout/src/policy.rs)：开始、完成、取消事件落盘；批准与输入请求不落盘，因此历史文件不足以精确表达等待。
- [Thread status](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/app-server/src/thread_status.rs) 与 [turn normalization](https://github.com/openai/codex/blob/rust-v0.147.0/codex-rs/app-server/src/request_processors/thread_processor.rs#L4656)：状态属于 app-server 进程，新建进程可能把其他进程的进行中轮次读成 interrupted。
- 本机 schema 有 turn 的状态、开始时间、完成时间和终态错误字段，未发现等待状态列。实际格式与桌面任务覆盖范围仍需实施时验证，不能只凭历史数据断言一直运行。
- [Codex deep links](https://learn.chatgpt.com/docs/reference/commands)：公开支持 `codex://threads/<thread-id>`；本机已注册 scheme，未实测本轮跳转。

设计稿中的等待状态是已确认产品需求，尚不是已验证能力。读取不可用、缺失终态或缺失完成时间必须呈现未知，而不是伪造成功。
