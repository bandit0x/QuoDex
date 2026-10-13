# QDS-112 与 6 小时周期修订验证

2026-10-13，来源基线 `5534afd`，修订源码由本目录所属提交标识。环境 Windows 11 / PowerShell 7.6.5 / Node 24.18.0；产物 `src-tauri/target/debug/codex-credits-view.exe`，SHA256 及原生检查见 [report.json](report.json)。当前交付状态只维护在 [remote-record](../../../research/remote-record/README.md)。

用户报告下载 QDS-112，旧界面未显示主机名。本次没有读取系统中的真实凭据或访问用户网盘。重现的是已知 `qdbh-cu01.baidupcs.com` CDN 被旧 allowlist 拒绝：`cargo test --manifest-path src-tauri/Cargo.toml --lib accepts_baidu_download_cdn` 修复前 0 通过 / 1 失败，输出 `Baidu download CDN incorrectly triggers QDS-112`，修复后通过。这个重现不能证明用户那一次请求恰好使用同一主机。

来源：[百度下载文档](https://pan.baidu.com/union/doc/基础网盘服务/下载/)规定使用 filemetas 返回的 dlink，实际域名随返回值；[百度开发者社区原始问题](https://cloud.baidu.com/ask/8667)记录 d.pcs.baidu.com 重定向至 qdbh-cu01.baidupcs.com。后者是开发者现场报告，不是百度对永久域名集合的保证。本机查证候选顺序为：初始链接使用 CDN、重定向使用 CDN、其他主机或非 HTTPS 被拒绝。

修订允许 HTTPS baidupcs.com 及严格点分隔子域用于下载，上传仍限定 PCS 原范围。所有重定向逐跳验证，保持拒绝 HTTP、伪造后缀、用户信息、非默认端口；未知地址只输出主机名，不输出路径、查询参数、用户信息或 fragment。由于缺少用户原始主机，原现场实网恢复仍待使用新版复测，不声称该故障已经实网消失。

自动同步统一在每轮结束后等待 21,600 秒，适用于成功、积压和瞬时失败；启动/首次授权会立即运行一次，手动同步可立即唤醒。授权轮询仍按百度要求执行，它不是账本同步周期。鉴权/协议/不可信域名等暂停错误仍需处理；本机用量采集和网页刷新频率不变。没有进行实际等待 6 小时的长期运行试验，周期由生产代码中的共用调度点核查。

复现：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib baidu_sync
cargo test --manifest-path src-tauri/Cargo.toml --lib sync_runtime
npm test -- --run src/SyncSettings.test.tsx
npm run tauri -- build --debug --no-bundle
$env:QUODEX_QA_OUTPUT='docs/verification/remote-record/qds112-six-hour'
node scripts/verify-remote-record.mjs
```

实际结果：adapter 5 项、runtime 5 项、连接组件 3 项通过；构建通过；隔离合成来源原生冒烟 7 项通过、浏览器错误 0。命令日志位于本机忽略目录 `.scratch/remote-record/qds112-*.log`。未重复运行全仓测试，原始全仓结果属于前一版本。

本次唯一 UI 变更是折叠帮助中的同步周期说明，没有改布局；真实 Tauri 截图 [connection-schedule-native.png](connection-schedule-native.png) 已滚动到新增说明并检查文字可见。其余五张同目录截图由同次产物生成。首次捕获说明在视口以下，修正截图脚本滚动后重新捕获；没有据此修改产品样式。

权限核对：[百度权限与配额](https://pan.baidu.com/union/doc/使用入门/权限与配额/)说明默认目录通常为 `/apps/<appname>/`，额外目录取决于用户另行授权与接口权限。源码实际只列表 `/apps/<appname>/QuoDex/`，读取固定空间入口和同步批次，创建该目录及批次；无其他目录遍历、删除、移动、分享和用户资料查询。`basic,netdisk` 不能解释为仅对几个 token 文件的授权。撤销百度端授权与 QuoDex 本机断开是不同操作；本机断开会停用同步、删除本机凭据、保留账目。
