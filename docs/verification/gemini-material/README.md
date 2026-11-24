# Gemini 三仓材质预览

QuoDex 0.4.12 的 C「暖金表盘」。在 Windows 11 build 26200 上通过资源管理器的打开方式启动独立 GUI 发布产物。双击 `QuoDex-Gemini.exe` 即可查看样例液位，按 Alt+F4 退出。

## 复现

在仓库根目录使用 PowerShell 7 执行以下命令。

```powershell
npm.cmd run build
npm.cmd test
cargo build --release --manifest-path src-tauri/Cargo.toml --features gemini-material-preview
cargo test --manifest-path src-tauri/Cargo.toml --features gemini-material-preview --lib webview2_tests
Invoke-Item ./src-tauri/target/release/codex-credits-view.exe
```

截图采集使用独立的应用数据目录和 WebView2 配置目录，在浅灰桌面背景上按窗口实际像素截取。初始为 300 × 130。点击「切换样例」可循环检查读数，拖动窗口边缘可缩至 260 px 宽。

| 原生截图 | 对照结果 |
| --- | --- |
| [样稿与成品](gold-comparison.png) | 在同一份 Edge 渲染环境中逐项比对 300 px 和 260 px 两种宽度，仓名、AG、数值和百分号的文字、边界、字体、样式、颜色与阴影均与 C 样稿一致。图中右列为实际原生窗口截图。 |
| [标准三仓](standard.png) | 左上暖金 Georgia 仓名，Bahnschrift 的 AG 置于模型名上方；右下 Georgia 斜体数值在原生浮窗为 15 px，百分号为 8 px。 |
| [最小仓宽](narrow.png) | 260 × 130，三个仓名都在各自仓内，包括 AG CLAUDE/GPT。 |
| [空仓、满仓、未知](boundaries.png) | Web 为 0%，AG Gemini 为 100%，第三仓无读数时显示破折号。 |
| [低液位](one-percent.png) | 中仓的 1% 液面贴近仓底，右侧 0% 仓无液体。 |

前端构建通过，Vitest 的 189 项测试通过，原生窗口配置与运行时发现的两项 Rust 测试通过。Gemini 仓在 Canvas 2D 中按液位和波动分层绘制材质图集。Edge 在 WebGL2 可用与禁用时均渲染该材质并通过三组样例切换。字体与原生截图的验证环境为 Windows。

启动回归复现时，旧快捷方式启动的调试程序附带控制台；主程序常驻时，沿用默认 WebView2 数据目录还会导致预览窗口无法出现。旧截图脚本隐藏控制台并指定了空白数据目录，绕过了这两个条件。修正后预览使用 GUI 子系统，在当前用户的 `%LOCALAPPDATA%\QuoDex\GeminiMaterial\WebView2` 下保存自己的 WebView2 数据。保留已安装的主程序运行，分别用 Windows Shell 打开旧快捷方式与无参数 EXE，均出现 300 × 130 的三仓浮窗，进程无控制台。点击「切换样例」后，中仓从 46% 变为 100%。另在全新数据目录中复测了 EXE。

本次独立发布产物 SHA-256 为 `ED1E1B30B17EFEC010F35DBFB96D175ECE40385F51085851C5D743B594DE4472`。
