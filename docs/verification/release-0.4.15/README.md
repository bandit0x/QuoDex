# QuoDex 0.4.15 · Windows 发布验收

2026-11-25，Windows 11 x64，源码 `41004d4`。从同一源码打包 Gemini 厚玻璃双舷窗、居中任务环和 A 版可选额度轮播。NSIS 安装器将当前用户安装从 0.4.12 升级到 0.4.15，随包提供固定 WebView2 运行时。

- 安装包 SHA-256 `049D449087E3708423C2EFF5D3D74CC0AE227A2A52F7C76144BB83D73BA48DB9`
- 安装后 EXE SHA-256 `73AA563BAFFC559860EEC179DFBA5E273246E2E742540B833F74A74B91DA50A0`
- 209 项前端测试、178 项 Rust 测试及 2 项原生夹具测试通过。Rust 另有 5 项原有忽略用例。

| 场景 | 安装版观测 |
| --- | --- |
| Gemini 标准窗与窄条 | 两种尺寸均读取六项匿名额度，详情返回后读数、位置与尺寸恢复，该次返回前后的图像相同。[标准窗](ready-standard-actual.png) · [窄条](ready-narrow-actual.png) · [原生报告](gemini-report.json) |
| 视觉对照 | 标准窗相对移除周额度牌的效果图，平均 RGB 通道绝对差为 19.38／255；原图口径为 20.82／255。原脚本的零像素差门槛未达到。[对照指标](standard-channel-error.json) |
| Gemini 刷新 | 安装版从正常样例切换到两个 AG 五小时额度分别为 0% 和 100%，标准窗和窄条都读到了新值。旧交互稿的零像素差检查仍有差异。[刷新报告](refresh-report.json) |
| A 版轮播 | 在隔离配置中确认首次三项全选，取消 ZCode 后保存 Codex 和 Gemini，退出重启仍恢复勾选，260 px 下三个控件可见。10 秒轮播顺序由前端集成测试验证。[首次](carousel-enabled.png) · [保存](carousel-standard.png) · [重启](carousel-restarted.png) · [窄条](carousel-narrow.png) |
| 任务环与透明度 | 更新冒烟脚本后，安装版两次冷启动均能展开 Codex、ZCode 任务，等待和取消状态随轮询更新，设置可正常退出。透明度脚本的九个背板取样全部通过。[任务环报告](task-smoke.json) · [透明度取样](transparency-result.json) |

实机验收使用隔离配置和匿名夹具。重新构建时运行 `npm.cmd run package:installer` 并提供已签名的 x64 WebView2 固定运行时。Gemini 验收运行 `scripts/verify-gemini-twin.py` 的 `--optical-study` 与 `--repeat-extremes 1`，对标准窗再运行 `scripts/compare-gemini-standard-no-week.py`。
