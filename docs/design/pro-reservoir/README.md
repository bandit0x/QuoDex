# Pro 单仓 · A 方案

状态：Verified（设计已获用户确认；UI 与套餐识别、真实数据接入均已实现——UI 经浏览器生产构建验证，逻辑经真实 app-server 协议与原生窗口验证；2026-09-25 用户验收通过）。

## 设计与边界

用户选择全宽单仓：沿用现有光学玻璃、薄荷绿周额度液体、数字字体、刻度、重置时间与底部状态栏。取消中央隔墙、内侧阴影与不对称圆角；左右边框对称。沿用实际窗口 compact 300×130、expanded 300×160、collapsed 260×48，避免来源轮播改变占位。

本目录 `index.html` 是批准的独立设计预览，控件为外观示意。`runtime.html` 挂载真实 App，通过虚构服务响应验证已实现的 UI 与操作。二者数值、时间、路由及诊断编号均为虚构样例，`DEMO-01` 不可作为产品诊断码使用。生产入口不传 `codexPresentation`，展示模式由 app-server 协议披露的套餐字段派生（见下方验证记录）；显式传参仅供测试与验证入口覆盖。

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

来源基线：`bf1f2d8`（批准设计稿）；UI 在分支 `codex/pro-reservoir-ui` 上实现。环境：macOS、本机 Chrome headless、Node 24.19.0、Vite 7.3.6。产品前端构建产物为 `dist/`；包含真实 App 的独立验证构建为 `/tmp/quodex-pro-ui-dist`。

执行结果：TypeScript 产品及验证入口检查通过；Vite 产品与验证入口生产构建通过；Vitest 4 个文件、52 项测试通过。真实 App 的生产构建冒烟通过，12 张截图及机器结果位于 `docs/verification/pro-ui/`。服务、窗口位置和账户数据为注入的测试替身，原生 Tauri 窗口、真实协议及账户数据未验证。

与批准设计对照：正常单仓的宽度、玻璃边缘、mint 液体、中央 WEEK 与百分比、右侧刻度、重置时间、PRO 徽章均保留；低额度、过期、未知液位及窄条匹配。展开使用原产品的重置有效期、穿透、刷新、设置操作；失败态显示真实错误原因及重试，优先于占位稿的重置时间行。正常界面截图见 `docs/verification/pro-ui/normal.png`。

验证期间用 `diagnosing-bugs` 的最小浏览器复现定位原窄条点击失效：`pointerdown BUTTON → pointerup MAIN → click MAIN`，父层指针捕获导致按钮收不到 click。修正为窄条按钮自身捕获，移动事件仍冒泡；生产浏览器回归验证 Pro/双仓均可点击恢复、拖动不恢复。其余拖动机制未重写。

复现真实 App 的验证构建（项目根）：

```sh
node --input-type=module <<'JS'
import { build } from 'vite';
await build({root:process.cwd()+'/docs/design/pro-reservoir',build:{outDir:'/tmp/quodex-pro-ui-dist',rollupOptions:{input:{design:process.cwd()+'/docs/design/pro-reservoir/index.html',runtime:process.cwd()+'/docs/design/pro-reservoir/runtime.html'}}}});
JS
node node_modules/vite/bin/vite.js preview --outDir /tmp/quodex-pro-ui-dist --host 127.0.0.1 --port 4175
```

打开 `/runtime.html?state=normal`；可用 state 为 normal、low、stale、failed、loading、expanded、collapsed、empty、full、unavailable、blocked、refreshing。`mode=dual` 验证双仓。浏览器回归命令：`node scripts/verify-pro-ui.mjs`，需要本机 Playwright；可用 `PLAYWRIGHT_MODULE` 指定其模块路径，`CHROME_PATH` 指定浏览器执行文件，`PRO_UI_URL` 指定预览地址。该脚本在独立浏览器上下文使用虚构数据，不读取真实账户。

## 逻辑接入验证记录（2026-09-25，真实协议与原生窗口）

