# Gemini 三仓主浮窗

Windows 主程序的右键设置提供 Gemini 来源。首次选择后，轮播也会包含 Gemini。Web、AG Gemini、AG Claude/GPT 三个仓各自显示已识别窗口中最低的剩余百分比。点击页脚 GEMINI 或右键打开「详情」，可以查看每个周期、面板披露的重置时间和本次读取时间。

## 数据来源

Windows 单包测试版中，点击浮窗底部 GEMINI →「连接 Gemini 网页账号」。QuoDex 用已安装的 Chrome 或 Edge 新建专用配置，用户在普通浏览器窗口登录并自行关闭。随后 QuoDex 每五分钟尝试读取一次网页双周期，也可手动刷新。每次采样使用同一个专用配置，运行时不依赖扩展、驱动或额外 CLI。使用本机模拟站点已验证窗口关闭、额度变化和会话撤销；Google 真实账号的关窗自动刷新仍待验收。[实验记录](../../research/gemini-background-probe/verify-browser-session.md)

未连接独立会话时，网页仓可从已打开的官方用量页读取。AG 两仓继续从桌面「设置 → 模型」的两个模型组取数；关掉 Antigravity 后只能显示此前读数及其时间。详情标注数据来源，周期或账号不可确认时报告未知。下方较早的真实读数和截图对应页面探针。[Gemini 官方帮助](https://support.google.com/gemini/answer/16275805?hl=en) · [Antigravity 模型面板](https://antigravity.google/docs/models)

## 成品对照

| 验收场景 | Windows 主程序采集结果 |
| --- | --- |
| 300 × 130 标准浮窗 | 三仓共用 C 稿的液体图集、左上暖金仓名和右下 Georgia 斜体数字。对照仓体尺寸、字位与三种色相。[主浮窗](standard.png) · [批准稿](../gemini-material/standard.png) |
| 260 × 48 窄条 | 三个仓名和读数均可见，点击仓体恢复标准视图。[窄条](narrow.png) |
| 空仓、满仓、未知 | 可见面板给出 0%、100% 和方向不明的百分比，浮窗依次显示 0%、100%、破折号。[三种状态](mixed.png) |
| 单一来源消失 | 关闭网页面板后，Web 保留带标记的最后值，另两仓继续独立读取。[旧读数](stale.png) |
| 高液位静置 | 将三仓设为 98%、99%、100%。窗口静置，三仓液面均有 Codex 的亚像素微风，玻璃轮廓和字位稳定。[桌面实录](full-idle.gif) |
| 拖动与松手 | 在相同液位横拖真实窗口，液面与反光逐渐响应，松开后回落。固定桌面视角保留窗口运动，便于对照迟滞。[拖动实录](full-drag.gif) |
| 减少动效 | 使用开启「减少动效」的配置重复拖动。固定位置静置期间，以及松手停稳后的连续采样中，液体区域 RGB 单通道变化超过 2 的像素均为 0。 |

表中的截图使用匿名离线面板。Windows 11 build 26200，Edge 158，发布包内 WebView2 151。通过 Windows Shell 无参数启动普通 GUI 发布程序，在独立配置目录下完成探针读取、切换视图、拖动与静止对照。

## 真实账号读数复验

2026-11-25，在 Windows 11 使用已登录的 Chrome 和 Antigravity Desktop 2.35.0。分别打开 Gemini「用量限额」和 Antigravity「设置 → 模型」。将模型设置停在顶部，Claude/GPT 卡片仍在滚动视口外。用干净的 QuoDex 配置启动修复后的 Windows 发布构建，三仓均显示余额。刷新后逐项核对两个周期和面板披露的重置提示。

| 额度仓 | 5 小时剩余 | 每周剩余 | 仓体显示 |
| --- | --- | --- | --- |
| Web | 98% | 100% | 98% |
| AG Gemini | 99% | 99% | 99% |
| AG Claude/GPT | 100% | 100% | 100% |

旧版会按窗口标题漏掉独立「用量」页，把 Antigravity 的中文刷新说明拆成新周期，并忽略滚动视口外的模型组。真实中文行的回归测试覆盖用量方向、周期和刷新提示。网页只有整行可访问标签提供重置时间时，探针从该行标签读取时间。

本次复验的 Windows 发布 EXE SHA-256 为 `BFE1C3C95DCBBCDBBADBC846BD477B07CD7B883B66F72BCDD11E0B4FF43EB281`。生产构建通过，前端 187 项和 Rust 177 项测试通过，Rust 另有 5 项原有忽略用例。

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
