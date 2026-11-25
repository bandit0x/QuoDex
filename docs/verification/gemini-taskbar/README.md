# D 汇流棱镜 · Windows 验证

QuoDex 0.4.12 主浮窗使用左置棱镜。点棱镜打开跨来源的报错和等待，点光纤打开完整来源列表。Gemini 行合并 Web 与 Antigravity，详情逐项显示入口。Antigravity 按聊天 ID 归组，模型切换不增加任务位。一个入口不可用时，行尾出现问号，另一个入口已知的任务仍可展开。

| 对照项 | D 设计稿 | Windows 实际产物 |
| --- | --- | --- |
| 300 px 浮窗 | 186 × 36 px 任务区，棱镜在左 | [标准浮窗](standard.png) |
| 260 px 窄条 | 164 × 33 px 任务区，整行可点 | [窄条浮窗](narrow.png) |
| Gemini 合并详情 | Web 和 Antigravity 逐条标注 | [同组来源](origins.png) |

在 Windows 11、96 DPI 下启动包含前端正式构建的 Tauri 发布程序。测试使用独立配置、拦截到本地的 Edge 页面和匿名 Antigravity SQLite 摘要。窗口显示三个液仓读数，合并详情显示四条聊天。棱镜筛出两条待处理事项。关闭网页聊天后，Gemini 行保留三条 Antigravity 聊天并显示网页不可用，随后切换窄条检查棱镜高度与按钮边界。[已确认的 D 稿](../../design/gemini-taskbar/optics/prism-compact.png)

在安装 Edge、Playwright、Python、pywin32 和 Pillow 的 Windows 环境，从仓库根目录执行以下命令。Playwright 装在独立工具目录时，将 `PLAYWRIGHT_MODULE` 设为模块入口的 file URL。构建输出位于独立 Cargo 目录时，将 `QUODEX_EXECUTABLE` 设为发布 EXE 的绝对路径。

```powershell
npm.cmd run build
npm.cmd test
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo build --release --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol
python scripts/verify-gemini-taskbar.py
```

截图默认保存在 `.scratch/gemini-taskbar-native`。浏览器夹具只拦截当前测试用的匿名页面。原生检查通过系统 UI Automation 读取按钮并产生真实指针输入。

上方三张布局截图所用发布 EXE 的 SHA-256 为 `1AD7D9647528134C419B28F2D7C257AC88F106C7E515072A602E7C1DD5EBF367`。

## 真实账号验收

2026-11-25，在 Windows 11 上使用 Chrome 中已登录的 Gemini 和 Antigravity Desktop 2.35.0。用独立 QuoDex 配置启动发布 EXE，通过无文件、无工具的纯文本测试对话核对结果。

发布 EXE 的 SHA-256 为 `9B05AE9C8D4204567000D34F1A4C9567BCAEBA28F6580DE4124397A7B828FF31`。前端 187 项和 Rust 176 项测试通过，Rust 另有 5 项原有忽略用例。网页重载和滚动导致旧轮次再次出现在辅助功能树时，回归测试确认有旧回复仍不会产生新提醒。

| 入口 | 成功提醒 | 返回原聊天 |
| --- | --- | --- |
| Gemini Web | 完成一轮新回复后，Gemini 列表显示「Web · 已完成」。 | 从原聊天切回 Gemini 首页，再点 QuoDex 对应任务。Chrome 打开同一聊天路径，最后一条验收回复仍可见。 |
| Antigravity | 完成独立测试对话后，Gemini 列表显示「Antigravity · 已完成」。 | 切到 Antigravity 首页并点击 QuoDex 对应任务。原生客户端回到同一聊天路径，验收回复仍可见。 |

网页探针通过当前标签页的辅助功能树识别新轮次和最后一条回复操作。它能保留本次运行已观察到的近期成功提醒。点击网页项通过默认浏览器打开原聊天地址，验收机的默认浏览器是 Chrome。Antigravity 用摘要库和本机会话日志尾部确认最新轮次已结束，再按聊天 ID 调用客户端对应侧栏链接。链接需能在当前账号的客户端侧栏定位。[Antigravity 日志路径](https://antigravity.google/docs/hooks)
