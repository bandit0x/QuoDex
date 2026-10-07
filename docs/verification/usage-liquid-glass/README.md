# 用量网页改版验证

当前状态：**Acceptance pending**。用户于 2026-10-07 批准月度柱状图局部方案并要求更新 App；该方案已实施，本地 `/Applications/QuoDex.app` 已更新并重新启动。构建、相关测试、真实应用界面、安装及签名检查为 **Verified**，待用户实际使用验收。本文件是当前实施与验证状态的唯一入口。

## 本次月度柱状图

源码提交：`6646519ee99471dde4b31e19ee5721d3b8df429d`，本地分支 `codex/usage-liquid-glass`。月度图脱离热力墙周列，使用独立等宽月份分组、相同柱宽和共同基线；数值在柱顶、年月在底部，以“月度已记录用量 / 所选期间内 · tokens”解释统计范围。正值按真实比例展示，去掉旧有 5% 最小柱高；未知 `—` 的斜纹短桩与确认零 `0` 区分。月预览、离开恢复日期、轮询保留节点继续工作；窄屏和较长期间独立横向滚动，聚焦月份自动进入可视区域。统计接口、来源、六个期间、合并/分开、日/周详情及趋势均保留。

批准图：[月度柱状图方案](month-bars/approved-month-bars.png)。真实产物：[桌面 3 个月](month-bars/installed/page-desktop-3m-hover.png)、[390px 一年月图](month-bars/installed/page-390-month-bars.png)。图中演示热格及柱高不作为统计实现依据；实际柱高由月合计计算。匿名数据 9 月为 12,009,000，10 月为 6,822,000，比例约 56.8%。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 前端测试 | 12 文件，164 项通过；其中用量 DOM/core 38 项 | [输出](month-bars/frontend-tests-output.txt) |
| 生产前端与原生构建 | `tsc`、Vite、Rust release、`.app` 打包通过 | [构建输出](month-bars/build-output.txt)、[产物指纹](month-bars/artifact.json) |
| 新构建 App 的匿名真实旅程 | 13 项通过，0 浏览器错误 | [报告](month-bars/verification.json) |
| 安装版在全新匿名目录的真实旅程 | 13 项通过，0 浏览器错误 | [安装版报告](month-bars/installed/verification.json) |
| 月图几何与操作 | 桌面等宽月份、64px 柱宽、无重叠、共同基线和实际比例；跨年标签；390px 36px 柱宽，月图横滚/聚焦不改变热力墙滚动，整页无横向溢出 | 同上报告中的 `monthChartGeometry` 与 `mobileMonthChartGeometry` |
| 规范与方案独立审查 | 相对 `d263d7d` 的两个审查轴均未发现具体缺陷 | 本地实现提交及 `src/usageCore.test.js`、`scripts/verify-usage-ui.mjs` 的针对性回归 |
| 本地安装、签名和启动 | 严格签名通过，旧包已备份，Codex runtime 指纹保持；实际用户配置 App 已重新启动并读到额度/任务，设置入口显示已请求浏览器打开；静态网页五文件逐字节匹配源码 | [安装记录](month-bars/local-install.json) |

实测环境仍为 macOS arm64、Google Chrome 154、Asia/Shanghai；桌面 1440×1080，触摸窄屏 390×844。安装版匿名验证于 2026-10-07 14:00 开始。两次 QA 均从新建来源/账本目录启动真实 `.app`，只结束各自创建的测试进程，不依赖用户缓存、不保存真实用量或聊天。构建原包与补齐 runtime 后重签的安装包指纹分别记录，不能混用。

本轮可复现命令：

```sh
npm test
npm run tauri:build -- --config src-tauri/tauri.macos.conf.json --bundles app
node scripts/verify-usage-ui.mjs --output docs/verification/usage-liquid-glass/month-bars
node scripts/verify-usage-ui.mjs --app /Applications/QuoDex.app/Contents/MacOS/codex-credits-view --output docs/verification/usage-liquid-glass/month-bars/installed
```

