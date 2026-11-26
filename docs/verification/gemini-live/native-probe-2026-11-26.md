# Windows 原生额度探针验收 · 2026-11-26

环境为 Windows 11、Antigravity Desktop 2.35.1、已登录的真实账号。QuoDex 0.4.15 源码为 2feb51e。

1. 保持 Antigravity 在聊天页。以干净配置启动发布 EXE，读取四项 AG 额度。发送一次仅回复 OK 的消息，原生入口观测到 Gemini 五小时由 100% 降至 99.78512%，周余额由 72.46912% 降至 72.4154%。Claude/GPT 保持 100% / 50%。
2. 打开官方 Models 对照，刷新后 Gemini 显示 99% / 71%，Claude/GPT 显示 100% / 50%。后台独立请求也返回过 98.99333% / 71.467453%。两条路径的账号一致，未记录账号标识。
3. 关闭 Models，安装并启动本轮安装包。00:12:18 读到 Gemini 99% / 71.5%，00:14:18 自动采样又显示 99.8% / 72.4%。同一官方运行时连续请求可复现两组原始数值。补传 project 或等待启动数秒均未消除差异。后台自动取数通过，稳定对齐官方面板仍未通过。[安装版截图](native-installed-2026-11-26.png)

构建、NSIS 打包和启动冒烟通过，前端 211 项通过，Rust 186 项通过、6 项默认忽略。真实账号用例另行执行并通过：

    cargo test --manifest-path src-tauri/Cargo.toml desktop_reads_real_quota_without_models_panel -- --ignored --nocapture

安装包为 release/QuoDex-0.4.15-win-x64-setup.exe，SHA-256 为 774886DB07C951FB5A0086EEE23CDED0C7854881DF78EA1700CB8A028EC5BEA2。安装后 EXE SHA-256 为 F723EC9164DEA5EF26553D7CE09202ED2CF57F71BE20F476B0996F0C6297C234。

Web 会话未连接（QGM-211）。未退出用户的 Antigravity，桌面完全退出后的读数与点击任务返回原聊天未验收。
