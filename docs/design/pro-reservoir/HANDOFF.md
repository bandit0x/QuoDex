# 交给逻辑 agent 的 prompt

请在 `/Users/Admin/Documents/projects/QuoDex` 完成 Codex 套餐识别与 Pro 周额度单仓的数据接入。UI 已按用户确认的 A 方案实现，当前分支为 `codex/pro-reservoir-ui`。先检查 git 状态与最近提交，保留所有已有改动，不重复设计 UI。

先读根 AGENTS.md、`docs/design/pro-reservoir/README.md`、`src/ProQuotaSurface.tsx`、`src/App.tsx`、`src/capacityTypes.ts` 和本机 app-server 数据读取实现。不要 push 或创建 PR。

## 已有 UI 接口

`App` 新增可选 `codexPresentation`，类型定义位于 `src/ProQuotaSurface.tsx`：

```ts
interface CodexPresentation {
  mode: "dual" | "pro-weekly";
  weeklyLow?: boolean;
}
```

- `dual` 是默认值，显示原双仓。
- `pro-weekly` 仅影响 Codex，展示 PRO 徽章与一个 WEEK 液体仓；紧凑、展开、窄条、加载、失败、过期、刷新及缺失周额度状态已接入。
- `weeklyLow` 只是明确的展示信号；UI 没有硬编码低额度阈值。
- 数据继续使用 `CapacitySnapshot.weekly` 和现有 `QuotaWindow`；不要将两个额度求和、平均，也不要修改液体高度算法。
- `src/App.tsx` 的 `activeIsPro` 是接入点，目前依据显式参数。生产入口尚未传入该参数，因此真实用户仍使用原双仓。这是刻意留下的逻辑边界，不是已完成套餐识别。

## 你负责的工作

1. 从可靠的本机 Codex account/app-server 协议读取套餐和实际 rate-limit window 信息。先验证协议字段、Pro 的实际额度行为及空窗口含义；用户关于“Pro 无 5h 限制”的描述不能替代协议证据。如观察到政策或协议不一致，报告实际证据，不隐藏真实限制。
2. 设计最小的套餐状态与数据映射，在适当层从已确认身份及额度信息产生 `CodexPresentation`。可以在 App 的已有快照读取链路中派生该值，或由上层传入；不要为接入这个 prop 重复拉取配额、创建第二套刷新循环。
3. 未知套餐不能仅凭 `fiveHour === null` 判断为 Pro。保留非 Pro 双仓、ZCode、轮播、路由告警、刷新、失败缓存与设置行为。套餐身份和配额缓存必须属于同一账户，覆盖退出登录和切换账户，避免把前一个账户的 PRO 标识或数据显示给新账户。
4. 周额度仍可能缺失或读取失败：未知值用 null，不能伪造 0%、100% 或无限额度；错误沿用真实稳定诊断码。不要将 UI 测试里的 `DEMO-*` 带入生产。
5. 沿用当前 Pro 样式与真实操作，不修改批准的玻璃、液体、尺寸与单仓布局。独立验证入口 `docs/design/pro-reservoir/runtime.html` 及 `runtime.tsx` 只注入虚构服务响应，不是生产数据源；不要把它接到生产入口。

## 验收与交付

- 对真实协议数据做可复现验证，覆盖套餐确认、非 Pro、未知身份、缺失窗口、账户切换及退出登录。
- `npm run build`、`npm test` 通过，真实应用启动冒烟；分别确认 Pro 单仓和非 Pro 双仓，不用 mock 结果冒充协议验证。
- 保留新增 App 行为测试与 `scripts/verify-pro-ui.mjs` 的鼠标回归检查（点击窄条恢复，拖动窄条不误恢复）。
- UI 已有浏览器生产构建截图与验证记录，见 `docs/verification/pro-ui/`；真实账户与原生 Tauri 窗口最终验证由你补齐。
- 本地提交，简体中文报告实际证据和限制；不要上传代码。
