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

本次验证的发布 EXE SHA-256 为 `1AD7D9647528134C419B28F2D7C257AC88F106C7E515072A602E7C1DD5EBF367`。

Gemini Web 当前读取 Windows 上 Chrome 或 Edge 展开的聊天页。网页安装版本和已登录账号中的真实状态需实机核对。Antigravity 从本机摘要库只读采集，未知字段显示未知。两入口目前缺少稳定的成功结束事件，Antigravity 列表暂通过标题在原应用的历史搜索里定位聊天。[Antigravity 搜索文档](https://antigravity.google/docs/search)
