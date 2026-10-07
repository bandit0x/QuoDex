<div align="center">

<img src="src-tauri/icons/icon.png" width="80" alt="QuoDex 图标">

# QuoDex

用一个液态玻璃浮窗，查看 **Codex / ZCode** 的剩余额度、重置时间和任务状态。

**简体中文** · [English](README.en.md)

[![Release](https://img.shields.io/github/v/release/bandit0x/QuoDex)](https://github.com/bandit0x/QuoDex/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%2011%20%7C%20macOS-blue)]
[![Downloads](https://img.shields.io/github/downloads/bandit0x/QuoDex/total)](https://github.com/bandit0x/QuoDex/releases/latest)
[![License](https://img.shields.io/github/license/bandit0x/QuoDex)](LICENSE)

</div>

QuoDex 常驻桌面角落，不用切窗口就能确认 Codex / ZCode 还剩多少额度、任务跑到哪一步；token 用量账本在本机长期留存，来源应用清理历史不影响已入账数据。

## 功能亮点

- **额度与重置** — 5 小时、周额度或单池套餐，Codex / ZCode 切换与轮播，可用重置次数一目了然。
- **两组任务** — Codex 与 ZCode 同屏各显示 5 项，运行 / 等待 / 成功 / 报错分色区分，完成提醒一键移除。
- **液态玻璃** — 液面随余额涨落，拖动自然晃动；紧凑、展开、窄条三种视图，透明度可调。
- **用量统计** — 设置面板一键打开本机网页：7 天到 1 年六区间、合并 / 分开视图、月度热力墙与趋势图，本地账本长期留存。

## 界面

<table>
  <tr>
    <th>Codex 浮窗</th>
    <th>用量统计 · 本机网页</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/v0.3.0/main.png" width="420" alt="Codex 浮窗"></td>
    <td align="center"><img src="docs/verification/usage-liquid-glass/page-desktop-3m-hover.png" width="420" alt="用量统计热力墙"></td>
  </tr>
</table>

<details>
<summary>更多截图：ZCode · Codex Pro · 设置 · 窄条 · 窄屏</summary>

<table>
  <tr>
    <th>ZCode</th>
    <th>Codex Pro 单舱</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/v0.3.0/zcode.png" width="240" alt="ZCode"></td>
    <td align="center"><img src="docs/screenshots/v0.3.0/codex-pro.png" width="240" alt="Codex Pro 单舱"></td>
  </tr>
  <tr>
    <th>设置</th>
    <th>窄条</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/v0.3.0/settings.png" width="240" alt="设置"></td>
    <td align="center"><img src="docs/screenshots/v0.3.0/narrow.png" width="240" alt="窄条"></td>
  </tr>
</table>

<p align="center"><img src="docs/verification/usage-liquid-glass/page-390-full.png" width="180" alt="用量统计窄屏"></p>

浮窗截图来自 v0.3.0 原生 macOS App，额度和任务均为匿名演示数据；用量页截图来自匿名夹具数据。[截图来源](docs/verification/v0.3.0/README.md) · [用量页验证](docs/verification/usage-liquid-glass/)

</details>

## 开始使用

1. 从 [Releases](https://github.com/bandit0x/QuoDex/releases/latest) 下载对应系统的安装包：Windows 使用 `.exe`，macOS 使用 `.dmg` 并将 App 拖入 Applications。
2. 确保所需的 Codex / ZCode 已登录，启动 QuoDex 后选择额度来源。
3. 拖动浮窗调整位置，点击右下角箭头展开；右键主仓打开设置。

关闭浮窗会隐藏到托盘或菜单栏；完全退出使用“退出”。

> macOS 发布包采用 ad-hoc 签名，尚未公证；自动发布当前提供 Apple Silicon 包，Intel 可[从源码构建](docs/DEVELOPMENT.md#macos-构建)。

## 文档与支持

- [使用说明与数据隐私](docs/USAGE.md)
- [开发、构建与配置](docs/DEVELOPMENT.md)
- [更新日志](CHANGELOG.md)
- [问题反馈](https://github.com/bandit0x/QuoDex/issues)

QuoDex 是非官方社区项目，与 OpenAI 或 Bigmodel 无隶属或背书关系。源码采用 [MIT License](LICENSE)，第三方组件遵循[各自许可证](THIRD_PARTY_NOTICES.md)。
