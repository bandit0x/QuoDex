# 水滴设置面板验收

状态：Acceptance pending。2026-10-28 用户确认原生截图的水滴样式可以，继续交付验证。

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

## 尚未通过的检查

用量统计点击已触发 Chrome，但 Computer Use 无法可靠识别浏览器 URL，未确认页面加载；不能以派发成功代替网页验收。
隔离夹具不提供真实 Codex 任务，显示连接异常，不能据此证明真实任务连接正常。
最新本地打包产物仍需启动检查。以上完成前不标记目标完成。
