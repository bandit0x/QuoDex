# v0.4.5 本地版本验证

日期：2026-10-13（Asia/Shanghai）。源码以仓库 `v0.4.5` 标签为准，Git 署名及 GitHub 登录身份均为 bandit0x。将当前 main 的 CI/Windows 验证更新合入 remote-record，保留本地点击穿透检查和远端背景启动诊断；冲突仅发生在验证脚本，已用 `node --check` 检查最终语法。

六个版本位置一致为 0.4.5：package.json、package-lock.json 根与根 package、Tauri 配置、Cargo manifest 与 Cargo.lock 根 crate。更新日志见 [CHANGELOG](../../../CHANGELOG.md)。

| 检查 | 本次实际结果 |
| --- | --- |
| npm run typecheck | 通过 |
| npm test | 14 文件、175 项通过 |
| npm run test:native-fixtures | 2 项通过 |
| cargo test --locked --manifest-path src-tauri/Cargo.toml --lib | 159 项通过、5 项按真实账号/桌面环境要求忽略 |
| cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings | 通过 |
| npm run tauri -- build --debug --no-bundle | Windows debug 构建通过 |
| scripts/verify-remote-record.mjs | 隔离来源真实产物 7 项通过、浏览器错误 0 |

环境 Windows 11、PowerShell 7.6.5、Node 24.18.0、Rust 1.97.1。构建产物 `src-tauri/target/debug/codex-credits-view.exe`，SHA256 见 [report.json](report.json)。命令日志在本机忽略目录 `.scratch/remote-record/v045-*.log`；最终原生截图在本目录。

严格 Clippy 初次发现默认结构字段重赋值与测试服务读字节数未检查，已按生产语义修正后通过；随后重跑 Rust 测试和原生构建/冒烟。没有降低 CI 检查要求。

本版本配置 Windows/macOS CI 测试与标签打包；本地没有执行 macOS 构建或安装器验证，推送标签后由 GitHub Actions 执行。标签推送不会自动创建 GitHub Release，现有 CI 只保存打包 artifact。当前用户请求是版本号、分支和标签推送，没有把待验证 artifact 宣称为可下载发行版。

此次原生报告只覆盖合成数据 UI 检查；其网盘未测试备注只指这一套 UI 测试范围。已经另行完成的真实百度单机往返见 [实网报告](../remote-record/live-baidu/README.md)。双 PC、token 刷新及实际六小时等待仍待验证，当前整体状态见 [唯一入口](../../research/remote-record/README.md)。
