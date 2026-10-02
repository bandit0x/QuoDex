# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

使用 Codex 桌面应用并同时运行多个聊天的用户，希望在桌面浮窗中快速查看额度与任务状态。

## Product Purpose

QuoDex 是基于 Tauri 和 React 的透明桌面浮窗。现有能力包括 Codex / ZCode 额度驾驶舱和 TomatoCloud 路由状态。v0.2.1 增加当前电脑 Codex 桌面应用的聊天任务状态展示。

## Operating Context

当前设计针对 Windows 桌面上的常驻小型浮窗。任务监测范围包括当前电脑 Codex 桌面应用的所有项目与聊天。

## Capabilities and Constraints

- 一个聊天对应一个任务圆圈；同一聊天启动下一轮时复用圆圈。
- 每个运行中的聊天显示一个运行圈。
- 成功完成显示绿色圆圈；圈内同时显示绿色勾与距完成时间的分钟数，如 `10m`，在完成后 30 分钟内保留。
- 等待批准或补充信息显示琥珀色暂停圈；执行报错显示红色感叹号圈；取消后移除。
- 报错圈保留到再次运行或手动移除；手动移除只隐藏该次报错提醒。
- 悬停显示聊天名称与状态，点击打开对应 Codex 聊天。
- 任务区最多一行，紧凑视图约可容纳 10 个状态位。超过容量时用 `...` 表示，点击展开其余聊天列表，列表可打开对应聊天。
- 运行圈必须有持续脉冲或其他活动动画，不能只用静态颜色表示运行。
- 用户已选择在驾驶舱上方设置透明任务区；没有可展示任务时收起该区域，恢复原窗口高度。
- Windows 任务状态来自本机 Codex Desktop 的只读状态订阅与落盘元数据，聊天跳转使用已注册的 Codex 深链；来源异常呈现未知。具体现场验收范围与协议兼容限制统一见 `docs/design/task-status/brief.md`，不能以演示数据代替真实能力。
- 设计图审核通过后才允许实现功能。

## Brand Commitments

名称为 QuoDex。用户选择在现有驾驶舱上方增加透明区域承载任务圆圈。

## Evidence on Hand

- `src/App.css`：现有材质、颜色与字体。
- `src/windowClient.ts`：紧凑窗口 300 × 130，窄条窗口 260 × 48。
- `docs/verification/screenshots/quodex-compact.png`：双仓截图。
- `docs/design/pro-reservoir/hero.png`：Pro 单仓设计参考。
- 本轮设计图中的聊天与状态是明确标注的演示数据。

## Product Principles

- 一眼区分运行、等待、成功与报错。
- 每个聊天有独立、可识别的圆圈。
- 状态读取异常必须呈现未知，不能误报完成或空闲。
- 默认视图保持桌面浮窗的紧凑尺度。
