# 单机百度实网测试证据

测试时间：2026-10-13 15:27（Asia/Shanghai）。产品基础版本 `d5b128a8a68a02b83b529f9f85a622575439e73a` / QuoDex 0.4.2；测试代码由本目录所属提交标识。当前整体状态只在 [remote-record 入口](../../../research/remote-record/README.md) 维护。

环境 Windows 11、PowerShell 7.6.5、Rust 1.97.1。用户已在 QuoDex 完成百度连接并授权测试，随后明确选择“只测试 QuoDex 同步目录”。测试复用 `BaiduStore`、`sync_engine` 和本机账本，没有换成 fake HTTP，也没有接入照片接口。

## 实际结果

[report.json](report.json) 记录 8 个实网检查点：读取本机已授权凭据且不输出秘密；列举应用子目录；下载并解析固定账本入口；上传独立匿名测试文件；下载内容与原字节一致；连续两轮同步完成且合计不变；原始本机账目条数不变；真实远端批次重复导入两次不重计。整条 ignored 测试明确运行后 1 通过、0 失败，用时 12.56 秒。QDS-112 没有复现，没有其他诊断。

正常上传链实际完成 precreate → locateupload → superfile2 → create，新文件 `rtype=0` 得到预期路径/大小/文件 ID。下载来自真实 dlink，经过生产域名检查和重定向处理。此次成功只证明本机账号/应用/当前文件/当时的服务响应，不证明同名竞争、所有 CDN、限流、长期运行或两台 PC 授权互不失效。

副作用：在 `/apps/<应用名>/QuoDex/` 保留一份很小的 `qa-UUID.json` 合成标记。名称不匹配账本批次格式，不进入 token 合计；未添加虚构用量请求，未删除或覆盖已有网盘文件。测试未调用来源扫描，不打开聊天正文。凭据只在 Rust 内存中使用，没有放进命令参数、报告或源码。

## 复现

关闭其他同配置 QuoDex 进程以减少并行测试干扰。以下命令只指定配置和报告位置，不传递密钥；再次执行会新增一份匿名标记文件并完成两轮正常同步。

```powershell
$env:QUODEX_LIVE_CONFIG = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'io.github.bandit.codexmeter'
$env:QUODEX_LIVE_REPORT = Join-Path (Get-Location) 'docs/verification/remote-record/live-baidu/report.json'
$env:QUODEX_LIVE_SOURCE = (git rev-parse HEAD).Trim()
cargo test --manifest-path src-tauri/Cargo.toml --lib live_baidu_sync_round_trip -- --ignored
```

测试默认 ignored，普通 cargo test 不会读取网盘授权或进行实际传输；要求显式设置配置和输出位置。凭据临近过期或刷新意图未完成时停止，交回原生应用处理，不在 QA 中盲目花费单次 refresh token。

本次还执行 `npm run tauri -- build --debug --no-bundle`，构建成功；运行 `scripts/verify-remote-record.mjs` 隔离原生冒烟，7 项通过、浏览器错误 0，结果见 [native-smoke.json](native-smoke.json)。这是额外的本地 UI 检查，报告内未验证百度的限制只指该 UI 测试范围，实网结果以 report.json 为准。产物为 `src-tauri/target/debug/codex-credits-view.exe`，SHA256 见 native-smoke.json；命令日志与本次无界面改动的重复截图仅留在本机忽略目录 `.scratch/remote-record/`。

本次没有进行 token 刷新、等待 6 小时、macOS 或双物理 PC 验证。照片/其他目录未访问，其授权和缩略图接口可用性仍未测试。
