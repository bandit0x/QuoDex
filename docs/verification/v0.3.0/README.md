# v0.3.0 发布验证

状态：Implemented。本地发布验证为 Verified；双平台 CI 打包与 Release 尚在执行，首页新增 Pro 图待推送后复核。

来源：应用发布提交 4ff14fd（v0.3.0 标签），UI 基线 7248615；package.json、Tauri 和 Cargo 均为 0.3.0。环境：macOS 27.0.1 / 26A434、Apple Silicon arm64、Node 24.21.0、npm 11、Rust 1.98.1、Tauri WKWebView。

## 本地验证

| 检查 | 状态 | 实际结果 |
| --- | --- | --- |
| 前端测试 | Verified | 10 文件、108 项通过。[日志](frontend-test.txt) |
| 类型检查 | Verified | tsc --noEmit 通过。[日志](typecheck.txt) |
| Rust 完整测试 | Verified | 95 项通过，0 失败，5 项依赖真实账号/桌面进程的集成测试未执行。[日志](rust-test.txt) |
| 生产构建与打包 | Verified | Vite、Rust release、App、捆绑 Codex runtime、DMG 成功。[日志](package-build.txt) |
| App 签名 | Verified | codesign --verify --deep --strict 返回 0。ad-hoc 签名，未经公证。 |
| DMG 完整性 | Verified | hdiutil verify 校验成功。[日志](dmg-verify.txt) |
| 原生启动与操作 | Verified | 干净临时目录中启动最终 App；两组各五项、来源切换、ZCode 重置卡展开、设置打开关闭和窄条可操作。 |
| 文档与版本 | Verified | README 74 行；本地链接及图片格式检查通过；五个版本文件与原生 Info.plist 均为 0.3.0。[产物与图片指纹](artifact-proof.json) |

Rust 首次在受限沙箱中于 UnixListener::bind 返回 Operation not permitted；在允许本机 socket 的环境重跑通过。未修改代码或将错误吞掉。

已将 /Applications/QuoDex.app 更新为 0.3.0，签名核验和二进制指纹一致；启动显示真实额度及两组任务，仅保存布尔检查，不保存真实任务内容。[安装与冒烟检查](installed-smoke.json)

本地构建产物：release/macos/QuoDex.app、release/macos/QuoDex_0.3.0_aarch64.dmg。

## 截图与要求对照

五张图均来自本次最终原生 App；没有使用静态 HTML、组件预览或历史图片。仅将截图工具返回的 JPEG 无损转存为 PNG，不裁切、不重绘、不改尺寸。

QA 副本仅更换 bundle 标识、匿名环境变量并重签，版本为 0.3.0。复制两份可执行文件并去除签名后 SHA-256 相同，证明运行代码相同；原始生产包未改动。[可执行文件身份核对](native-identity.json)

| 批准的画面 | 实际结果 | 原生图 |
| --- | --- | --- |
| 主界面，两组各五任务 | Codex、ZCode 各五个实际状态；任务条与额度仓分离，运行/等待/成功/报错可辨。600×350 物理像素。 | [主界面](../../screenshots/v0.3.0/main.png) |
| ZCode | 月光银双仓，5 小时卡 6 张、周卡 5 张及最近到期时间可见。600×408。 | [ZCode](../../screenshots/v0.3.0/zcode.png) |
| 设置 | 三个来源透镜与中性底舱分离，高光、厚壁回光和控制项可见，无左右蓝绿分色。600×532。 | [设置](../../screenshots/v0.3.0/settings.png) |
| Codex Pro 单舱 | 全宽 WEEK 单舱，薄荷绿液体，无 5 HOUR 仓；两组仍各五任务。600×350。 | [Codex Pro](../../screenshots/v0.3.0/codex-pro.png) |
| 窄条 | 260px 逻辑宽度，两组仍各显示五项。520×184。 | [窄条](../../screenshots/v0.3.0/narrow.png) |

首页标题为“主要功能”；额度截图直接标记 Codex、ZCode、Codex Pro，另保留设置与窄条。Codex Pro 使用已有 pro-weekly 协议夹具，原生单舱与匿名任务检查见 [Pro 检查](pro-check.json)。

所有任务名称、配额及重置卡来自匿名夹具。TomatoCloud 连接灯来自本机系统代理的实际公开端点探测，不作为匿名额度协议夹具的一部分。没有拍摄真实聊天或账号额度。

## 复现步骤

```bash
npm run typecheck
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run package:app
codesign --verify --deep --strict release/macos/QuoDex.app
hdiutil verify release/macos/QuoDex_0.3.0_aarch64.dmg
python3 fixtures/task-capsules-macos.py --launch-services --tasks-per-source 5 --output .scratch/release-v0.3.0/native --y 400
```

通过 native-ready.json 返回的独立 QA App 进行原生操作：主界面截图；右键打开设置选 ZCode，关闭并展开重置详情；收起详情再打开设置；关闭设置，展开后选“收起为窄条”。结束退出 QA App。Pro 单舱使用同一命令追加 `--codex-scenario pro-weekly`，输出目录改为 `.scratch/release-v0.3.0/native-pro`。

## 远程发布

main 和 v0.3.0 标签已推送，标签指向 4ff14fd；About 已更新。双平台测试通过，安装包生成与自动 Release 仍在执行。首页五图补充待推送后复核。[本次发布 CI](https://github.com/bandit0x/QuoDex/actions/runs/37212796417)、[v0.3.0 Release](https://github.com/bandit0x/QuoDex/releases/tag/v0.3.0)。

## 已知限制

Windows 本次以 CI 测试和打包为验证边界，不等同于手动安装运行。5 项真实账号/桌面集成测试未在本次套件中执行；匿名原生启动不代替这些协议测试。macOS 为 ad-hoc 签名，未经公证。明暗及纹理背景下的玻璃透射仍缺少可靠截图，沿用此前限制。
