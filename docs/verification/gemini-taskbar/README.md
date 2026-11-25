# Agent 任务圆环 · Windows 验证

## 可见圆环水平居中

2026-11-25，在 Windows 11、96 DPI 下验证源码 `ceed911` 的 QuoDex 0.4.12。发布程序的 SHA-256 为 `D77EA28F47093258EEC349E56CF57076C35A82591707EEDA4C277F9251DD01DA`。原生验收以窗口左右边缘到首尾按钮外缘的距离为准。

| 窗口 | 三环总宽 | 左右留白 | 实拍 |
| --- | --- | --- | --- |
| 标准浮窗，300 px | 96 px | 各 102 px | [标准浮窗](centered/standard.png) · [Gemini 双舷窗](centered/gemini-window.png) |
| 窄条，260 px | 84 px | 各 88 px | [窄条](centered/narrow.png) |

Chrome 组件复验覆盖一至三个可见 Agent 的全部七种组合，以及上述两种尺寸、两种布局和 DPR 1、2。圆环间距为 4.5 px。指针进入圆环时命中对应按钮，移到首尾外侧 2 px 即离开任务栏。104 组同坐标截图和 720 个材质样本与透明环心批准稿逐像素一致。可用下节的原生与像素复验脚本重现结果。发布构建和 208 项前端测试均通过。

## 透明环心与双水纹

2026-11-25，在 Windows 11 build 26200、96 DPI、WebView2 158.0.4370.33 上启动 QuoDex 0.4.12 发布程序。正式浮窗源码为 `69ca561`，透明环心批准稿为 `4d69120`。EXE 的 SHA-256 为 `9853D2296D4EA5FD3E1372E67ACAE81CFEA40875A2A2F6330733DADD5BD2D418`。[批准稿](../../design/gemini-taskbar/v0410-reference/overview.png) · [两种尺寸的同条件对照](water-rings/design-comparison.png)

| 验收场景 | 发布程序的实测结果 |
| --- | --- |
| 透明环心 | 更换浅色和深色桌面后，白色 Codex、黑色 ZCode、蓝色 Gemini 环心的空白处均透出相应底色。[浅色桌面](water-rings/standard-light.png) · [深色桌面](water-rings/standard-dark.png) |
| 同时运行和报错 | 连续截取 32 帧，Gemini 环缘的水纹每帧都变化，中心叹号固定。同一画面里的另外两个静态环逐像素不动。[原生动效实录](water-rings/motion.webp) |
| 停止运行 | 最后一个运行任务进入等待后，环缘恢复固定的左上宽反光。清除报错后，中心切换为等待双竖线。[静态报错](water-rings/static-error.png) · [静态等待](water-rings/static-waiting.png) |
| 标准、窄条与悬停 | 标准、窄条的环径分别为 29 和 25 个逻辑像素，近期完成环可读到勾与分钟数。悬停 Gemini 展开对应聊天，移开后收起。[Gemini 双舷窗](water-rings/gemini-window.png) · [窄条](water-rings/narrow.png) · [悬停](water-rings/origins.png) |
| 减少动效 | 保留运行任务，启用「减少动效」后，间隔 450 毫秒截取的环图像完全一致。[减少动效](water-rings/reduced.png) |

将正式组件与批准稿置于相同的坐标和背景，在三个水纹采样时刻检查三种 Agent 的全部七种状态。普通浮窗与 Gemini 双舷窗、25 和 29 px、DPR 1 和 2 下，504 个材质样本的 RGBA 逐像素一致。48 张正式任务栏的整条截图和 8 张单独挂载的空闲材质截图也与批准稿逐像素一致，包含环缘、笔画、分钟数和阴影。运行 `node scripts/verify-task-ring-pixels.mjs` 可复验。Playwright 安装在独立目录时，将其 `index.mjs` 路径作为第一个参数传入。

复验使用独立配置和匿名聊天。前端运行 `npm.cmd run build` 和 `npm.cmd test`，206 项测试通过。Rust 运行 `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`，178 项通过，5 项原有用例标记为忽略。构建包含正式前端的 Windows EXE 后，在 PowerShell 7 将 `QUODEX_EXECUTABLE` 指向该程序，依次运行下列命令。截图默认写入 `.scratch/gemini-taskbar-native`。

