# Pro 单仓 · A 方案

状态：Acceptance pending（仅设计稿，等待视觉确认；未接入应用）。

## 设计与边界

用户选择全宽单仓：沿用现有光学玻璃、薄荷绿周额度液体、数字字体、刻度、重置时间与底部状态栏。取消中央隔墙、内侧阴影与不对称圆角；左右边框对称。沿用实际窗口 compact 300×130、expanded 300×160、collapsed 260×48，避免来源轮播改变占位。

本目录是独立设计预览，直接复用 `src/FluidReservoir.tsx`、`src/OpticalShell.tsx` 与 `src/App.css`，不修改产品代码。预览控件为外观示意，数值、时间、路由与诊断编号均为虚构样例。`DEMO-01` 不可作为产品诊断码使用。

## 接入约定

- 由负责逻辑的 agent 决定何时进入 Pro 单仓，不能仅因缺失 fiveHour 推断套餐；本设计不确认任何套餐额度政策。
- 单仓显示 `weekly.remainingPercent`，液位继续线性映射，不将两类额度求和或平均。只保留周仓 `mint` 颜色和独立周仓 motion seed。
- Pro 徽章放在原 Codex 来源徽章内，以细分隔线区分；WEEK、百分比及 LEFT 居中，重置时间在底部，刻度保留在右侧。
- 紧凑正常状态：68% 样例即刷新成功后的稳定状态。刷新中保留液位，仅底部显示刷新状态。真实交付仍应沿用现有拖动晃动、环境动效及减少动效设置；静态稿为了可比较而启用了 reducedMotion。
- 低额度状态：样例为 8%，保留 mint 液体，文字提示“周额度偏低”；触发阈值由逻辑侧提供，设计不新增业务规则。0% 是真实空仓，100% 是满仓，未知值使用 — 且不画液体。
- 读取失败有缓存：保留最后有效数值，降低液体亮度，标记“上次有效数据”、过期及真实诊断码；展开可重试。无缓存：显示 —、可行动的真实原因、真实诊断码和重试入口。稿中“读取失败”为通用外观占位，接入时应替换具体原因。
- 路由状态与配额读取独立，继续用已有路由状态；路由阻塞时保留原红色外框报警，不把低额度变成同种报警。
- 展开沿用 FULL RESETS、有效期、刷新、设置及窄条入口，禁止从示例数据推导真实重置权益。窄条仅保留 WEEK 单指标。
- 若套餐身份尚未确定，沿用应用当前加载界面，不提前展示 PRO。此稿的首次读取表示身份已确定而周额度仍在加载。

## 查看与复现

项目根启动 `npm run dev -- --host 127.0.0.1`，打开 `/docs/design/pro-reservoir/`。独立生产构建：

```sh
node node_modules/vite/bin/vite.js build docs/design/pro-reservoir --outDir /tmp/quodex-pro-design-dist
node node_modules/vite/bin/vite.js preview --outDir /tmp/quodex-pro-design-dist --host 127.0.0.1 --port 4174
```

- `hero.png`：正常状态近景。
- `states.png`：8 个状态和实际尺寸对照。
- `narrow.png`：375px 设计预览页面，用于确认预览无横向溢出；产品窄条状态另在 states 中。

## 验证记录

来源版本：`d30169f`（v0.1.9），本目录新增设计稿。环境：macOS、本机 Chrome headless、Node 24.19.0、Vite 7.3.6。构建产物：`/tmp/quodex-pro-design-dist`，可用上述命令重建。

设计稿生产构建成功；现有液体物理测试通过；样式检测器未报告问题。以 Chrome 启动生产设计预览，检查 1100px 与 375px 视口的脚本错误、横向溢出并截图。实际应用套餐识别、业务交互、Tauri 原生窗口及真实账户数据未验证，不能据此声称 Pro 功能可交付。
