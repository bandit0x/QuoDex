# ZCode 近期用量漏显修复

状态：Acceptance pending。2026-10-26。当前唯一验证入口。

## 原因与已批准的修正

全部设备账本已有近期记录，但聚合快照没有完整的连续采集覆盖信息。旧图只绘制连续完整 7 日的均值；缺失任一天就令均值为空，原始记录也未绘制。复现确认：即使最近有记录，默认 30 天图的 ZCode 线也可能停在更早的日期。原先“平均线断开属于记录不足”的解释不能解决已入账用量不可见的问题。

用户明确选择：每日真实用量为主线，平均趋势为辅助，缺失断开。本次按此实施：

- 每日实线和淡面积采用 `dailyValue`，不再依赖平均窗口是否可用。
- 3/7 日平均仍要求完整窗口，作为更细、更淡的虚线。不会把未知日补零，也不会悄悄缩小均值分母。
- 今天用空心累计点与点状延长线标识，不计入完整日平均；昨日缺失时不跨接今天。
- 连续日不常驻绘制节点，孤立的真实记录以实心小点保留，不恢复旧的空心散点墙。
- 主线坐标轴容纳真实值和辅助均值，悬停标记定位真实值。真实峰谷不会被均值替换。
- 范围仍区分“本机 / 全部设备”。其他设备上的记录不应在“本机”范围显示。

账本、采集器和云端协议未改动。

## 验证

来源：QuoDex 0.4.5，基于 ead178b；源码指纹和已安装程序 SHA256 见 [manifest.json](manifest.json)。Windows / PowerShell 7.6.5 / Node 24 / Chrome 156.0.8078.47。

- [单元与真实 DOM 测试](tests.txt)：15 文件、181 项通过。先运行并看到原版回归失败，再修复通过。覆盖无完整均值窗口时的近期日线、今天累计、孤立记录与缺口断开。
- [生产构建](production-build.txt)：使用 Tauri CLI 构建生产资源，tsc/Vite 与 Rust release 通过。MSVC linker stdout 为提示性 warning。
- [连续数据烟测](report.json)和[缺口烟测](gaps/report.json)：真实产物读取新建匿名 SQLite/JSONL 记录，全部设备范围中，ZCode 日线仍到达最近完整日，而辅助均值可以提前断开；没有前端注入。设备范围、7/30 天窗口、合并/分开、键盘、390px、读数不遮挡、断连保留图和重试均通过。
- 已生成并安装新的本地 NSIS 包；备份配置目录，核对停止应用后到安装完成之间的数据文件哈希不变。真实安装版主窗口已通过 `verify-installed-window.mjs` 检查，加载嵌入的生产页面并渲染额度控件。
- 已用实际安装版服务与真实账本逐日比对：每一个已记录 ZCode 日期都能在日线路径或孤立点中找到；没有跨接未知日；今天累计点存在。真实账本及窗口截图只存本地 E 盘，不进 Git。

## 图像对照

- [桌面每日实线与辅助虚线](desktop-success.png)
- [缺口样例：日线继续、均值可中断](gaps/desktop-success.png)
- [桌面逐日读数](desktop-operation.png)
- [390px 操作态](narrow-operation.png)
- [断连状态](desktop-failure.png)

这些仓库截图均为匿名样例。真实曲线随记录变化，缺失处仍断开；记录本身稀疏时，孤立日期只能显示实心点，不能伪造连接。

## 复现

```powershell
npm.cmd test
$env:CARGO_TARGET_DIR = 'E:\QuoDex-builds\trend-redesign-target'
npm.cmd run tauri:build -- --no-bundle -- --locked
node scripts/verify-usage-trend.mjs 'E:/QuoDex-builds/trend-redesign-target/release/codex-credits-view.exe' 'C:/Users/bandit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs' 'C:/Program Files/Google/Chrome/Application/chrome.exe' 'docs/verification/zcode-daily-main'
# 同命令改输出到 docs/verification/zcode-daily-main/gaps 并追加 --gaps
```

本机安装包使用系统 WebView2。未覆盖 macOS、真实触摸设备和其他电脑的安装流程。旧统计标签连接的是重启前的随机端口，应从 App 重新打开；不能将旧标签中的静态图作为更新后结果。
