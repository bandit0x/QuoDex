# Gemini 三仓主浮窗

Windows 主程序的右键设置提供 Gemini 来源。首次选择后，轮播也会包含 Gemini。Web、AG Gemini、AG Claude/GPT 三个仓各自显示已识别窗口中最低的剩余百分比。点击页脚 GEMINI 或右键打开「详情」，可以查看每个周期、面板披露的重置时间和本次读取时间。

## 数据来源

Web 仓读取 Chrome 或 Edge 中已登录的 Gemini「设置 → 使用限额」面板。AG 两仓分别读取 Antigravity 用量面板中的两个模型组。探针每 15 秒读取一次 Windows 辅助功能树，也可以点击「刷新」。窗口需展开并显示对应页面。窗口关闭、最小化或切到其他页面后，已有读数加虚线并标记「上次」。程序重启后从未知开始。多个窗口同时显示同一来源的额度时，详情提示保留一个窗口。[Gemini 官方帮助](https://support.google.com/gemini/answer/16275805?hl=en) · [Antigravity 模型及额度面板](https://antigravity.google/docs/models)

## 成品对照

| 验收场景 | Windows 主程序采集结果 |
| --- | --- |
| 300 × 130 标准浮窗 | 三仓共用 C 稿的液体图集、左上暖金仓名和右下 Georgia 斜体数字。对照仓体尺寸、字位与三种色相。[主浮窗](standard.png) · [批准稿](../gemini-material/standard.png) |
| 260 × 48 窄条 | 三个仓名和读数均可见，点击仓体恢复标准视图。[窄条](narrow.png) |
| 空仓、满仓、未知 | 可见面板给出 0%、100% 和方向不明的百分比，浮窗依次显示 0%、100%、破折号。[三种状态](mixed.png) |
| 单一来源消失 | 关闭网页面板后，Web 保留带标记的最后值，另两仓继续独立读取。[旧读数](stale.png) |
| 拖动与松手 | 在真实窗口按住液仓横拖，液面倾斜，瓶底焦散位移较小且方向相反，松手后液面回摆。[原速附近的连续帧](motion.gif) |
| 减少动效 | 从设置打开「减少动效」，重复同一拖动。在固定液面区和瓶底区，静置、拖动、松手三个阶段内，RGB 单通道变化超过 2 的像素均为 0。 |

表中的截图使用匿名离线面板。Windows 11 build 26200，Edge 158，发布包内 WebView2 151。通过 Windows Shell 无参数启动普通 GUI 发布程序，在独立配置目录下完成探针读取、切换视图、拖动与静止对照。

另在 Antigravity Desktop 2.35.0 登录后打开 Settings → Models，将官方面板与新启动的 QuoDex 逐仓核对。两组周窗口的百分比一致，Gemini 组的完全刷新倒计时在浮窗详情中可读。当前面板只披露周窗口。Web 仓已用独立 Edge 窗口验证原生读取链路，登录账号的网页面板仍待核对。

本地生产构建通过，前端 190 项测试及额度解析、偏好设置、WebView2 相关的 12 项 Rust 测试通过。可执行文件 SHA-256 为 `66B82A5ED695A0283521AD0DA389492C1A1FDB3E4FCAA053EDD4F8D5838592AC`。

## 复现

在 PowerShell 7 中执行以下命令。

```powershell
npm.cmd run build
npm.cmd test
cargo test --manifest-path src-tauri/Cargo.toml --lib gemini_quota
cargo test --manifest-path src-tauri/Cargo.toml --lib preferences::tests
cargo test --manifest-path src-tauri/Cargo.toml --lib webview2_tests
cargo build --release --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
```

在安装了 Playwright 和 Edge 的环境运行 `node scripts/gemini-panel-fixture.mjs`。若 Playwright 位于独立工具目录，可将 `PLAYWRIGHT_MODULE` 指向其入口的 file URL。该脚本开启两个临时浏览器窗口，并在本地响应页面请求。用新的 QuoDex 配置启动，右键选 Gemini。两组 AG 窗口取最小值后，三仓应读作 72%、46%、12%。在脚本终端输入 `mixed` 检查边界，再输入 `close-web` 检查旧读数。输入 `duplicate-ag` 可复现歧义，`close-extra` 后恢复识别，`chat` 用于检查普通消息里的模型名称不会触发探针，`quit` 关闭临时浏览器。
