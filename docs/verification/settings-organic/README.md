# 自由液态设置面板 v0.4.8 验证

状态：Acceptance pending。用户已批准不对称外框设计，最终实物待用户验收。

环境：Windows 11、Tauri release、WebView2；隔离临时配置及 app-server 夹具。额度数字来自夹具，任务连接异常为夹具限制。

- `npm test`：15 个文件、188 项通过。
- `npm run tauri:build -- --no-bundle`：通过。
- v0.4.8 本地验收包启动，右键打开显示设置，确认版本号、来源、透明度、操作和外框显示；后续常规配置启动亦出现窗口。
- 前一构建的相同界面已检查标准和窄条、详情、透明度保存及隔离配置故障 CRV-304 与重试恢复。对照批准图：凹弧上缘、收腰侧边、波浪底缘、四个水滴操作；轮播文字和版本常显。
- 截图存于用户本机可视化目录：quodex-048-native.png、quodex-organic-narrow.png、quodex-organic-details-failure.png；含桌面背景，不纳入仓库。
- 本地验收包依赖系统 WebView2，并非固定运行时安装包；未验证 macOS。浏览器统计页本次未能读取，上一轮用户确认统计页正常。
- 验收包 QuoDex.exe SHA-256：E38A90FB0875480A2A3CA77F814C85B9D62929BE78D4C02B1D43025EF7483A6E。
