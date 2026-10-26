# A 方案视觉修正与安装验证

此页为 2026-10-23 的历史验证记录。2026-10-26 用户批准改为每日真实用量主线，当前状态与验证见 [每日主线修复](../zcode-daily-main/README.md)。

## 触发与根因

用户截图显示：顶部读数预留区过大、预热期原始空心点形成散点墙、原始尖峰撑高平均图纵轴，双曲线被压在底部。此前设计图不能作为实际视觉效果的证据。

另一个已修复的交付问题：直接 `cargo build --release` 未启用 Tauri CLI 的生产资源模式，原生主窗口请求开发服务器，显示 `ERR_CONNECTION_REFUSED`。生产构建统一改用 `npm.cmd run tauri:build -- --no-bundle -- --locked`；`scripts/verify-installed-window.mjs` 用真实窗口检查错误页、嵌入的 `http://tauri.localhost/` 和实际额度控件。旧安装上已运行并出现 QAS-001，重装后同一检查通过。

## 修正范围

- 平均图纵轴只依据可用平均值。原始峰值、零与今日累计继续保留在逐日读数及独立汇总中，不参与主图缩放。
- 默认不再铺原始散点；连续窗口不足不编造平均线。少量独立平均点仍可显示。
- 更新状态与今日累计并为一行，桌面读数区从 112px 缩为 62px，读数横向排布；窄屏仍放在图下。
- 提高淡填充可见度；保留 3/7 日向后平均、保形插值、缺口断线。来源只有短线段时，图下解释连续记录不足的原因。

用户本次视觉纠正取代早期设计中“样本不足时展示原始点”的默认呈现。原始值仍可查询，未改变账本或原始用量。

## 结果与证据

环境：Windows、PowerShell 7.6.5、Node 24.18.0、Chrome 156.0.8078.47。

- [测试记录](tests.txt)：15 文件、179 项通过；新增回归固定复现原始尖峰/今日累计错误抬高平均轴。
- [生产构建记录](production-build.txt)：Tauri CLI release 构建通过，包含 tsc/Vite。MSVC linker stdout 提示为 warning。
- [连续记录报告](report.json)、[缺口报告](gaps/report.json)：真实 Rust 产物服务真实匿名磁盘账本，无前端注入；默认无原始散点、顶部紧凑、桌面读数不推动/覆盖绘图区、7/30 天窗口、合并/分开、390px 无溢出、失败保留曲线、QDU-708 与重试均通过。
- [桌面常态](desktop-success.png)、[桌面操作](desktop-operation.png)、[窄屏操作](narrow-operation.png)、[失败](desktop-failure.png)。缺口样例见 [缺口操作](gaps/desktop-operation.png)。
- 本地 NSIS 已重新安装；安装前备份账本与设置，并核对安装前后文件哈希未变；真实安装版主界面检查通过。随后使用安装版服务和用户实际账本重现 30 天区间，确认散点消失、平均线恢复高度。个人账本截图与窗口树仅保留在本地 E 盘，不进入 Git。
- [安装与源码指纹](manifest.json)。版本号仍为 0.4.5；本地安装目录为 `%LOCALAPPDATA%\QuoDex`。

## 与批准设计的对照和限制

双线同轴、淡填充、原值与平均分开、读数在图外、窄屏读数在图下已落实。实际曲线必须由真实数据决定，不能承诺与生成设计图的山峰形状相同。缺失导致的短线段不跨接；真实零仍参与平均。系统 WebView2 作为运行时，未使用临时浏览器环境变量。

实际浏览器当前标签的 UI 自动化因 URL 识别限制不可用；当前页面截图由安装版自己的 HTTP 服务在单独浏览器中生成，未声称控制了用户原来的标签。原生主窗口使用独立 Windows Computer Use 读取并验证，不能再以 HTTP 服务正常替代主窗口正常。

## 复现

```powershell
npm.cmd test
$env:CARGO_TARGET_DIR = 'E:\QuoDex-builds\trend-redesign-target'
npm.cmd run tauri:build -- --no-bundle -- --locked
node scripts/verify-usage-trend.mjs 'E:/QuoDex-builds/trend-redesign-target/release/codex-credits-view.exe' 'C:/Users/bandit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs' 'C:/Program Files/Google/Chrome/Application/chrome.exe' 'docs/verification/trend-visual-fix'
# 相同命令输出改为 docs/verification/trend-visual-fix/gaps 并追加 --gaps 验证缺口
```

原生窗口回归：在 Computer Use 的 node_repl 导入 `scripts/verify-installed-window.mjs`，调用 `verifyInstalledWindow(sky, installedExe, localEvidenceDirectory)`；该调用已在旧错误窗口失败、在更新后的实际安装版通过。个人窗口树及截图不得放进仓库。