协议证据（codex-cli 0.147.0，本机已登录的真实 prolite 账号，只读探测）：

- `account/rateLimits/read` 响应在 `rateLimits` 对象内直接披露 `planType: "prolite"`，并携带唯一窗口 `primary: {usedPercent: 89, windowDurationMins: 10080}`、`secondary: null`——该 Pro 档账号只有 10080 分钟（周）窗口，没有 5h 窗口，「Pro 无 5h 额度」在协议层成立。
- `account/read`（`params: {}`）返回 `{account: {type: "chatgpt", email, planType}}`，与 rateLimits 的 planType 一致；账号稳定标识取自 `~/.codex/auth.json` 的 `tokens.account_id`（协议响应不含账户 ID，email 不入库不显示）。

实现（套餐与额度同源同批，杜绝身份与数据错配）：

- Rust：`CapacitySnapshot` 新增 `planType`（rateLimits 响应）与 `accountId`（读取时 auth.json）；失败诊断附带 `accountId` 表示失败发生时的登录身份；稀疏更新合并 `planType`。
- TS：`deriveCodexPresentation` 仅在协议披露 `pro` 前缀套餐（pro/prolite）时进入单仓；套餐未知（null，包括 fiveHour 缺失）一律双仓，不从窗口形状反推套餐。`useSourceSlot` 按 accountId 判定缓存归属：失败时身份与缓存不同（切换账户/退出登录）即丢弃旧账户数据，同账户失败保留「上次有效数据」。
- `weeklyLow` 暂不提供：低额度阈值是未定的业务规则，不擅自发明。

验证：`cargo test`（capacity 19 项）与 `vitest`（4 文件 59 项，含 7 项新增：pro 派生、prolite 派生、非 Pro 双仓、跨账户失败丢弃、退出登录丢弃、同账户保留、新账户快照替换）全部通过；`tsc && vite build` 通过；`node scripts/verify-pro-ui.mjs` 浏览器回归通过（12 张截图、无页面错误、Pro/双仓窄条点击恢复与拖动不误恢复）。本机环境无独立 node，npm/vite/vitest/夹具进程均以 `ELECTRON_RUN_AS_NODE=1` + ZCode 主二进制代跑。

原生 Tauri 窗口冒烟（macOS，debug 二进制 + vite dev 1420）：

- 夹具模式（planType "plus"）：双仓 76%/42%，无 PRO 徽章——`docs/verification/pro-ui/native-fixture-dual.png`。
- `CODEX_CREDITS_USE_LIVE=1`（真实 prolite 账号）：单只全宽 WEEK 舱 11% LEFT、CODEX|PRO 徽章、Resets Sat 21:28、FULL RESETS 3——`docs/verification/pro-ui/native-live-pro.png`，与协议探测值一致。

已知限制：原生窗口仅验证紧凑态（无辅助功能权限，无法脚本点击切换展开/窄条，展开/窄条/失败等状态由浏览器验证入口覆盖）；Pro 档仅有 prolite 一个真实账号可验证，`pro` 档行为按同一协议字段与产品规则处理；正式版 QuoDex.app（0.1.9，验证时用户正在运行）不含本功能，需随下个版本发布。

补充（同日稍晚）：发布形态构建的关键发现——裸 `cargo build --release` 不启用 `custom-protocol` feature，context 仍指向 devUrl（localhost:1420），窗口因透明无内容而完全不可见；必须 `cargo build --release --features tauri/custom-protocol`（`tauri build` 自动携带）。release 构建（含该 feature）在真实 prolite 账号原生渲染 PRO 单仓（周 9%，数据随用量自然变化），并已替换安装进本机 `/Applications/QuoDex.app`（旧包备份于 `release/backup/QuoDex-0.1.9-pre-pro.app`，未改版本号），安装后实拍见 `docs/verification/pro-ui/native-installed-pro.png`。正式发版时仍应走 package-app.sh 完整打包并升版本号。
