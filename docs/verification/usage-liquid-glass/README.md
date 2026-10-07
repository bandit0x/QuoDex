# 用量网页改版验证

当前状态：**Blocked**。网页实施与自动检查为 **Verified**；原生设置入口的点击检查因 macOS 锁屏未执行，不能把整体验收报为通过。用户于 2026-10-07 批准效果图并要求执行，视觉验收仍由用户决定。本文件是本轮实施与验证状态的唯一入口。

## 实施范围

按 taste-skill 的既有品牌保留方向及 Impeccable Operate 完善网页：提取 QuoDex 水体的 fbm/curl/焦散与玻璃冠面、柔光反射、Fresnel/GGX、壁厚回光，使用独立同源材质模块承托 DOM 数据。四个长区间悬停日期时在热格后方标识整周，右侧预留区域显示精确日/周/月用量；移开恢复已选日。趋势精确读数放在绘图区外，保留十字线和键盘查看。窄屏详情顺排到下方。

六个区间、合并/分开、刷新、现有日期边界、热度色阶、未知/零/未来区分、来源诊断和重试均保留。未修改 `usage-core.js`、来源采集、生产账本计算或原生设置面板；服务仅增加 `/usage-material.js` 静态资源，查询仍使用原有接口。`usage_ledger.rs` 的变化只在测试模块内，用进程号和计数器隔离并行测试，修复同毫秒临时路径碰撞。

## 来源、产物与环境

- 源码基线：`15b1cf68a84ebf47dec481c6ca50cd8b8ba2c289`；本地分支：`codex/usage-liquid-glass`。最终变更由包含本记录的本地提交确定。
- 原生构建产物：`src-tauri/target/release/bundle/macos/QuoDex.app`。二进制与嵌入网页文件的 SHA-256 见 [artifact.json](artifact.json)。未发布或替换已安装的应用。
- 实测环境：macOS 27.0.1 / arm64；Node v22.23.2 / npm 10.9.8；Google Chrome 154.0.8037.98，Asia/Shanghai。
- 网页检查时间：2026-10-07 13:01:15–13:01:50。桌面 1440×1080、DPR 1；窄屏 390×844、DPR 1，独立触摸环境 `maxTouchPoints=1`。

## 执行与结果

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
| 原生设置 → 用量统计 → 默认浏览器 | **Blocked**，系统锁屏 | [native-entry.json](native-entry.json) |

真实应用检查启动当前 `.app` 内的二进制，通过其 PID 查找随机 loopback 端口，并等待实际 `/api/usage` 双来源就绪；没有静态预览服务器。每次新建匿名来源与配置目录，不使用真实账号或聊天。夹具覆盖过去 20 日，其中两日缺失，每源 18 日、36 个请求，含 Codex 精确重放去重和 ZCode 匿名子请求。

| 区间 | Codex | ZCode | 合并 |
| --- | ---: | ---: | ---: |
| 7天 | 4,455,000 | 2,367,000 | 6,822,000 |
| 30天/3个月/6个月/1年/合计 | 12,035,000 | 6,796,000 | 18,831,000 |

逐日数据与全部日期边界见 [fixture-expected.json](fixture-expected.json)。12 项真实检查覆盖数字与去重、GL 实际像素、真实 context loss 后静态降级与恢复、六区间两种视图、未知/未来状态、四个长区间的整周几何范围和点击保持、真实 15 秒轮询保留原节点/焦点/滚动、月柱预览、趋势键盘精确读数、刷新幂等，以及触摸日期选择和减少动效下的静止画面。

首轮网页检查曾捕获原 HTML 的 `style="margin-left:auto"` 被 `style-src 'self'` 拦截。该属性已移入 CSS；最终检查没有放宽 CSP，浏览器错误为零。首次并行账本测试也暴露临时路径碰撞，修复测试隔离后保持并行执行，22 个测试通过。

## 真实截图与批准图对照

批准的唯一设计图：[approved-desktop.png](approved-desktop.png)。以下三张来自当前真实应用服务的匿名数据页面，不是新设计稿：

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

原生入口的源码连接未改动，真实应用服务已启动，但目前不能证明本次按钮点击已打开默认浏览器：Computer Use 返回“The Mac is locked and automatic unlock could not unlock it”。待用户手动解锁后，仅补该入口的实际点击检查和用户视觉验收。本次未进行 Windows 原生构建或人工浏览器跨平台验收。