与批准图逐项对照：独立窄柱及年月/柱顶数字已呈现；水流背景和玻璃面板保持；未知使用斜纹短桩；右侧详情无覆盖；窄屏月图内部滚动、年月可见。实拍已经逐张查看。批准图为局部裁切，真实截图保留整页，因此页头、总量和趋势仍可核对。

## 实施范围

按 taste-skill 的既有品牌保留方向及 Impeccable Operate 完善网页：提取 QuoDex 水体的 fbm/curl/焦散与玻璃冠面、柔光反射、Fresnel/GGX、壁厚回光，使用独立同源材质模块承托 DOM 数据。四个长区间悬停日期时在热格后方标识整周，右侧预留区域显示精确日/周/月用量；移开恢复已选日。趋势精确读数放在绘图区外，保留十字线和键盘查看。窄屏详情顺排到下方。

六个区间、合并/分开、刷新、现有日期边界、热度色阶、未知/零/未来区分、来源诊断和重试均保留。未修改 `usage-core.js`、来源采集、生产账本计算或原生设置面板；服务仅增加 `/usage-material.js` 静态资源，查询仍使用原有接口。`usage_ledger.rs` 的变化只在测试模块内，用进程号和计数器隔离并行测试，修复同毫秒临时路径碰撞。

## 上一轮水流改版的来源、产物与环境

- 源码基线：`15b1cf68a84ebf47dec481c6ca50cd8b8ba2c289`；本地分支：`codex/usage-liquid-glass`。最终变更由包含本记录的本地提交确定。
- 原生构建产物：`src-tauri/target/release/bundle/macos/QuoDex.app`。上一轮实现提交 `25d99ab` 的指纹见 [artifact.json](artifact.json)，上一轮安装证据见 [local-install.json](local-install.json)。当前月图安装使用上节 `month-bars/` 下的新产物记录；未发布远端。
- 实测环境：macOS 27.0.1 / arm64；Node v22.23.2 / npm 10.9.8；Google Chrome 154.0.8037.98，Asia/Shanghai。
- 网页检查时间：2026-10-07 13:01:15–13:01:50。桌面 1440×1080、DPR 1；窄屏 390×844、DPR 1，独立触摸环境 `maxTouchPoints=1`。

## 上一轮水流改版的执行与结果

