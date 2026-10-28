# B「流光水膜」验收记录

状态：Verified。用户于 2026-10-28 确认“通过”，并授权以补丁形式发布到远端 v0.4.8。

来源：`6087bc24eafb699312a9e7dcdda66fadb7b39a5c` 上的本次材质改动，应用版本仍为 0.4.8。本地预览不替换已发布的 v0.4.8。

产物：`release/QuoDex-waterfilm-preview/QuoDex.exe`，SHA256 `4B7A93308B0BE3409910782EA3D8EA992FC699AB418DE619260DF528FD184BB0`。

环境：Windows，PowerShell 7.6.5，Tauri release + WebView2；独立配置目录、Codex app-server fixture。原始桌面快捷方式已恢复。

## 与批准图逐项对比

批准方向为 [三方案图](approved-abc.png) 中间的 B，按钮生成偏差不纳入实现。

| 要求 | 真实结果与证据 |
| --- | --- |
| 透明底材，背景颜色穿透 | [彩色背景](waterfilm-color-native.png)：背景斜向色带穿过面板；旧底材 96–97% 不透明，现底材渐变 13–46% 不透明（叠层后的总透明度因位置不同） |
| 有厚度的亮边与局部水纹 | [深色背景](waterfilm-dark-native.png)：双层亮边、内侧暗缘、上下局部水纹可见；不是统一描边 |
| 浅背景可读，版本号常显 | [浅色背景](waterfilm-light-native.png)：文字、滑块值和 v0.4.8 可见；复杂背景仍可能干扰小字号阅读 |
| 保持既有按钮及布局 | SettingsDock.tsx、droplet-surface.svg 未修改；Codex／ZCode／轮播与操作位置不变 |
| 窄条与展开详情 | [窄条](waterfilm-narrow-native.png)、[详情](waterfilm-details-native.png)、[ZCode 诊断](waterfilm-zcode-native.png)：外壳随既有预算伸展，无新增裁切 |
| 缓慢反光，尊重减少动效 | 上下水纹层 9 秒交替，仅 opacity/transform 动画；应用与系统减少动效均禁用动画。原生截图同一区域 x28..231、y262..283 共 4488 像素，普通模式两帧变化 3445 像素，减少动效后变化 0 像素（对应 motion/narrow、reduced-a/b 图片） |

## 可复现步骤与结果

1. `npm test`：15 个文件、188 项通过，见 [tests.txt](tests.txt)。后续只补充 CSS 装饰动效与 SVG，没有修改行为代码。
2. `npm run tauri:build -- --no-bundle`：最终构建通过，见 [build.txt](build.txt)。链接器仅打印创建导入库的信息警告。
3. 用独立 `CODEX_CREDITS_CONFIG_DIR`、`WEBVIEW2_USER_DATA_FOLDER` 和 `fixtures/app-server-fixture.mjs` 启动上述原生产物。右键展开设置，依次放在彩色、浅色、深色背景前，通过 CUA 截图。
4. 点击收起为窄条，再右键展开；开启减少动效；点击详情；切换 ZCode。截图和原生可访问性树均确认内容保留。

## 限制

- 是真实 alpha 背景透射与模拟边缘反光，不包含对桌面像素的真实光学位移折射。概念图的光学效果并非像素级复刻。
- 隔离 Codex fixture 未提供聊天任务连接，顶部显示连接异常；ZCode 诊断 CRV-522 为当前数据源状态。这些不作为业务数据链路通过的证据。
- 本轮验收范围是面板材质与受影响的显示状态；未重新验证统计浏览器、全部业务数据链路或 macOS。
- 用户已确认材质通过。补丁以 v0.4.8 的独立 Windows x64 ZIP 附件交付，保留原安装包和原标签。
