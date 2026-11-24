# Gemini 三仓材质预览

基于 QuoDex 0.4.12、`fbdb968`。在 Windows 11 build 26200 上构建并启动嵌入前端资源的 Tauri 调试产物。预览入口只使用样例液位，可通过 Alt+F4 退出。

## 复现

在仓库根目录使用 PowerShell 7 执行以下命令。

```powershell
npm.cmd run build
npm.cmd test
cargo build --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
cargo test --manifest-path src-tauri/Cargo.toml --lib webview2_tests
& ./src-tauri/target/debug/codex-credits-view.exe --gemini-material
```

截图采集使用独立的应用数据目录和 WebView2 配置目录，在浅灰桌面背景上按窗口实际像素截取。初始为 300 × 130。点击「切换样例」可循环检查读数，拖动窗口边缘可缩至 260 px 宽。

| 原生截图 | 对照结果 |
| --- | --- |
| [标准三仓](standard.png) | 72%、46%、12% 三个独立液位，能看到弧面的前后缘、侧壁回光与底部聚光。仓名采用切角刻字，等宽数字显示为 15.5 逻辑像素。 |
| [最小仓宽](narrow.png) | 260 × 130，三个仓名都在各自仓内，包括 AG CLAUDE/GPT。 |
| [空仓、满仓、未知](boundaries.png) | Web 为 0%，AG Gemini 为 100%，第三仓无读数时显示破折号。 |
| [低液位](one-percent.png) | 中仓的 1% 液面贴近仓底，右侧 0% 仓无液体。 |

前端构建通过，Vitest 的 189 项测试通过，原生窗口配置与运行时发现的两项 Rust 测试通过。另用 Edge 加载相同的构建资源，分别检查 WebGL2 与强制 Canvas 2D 后备，均完成三组样例切换和减少动效下的窄仓文字边界检查。折射与焦散效果以 WebGL2 为准。

本机验收产物的 SHA-256 为 `545CD0026B8323D43937185BFA55EF6DC3FB47DAB383DA15449EF96CEF778632`。