在项目根目录复现：

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml usage_
npm run tauri:build -- --config src-tauri/tauri.macos.conf.json --bundles app
node scripts/verify-usage-ui.mjs --output docs/verification/usage-liquid-glass
```

GUI 应用、Chrome 及本机监听须能在当前执行环境启动。脚本使用 Node 内置 `node:sqlite`；默认 Chrome 和 Playwright 路径见 `--help`，可用 `--chrome`、`--playwright` 指定既有运行时，不安装依赖。`--keep-app` 可保留脚本创建的匿名应用供原生入口检查；不传时只停止该脚本创建的进程。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| 前端相关回归及项目测试 | 12 个文件，161 个测试通过 | [frontend-tests-output.txt](frontend-tests-output.txt) |
| Rust 用量相关测试 | 22 个通过，0 个失败 | [rust-usage-tests-output.txt](rust-usage-tests-output.txt) |
| 生产前端与原生 `.app` 构建 | `tsc`、Vite、Rust release 和 app 打包通过 | [build-output.txt](build-output.txt) |
| 真实应用启动、网页及交互 | 12 项通过；浏览器错误为 0 | [verification.json](verification.json) |
| 规范审查 | 原轮询焦点问题已定点复核修复 | `usage.js:738` 与 `usageCore.test.js:457` |
| 方案审查 | 点击保留周高亮与无新增轮询保留节点已定点复核修复，范围未扩展 | `usage.js:729` 与对应 DOM 回归测试 |
| 原生设置 → 用量统计 → 默认浏览器 | **Verified**，安装版实际点击后在 Google Chrome 显示用量网页 | [native-entry.json](native-entry.json) |
| 本地更新与启动 | **Verified**，运行时保留、整包严格签名及 HTTP 静态资源核对通过 | [local-install.json](local-install.json) |

真实应用检查启动当前 `.app` 内的二进制，通过其 PID 查找随机 loopback 端口，并等待实际 `/api/usage` 双来源就绪；没有静态预览服务器。每次新建匿名来源与配置目录，不使用真实账号或聊天。夹具覆盖过去 20 日，其中两日缺失，每源 18 日、36 个请求，含 Codex 精确重放去重和 ZCode 匿名子请求。

| 区间 | Codex | ZCode | 合并 |
| --- | ---: | ---: | ---: |
| 7天 | 4,455,000 | 2,367,000 | 6,822,000 |
| 30天/3个月/6个月/1年/合计 | 12,035,000 | 6,796,000 | 18,831,000 |

逐日数据与全部日期边界见 [fixture-expected.json](fixture-expected.json)。12 项真实检查覆盖数字与去重、GL 实际像素、真实 context loss 后静态降级与恢复、六区间两种视图、未知/未来状态、四个长区间的整周几何范围和点击保持、真实 15 秒轮询保留原节点/焦点/滚动、月柱预览、趋势键盘精确读数、刷新幂等，以及触摸日期选择和减少动效下的静止画面。

首轮网页检查曾捕获原 HTML 的 `style="margin-left:auto"` 被 `style-src 'self'` 拦截。该属性已移入 CSS；最终检查没有放宽 CSP，浏览器错误为零。首次并行账本测试也暴露临时路径碰撞，修复测试隔离后保持并行执行，22 个测试通过。

## 上一轮整体页面的截图与批准图对照

上一轮整体设计图：[approved-desktop.png](approved-desktop.png)。以下三张为上一轮真实应用匿名数据截图；月图最新实拍见本文首节：

- [桌面：3个月合并、整周悬停](page-desktop-3m-hover.png)
- [桌面：30天分开](page-desktop-split.png)
- [390px：触摸环境与减少动效](page-390-full.png)

| 批准的要点 | 实际截图与检查 |
| --- | --- |
| 水流和圆润液态玻璃 | 页内焦散水体可见；容器和胶囊具有曲面反射及壁厚暗部。第一轮边缘叠加过厚，已减薄并去除重复 CSS 内圈；最终三张图已逐张查看。 |
| 原有信息顺序与层级 | 范围/视图控件 → 总量与来源 → 覆盖说明 → 日历或热墙/详情 → 趋势；保留精确数字和来源名称。 |
| 整周高亮，不遮挡数据 | 纵向底光覆盖同列七日，格子热度色级不改变；日、周、月数字位于右侧固定留白。 |
| 点击与现有查看能力 | 点击后高亮保留，移开显示已选日；月柱与趋势仍可查看原有精确数值。 |
| 窄屏可读、可操作 | 控件换行，详情在日历下方；一年热墙内部横向滚动，触摸选择后页面和墙滚动位置不变，整页无横向溢出。 |

批准图中的演示日期映射及平滑趋势点位没有作为统计实现依据；真实产物继续使用既有按日 SVG 图形和实际缺失区间，未为贴图修改统计逻辑。固定视口的 canvas 在全页长截图中仅覆盖捕获时的视口，长图不能作为滚动后动态背景的判断依据。

## 已知限制与下一步

首次原生入口检查曾被系统锁屏阻止，上一轮已在系统解锁后补验完整默认浏览器入口。本次原生入口也实际点击，观察到“已请求浏览器打开”，并核对新服务的静态资源；当前安装包另经 Chrome 全新匿名环境验证。旧包位置见本次 [安装记录](month-bars/local-install.json)，安装器未触碰配置目录。本次未进行 Windows 原生构建或人工浏览器跨平台验收。月图方案已获批准并实施，最终使用验收仍待用户确认。