```powershell
python scripts/verify-gemini-taskbar.py
python scripts/verify-gemini-taskbar.py --reduced-motion
python scripts/verify-gemini-taskbar.py --gemini-window
```

## 历史版本 · 旋转缺口环

2026-11-25，在 Windows 11 的 300 px 标准浮窗和 260 px 窄条上启动 QuoDex 发布程序，使用匿名任务验证。源码为 `b47c86b`，EXE 的 SHA-256 为 `72DFB331934E80627392B4490BBAAE81C2C69F7F901D170877540D109ECB92A7`。

- 调换桌面背景后，三个环内都能读到新的背景色。环线分别为 Codex 白色、ZCode 黑色、Gemini 蓝色。[浅色桌面](rings/standard-light.png) · [深色桌面](rings/standard-dark.png)
- 运行中的 Gemini 环只有一个缺口。逐帧取样时，缺口沿圆周移动，中心报错符号固定。最后一个运行任务转为等待后，圆环闭合。开启「减少动效」后，运行中的缺口固定，间隔 450 ms 两次取样的圆环图像一致。[运行实录](rings/motion.webp) · [闭合](rings/idle.png) · [减少动效](rings/reduced.png)
- 悬停 Gemini 展开三条聊天及来源，移开后收起。窄条的按钮为 25 px，ZCode 的完成标记和 Gemini 的报错标记均可见。[悬停](rings/origins.png) · [窄条](rings/narrow.png)

这一版的复验脚本保存在提交 `6f37616`。

## 历史方案 B · 瓷粉实心圆

2026-11-25 在 Windows 11 build 26200、96 DPI、WebView2 158.0.4370.33 下，使用独立配置和匿名聊天启动 QuoDex 0.4.12 的 Windows 发布 EXE。源码提交 `36f6e19`，EXE 的 SHA-256 为 `D4E1194C59A6850DFEE96EE8C81D7FCB59EC35147ED3FAF2B9B77E0E9139D9F4`。[已选 B 稿](../../design/gemini-taskbar/finishes/comparison.png)

| 对照项 | 桌面程序的实测结果 |
| --- | --- |
| 静置 | 三个圆面的主体颜色依次为 Codex 雾蓝 `#ABC8DC`、ZCode 鼠尾草绿 `#A5C6B0`、Gemini 藕紫 `#D0B7CC`，从真实截图取色与 B 稿一致。[静置](porcelain/idle.png) |
| 运行与启停 | 运行组的整面渐变每 3.5 秒旋转一圈。将匿名 Antigravity 聊天从运行改为等待，再恢复运行，圆面在两个方向都经过中间色。启停过渡 650 ms，中心 `!` 固定。连续采样检测到 Gemini 圆内有 571 个像素的任一 RGB 通道变化超过 4。[标准浮窗](porcelain/standard.png) · [启停实录](porcelain/motion.webp) |
| 窄条与悬停 | 300 px 标准浮窗和 260 px 窄条均容纳三圆。ZCode 的近期完成显示 `✔`。Gemini 同时有运行、等待和报错聊天，显示 `!`。指针进入 Gemini 时显示三条匿名聊天及来源，移开后收起。[窄条](porcelain/narrow.png) · [悬停](porcelain/origins.png) |
| 减少动效 | 在独立配置中启用减少动效并保留运行中的聊天。Gemini 显示藕紫纯色，间隔 450 ms 的两张原生截图中该圆区域内每个像素完全相同。[减少动效](porcelain/reduced.png) |

该版对应的复验脚本保存在提交 `cae6fdf`。

## 旧版 D 稿验证

此前的 D 稿使用左置棱镜。点棱镜打开跨来源的报错和等待，点光纤打开完整来源列表。Gemini 行合并 Web 与 Antigravity，详情逐项显示入口。Antigravity 按聊天 ID 归组，模型切换不增加任务位。一个入口不可用时，行尾出现问号，另一个入口已知的任务仍可展开。

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
