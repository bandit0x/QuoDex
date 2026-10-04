# 开发与构建

## 开发环境

- Node.js 24
- Rust MSVC 工具链
- Visual Studio C++ Build Tools
- Tauri 2 所需的 Windows 构建组件[^tauri-prerequisites]

在 PowerShell 中运行：

```powershell
npm.cmd ci
npm.cmd run tauri:dev
```

开发构建默认使用测试夹具。需要连接当前用户的真实 Codex 账号时：

```powershell
$env:CODEX_CREDITS_USE_LIVE = "1"
npm.cmd run tauri:dev
```

通过 `npm.cmd run tauri:dev` 启动并保持 Vite 服务运行。

界面截图可由确定性测试夹具复现：启动 `npm.cmd run dev` 后访问 `http://localhost:1420/?fixture=v7-healthy`（另有 `v7-expanded`、`v7-collapsed`、`v7-loading`、`v7-route-blocked`、`zcode-healthy`、`zcode-failed`、`zcode-carousel`）。

## 运行检查

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri\Cargo.toml
```

## 构建便携包

先下载并验证 Microsoft WebView2 Fixed Version Runtime：

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts\fetch-webview2-fixed-runtime.ps1
```

然后构建应用并生成便携目录：

```powershell
pwsh.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts\package-portable.ps1
pwsh.exe -NoProfile -ExecutionPolicy Bypass `
  -File scripts\verify-portable-brand.ps1
```

输出位于 `release/QuoDex-<版本>-win-x64/`，目录结构为 `QuoDex.exe` + `codex-runtime/` + `webview2-runtime/`。请将整个目录压缩后作为 GitHub Release 附件发布，不要把运行时或构建产物提交进源码仓库。

## 构建安装包

完成 WebView2 Fixed Version Runtime 下载后运行：

```powershell
npm.cmd run package:installer
```

输出位于 `release/QuoDex-<版本>-win-x64-setup.exe`。安装器会内置 Codex 与 WebView2 运行时，并在桌面创建或替换 `QuoDex` 快捷方式。

## macOS 构建

macOS 11+（Intel 或 Apple Silicon），需要 Node.js 24、Rust 工具链和 Xcode Command Line Tools：

```bash
npm ci
npm run tauri:dev        # 开发模式
npm run package:app      # 构建 .app / .dmg
```

输出位于 `release/macos/QuoDex.app`。打包脚本会把 `@openai/codex` 的平台原生二进制捆绑进 `QuoDex.app/Contents/MacOS/codex-runtime/bin/`（对齐 Windows 便携包；未安装 npm 依赖时跳过并告警）。安装后的应用按「捆绑的 codex-runtime → PATH → ChatGPT.app / Codex.app 内嵌 CLI → Homebrew 等常见安装位置」定位 Codex，与桌面版共享 `~/.codex` 登录态。脚本在运行时注入后重签 `.app` 并重建 DMG，因此正式 DMG 也包含捆绑运行时。开发构建默认使用测试夹具，连接真实 Codex 账号时设置 `CODEX_CREDITS_USE_LIVE=1`。macOS 版应用不进 Dock，只驻留菜单栏图标；关闭浮窗后通过菜单栏图标重新显示或退出。TomatoCloud 监测需要本机运行 TomatoCloud 客户端并启用系统 HTTPS 代理，否则面板会显示阻塞状态。

## 环境变量覆盖

用于上游改名、端点迁移或私有部署场景，无需重新构建即可修正探测目标。注意 macOS 图形界面启动的应用读不到 shell 的 `export`，需用 `launchctl setenv <变量> <值>` 设置后重启应用；Windows 用系统环境变量。

| 变量 | 作用 |
| --- | --- |
| `CODEX_CREDITS_USE_LIVE=1` | 开发构建连接真实 Codex（默认使用测试夹具） |
| `CODEX_CREDITS_APP_SERVER_EXECUTABLE` | 指定 Codex 可执行文件，可配 `CODEX_CREDITS_APP_SERVER_ARGS`（JSON 数组） |
| `CODEX_CREDITS_ZCODE_CONFIG_DIR` | 指定 ZCode 配置目录（默认探测 `~/.zcode/v2`，回退 `~/.zcode`） |
| `ZCODE_BIGMODEL_USAGE_API_KEY` / `BIGMODEL_USAGE_API_KEY` | 覆盖 ZCode 配额 API Key |
| `ZCODE_BIGMODEL_USAGE_QUOTA_URL` / `BIGMODEL_USAGE_QUOTA_URL` | 覆盖 ZCode 配额完整 URL |
| `CODEX_CREDITS_COUNTRY_ENDPOINT` | 覆盖 TomatoCloud 国家探测端点（默认 `https://api.country.is/`） |
| `CODEX_CREDITS_HEALTH_ENDPOINT` | 覆盖 TomatoCloud 连通性探测端点（默认 `https://www.gstatic.com/generate_204`） |
| `CODEX_CREDITS_TOMATO_PROCESSES` | 覆盖 TomatoCloud 必需进程名单（逗号分隔，覆盖平台默认值） |
| `CODEX_CREDITS_CONFIG_DIR` | 面板偏好存储目录 |

另外，ZCode provider 的 `options.quotaURL`（`~/.zcode/v2/config.json`）可完整指定配额接口地址，优先级低于上面的配额 URL 环境变量。

## 技术组成

| 层 | 技术 | 职责 |
| --- | --- | --- |
| 桌面外壳 | Tauri 2、Rust | 窗口、托盘、进程生命周期和 JSON-RPC |
| 用户界面 | React 19、TypeScript、Vite | 配额状态、交互、设置和错误恢复 |
| 材质与动效 | WebGL2、GLSL | 光学舱体、体积液体、折射和惯性反馈 |
| 配额数据 | `@openai/codex` | 本机 `app-server` 和账号配额接口 |
| 渲染运行时 | Microsoft Edge WebView2 | Windows WebView 渲染 |

## 参与贡献

问题报告请包含系统版本、复现步骤和诊断码，请勿公开上传令牌、账号截图或包含真实任务内容的日志。提交代码前运行上面的检查；界面变更附真实 Tauri 截图。

## 致谢

- [OpenAI Codex](https://github.com/openai/codex)：本机运行时和 `app-server` 协议
- [Tauri](https://github.com/tauri-apps/tauri)：跨平台桌面外壳
- [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)：流体运动参考
- [Canvas UI](https://github.com/DavidHDev/canvas-ui)：光学玻璃材质参考

[^tauri-prerequisites]: [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows)。
