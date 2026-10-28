# 水滴设置面板验收

状态：Verified。2026-10-28 用户确认水滴样式可以，并确认新版入口打开的统计页正常。

## 设计对照

- 按批准图右上角实施：两个主要水滴操作同排；详情和退出采用小水滴。
- CODEX / ZCODE / 轮播位置及 ZCode 套餐逻辑保留。
- 版本来自 package.json，常显并与保存状态共存。
- 不加入效果图中额外标题栏、重复轮播和窄条内新增操作。
- 实际面板保持原高度；按紧凑尺寸重新分配按钮行空间。

## 证据

基线：8938946；本次修改 SettingsDock.tsx、SettingsDock.css、droplet-surface.svg、SettingsDock.test.tsx。
Windows 原生 Tauri release + WebView2，使用独立临时配置和 app-server 测试夹具。
`npm test`：15 个文件，187 项通过；`npm run tauri:build`：通过。
原生 exe SHA256：20C413BBB16E3863A0F2E33F03966529078892C9D2B561614ED88C4D75A4FE45。

真实窗口操作：右键打开、收起窄条、窄条右键打开、详情展开、版本与已保存共存、详情悬停保留水滴、退出结束进程。
保存失败复现：仅在隔离配置中，将 display-preferences.json 暂存，以同名目录阻止原子替换；切换减少动效得到 CRV-304，版本仍在；恢复配置文件并点重试后保存成功。
测试结束后已恢复原桌面 QuoDex.lnk。

截图保留于本机可视化目录（含桌面背景，不纳入 Git）：
C:/Users/bandit/.codex/visualizations/2026/10/28/01a18033-4bf2-7f30-95e6-65dbcbeefa7e/
- quodex-droplet-third-saved.png
- quodex-droplet-third-narrow.png
- quodex-droplet-fourth-hover.png
- quodex-droplet-fourth-failure.png

## 打包与最终验收

验收包 `release/QuoDex-0.4.5-bca8f76-local-win-x64/QuoDex.exe` 已启动：独立 QuoDex 配置、正常 Codex 状态目录，真实额度与任务数据可见。包内 exe 哈希与上述构建一致。
浏览器自动检查曾因 URL 识别及最小化受限；最终由用户恢复窗口并确认“已恢复，统计页正常”。此项证据为用户实际验收，不声称自动浏览器验证成功。
用户已确认原生水滴样式符合方向。隔离测试进程已关闭，原桌面快捷方式已恢复；保留原有运行实例和新版验收包，不替换旧安装。
本包为本地 Windows 验收产物，依赖系统 WebView2；未验证 macOS。没有推送或创建远程 PR。
