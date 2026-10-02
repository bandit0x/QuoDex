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
- 成功完成显示绿色圆圈与绿色勾，在完成后 30 分钟内保留。
- 等待批准或补充信息显示琥珀色暂停圈；执行报错显示红色感叹号圈；取消后移除。
- 悬停显示聊天名称与状态，点击打开对应 Codex 聊天。
- 最多展示两排圆圈，更多任务可滚动查看。
- 状态数据来源与聊天跳转能力尚待核实，不能以演示数据代替真实能力。
- 设计图审核通过后才允许实现功能。

## Brand Commitments

名称为 QuoDex。用户要求在现有驾驶舱上下或左右增加透明区域承载任务圆圈。

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
