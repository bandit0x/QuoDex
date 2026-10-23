# 区间趋势 A 方案验收

状态：Acceptance pending。日期：2026-10-23。用户已批准设计并授权实现，当前等待实际体验验收。

## 结果与来源

QuoDex 0.4.5，基于 ed6d0a95b4f6386fb03e2a46cbcd01c87a6f7386 的本地改动。青绿同轴双趋势线与淡填充取代重色堆叠。7 天区间用向后 3 日平均，其余区间用向后 7 日平均。平均只使用连续完整日：真实零参与，缺失不补零，窗口不足仅显示原始空心点。今日仅显示累计原值，不加入平均。账本总量不变。

构建产物：[codex-credits-view.exe](E:/QuoDex-builds/trend-redesign-target/release/codex-credits-view.exe)。SHA256：`5C21B4958A2CC30AB48E90B9CA206CAC14233C66D5692E5A138680E383121A0F`。

Windows / PowerShell 7.6.5 / Node 24.18.0 / Chrome 156.0.8078.47。真实 Rust release 可执行文件内嵌统计页，由本机 HTTP 服务返回；输入是新建的匿名本地账本目录，未使用个人账本或热缓存。D 盘构建空间不足后，复制构建缓存到 E 盘并重建，未使用失败或过期产物验收。

## 证据

- [前端测试](tests.txt)：15 个文件、178 项通过；新测试覆盖真实零、孤立尖峰、完整窗口、缺失与非有限值、区间前预热、今日排除和原值保留。
- [前端构建](build.txt)：tsc + Vite 通过。
- [原生构建](native-build.txt)：cargo release 通过；MSVC 创建库的 linker stdout 为 warning，不影响产物生成。
- [连续记录真实产物报告](report.json)与[带缺口真实产物报告](gaps/report.json)：来源入账精确一致、7/30 天窗口、合并/分开、键盘左右与 Escape、390px 无横向溢出、图外读数、实际网络中断保留曲线、QDU-708 和重试恢复均通过；无 pageerror。

| 批准的设计 | 实际产物与对照 |
|---|---|
| [A 状态设计稿](approved-design.png)：青绿双线、淡填充 | [桌面操作](desktop-operation.png)：双线同轴，原值与平均并列，十字线定位；圆点不随 SVG 拉伸 |
| 成功状态不遮挡曲线 | [刷新成功](desktop-success.png)：更新时间在图外，绘图区留给趋势 |
| 连接失败保留旧数据，原因与重试 | [失败状态](desktop-failure.png)：曲线保留，显示 QDU-708、启动应用的指引和重试 |
| 390px 精确读数在图下 | [窄屏操作](narrow-operation.png)：完整整数读数位于图下，无横向滚动 |
| 缺失处必须断开，不能沿用设计稿误画 | [缺口样例](gaps/desktop-operation.png)：缺失区域留白/斜纹，窗口不足不连接；已知原值以空心点显示 |

设计图中的数字与几何为示意。实际平均按固定窗口计算，窗口不足时出现空心点，这是已批准的数据规则，不承诺每个区间都有连续主线。原始尖峰与今日累计可能扩大纵轴，这是为保证原值可见。

## 复现

```powershell
npm.cmd test
npm.cmd run build
$env:CARGO_TARGET_DIR = 'E:\QuoDex-builds\trend-redesign-target'
cargo build --release --manifest-path src-tauri/Cargo.toml
node scripts/verify-usage-trend.mjs 'E:/QuoDex-builds/trend-redesign-target/release/codex-credits-view.exe' 'C:/Users/bandit/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs' 'C:/Program Files/Google/Chrome/Application/chrome.exe' 'docs/verification/trend-redesign'
# 额外验证缺口：相同命令改输出为 docs/verification/trend-redesign/gaps，追加 --gaps
```

## 限制与下一步

本轮验证统计网页真实产物，未生成安装包，未覆盖 macOS 或真实触摸设备；390px 使用浏览器视口验证。设计检测器对沿用的 11px 坐标文字给出 advisory：根 DESIGN.md 的字号契约针对浮窗，统计页继续沿用自身刻度。没有新增运行依赖。请用上方 exe 打开统计页验收外观和操作；确认后再决定是否打包发布。
