# 底部液态玻璃设置控制带

历史证据：**Implemented**（已被否决的旧设置控制带）。下列检查只描述旧候选，不代表视觉通过或当前代码验证。用户后来批准 B 悬浮玻璃坞；当前状态只维护在 [设置坞验收记录](../settings-dock/README.md)。

历史来源版本：v0.2.5，基线 `5a817fa`，分支 `codex/task-source-capsules`。本记录对应当时未提交的候选；版本号维持 0.2.5。当时没有推送远端。

## 实现与批准图对照

[批准的六态设计图](approved-b-states.png)是虚构数据示意。下列 `native-*.png` 来自最终打包 Tauri App 的真实窗口，使用独立临时目录中的匿名任务、SQLite、IPC 与额度夹具；没有使用网页或组件预览代替原生验证。截图保持工具原始像素与内容。

| 批准状态 / 要求 | 原生结果与证据 |
| --- | --- |
| 首次展开，任务 → 额度 → 控制带 | [标准视图](native-compact.png)为 600×500 物理像素，即 300×250 logical px。控制带占 78px，加 6px 间隔，共增加 84px；三个区域没有覆盖。 |
| 液态玻璃材质 | 设置复用 `OpticalShell`，有高光、折射边缘、薄色层；`useTaskMaterial` 将设置区域纳入系统桌面毛玻璃遮罩，入场动画结束后更新最终边界。原生截图可见玻璃边缘与控件；单窗截图没有展示完整桌面，桌面背景透光的主观强度仍待用户现场确认。 |
| 透明度操作中，预览后保存 | [操作与保存](native-opacity.png)显示 94%，范围 86–100%、步进 2%；原生键盘修改后配置文件为 0.94。拖动过程中不落盘、松手保存以及串行写入由 `App.test.tsx` 的交互回归验证。 |
| 保存成功 | [重试成功](native-saved.png)显示标题旁勾号，错误行移除，窗口由 600×608 收敛为 600×560；最新成功提示停留约 1.6 秒。 |
| 保存失败，保留当前值与重试 | 将隔离配置文件设为只读后操作开关，[失败状态](native-save-failed.png)保留减少动效开启及当前透明度，显示 `无法保存本地显示偏好 · CRV-304` 与重试。窗口增加 48 物理像素，即 24 logical px。恢复写入权限并重试后错误消失且配置保存成功。 |
| Codex / 轮播无套餐行 | [Codex](native-codex.png)、[轮播](native-carousel.png)将第二行改为动效与退出，透明度滑条加长；均保持 600×500，没有因来源切换改变任务分区。 |
| 窄条保留额度条 | [窄条](native-narrow.png)为 520×336，即 260×168；包含 36px 任务区、48px 额度条与 84px 设置空间。字体和控件完整。 |
| Esc 关闭，恢复原布局与焦点 | [展开视图关闭后](native-closed.png)为 600×392，即 300×196；设置消失，焦点返回设置按钮。 |
| 底边避让与关闭恢复 | 将测试窄条拖到工作区外后按 Return 打开设置；持久化的物理 Y 从 2118 调整为 1584，控制带完整显示在安全边界。[底边展开](native-bottom-edge.png)为 520×336；[关闭后](native-bottom-closed.png)恢复 520×168。窗口规划测试还覆盖有效原位置恢复和设置期间的用户拖动偏移。 |
| 任务列表与设置协调 | 设置打开时点击 Codex 来源，[任务列表](native-task-list.png)展开为 520×488，设置收起，列表保持打开。 |

设计示意使用 `CRV-303` 举例。实现保留后端的真实编号、原因和 detail：实际文件写入失败为 `CRV-304`，不会统一替换为 303；错误悬停提示给出存储空间及配置目录写入权限建议。

## 构建与检查

验证环境：2026-10-04，macOS 27.0.1 / 26A434，Apple Silicon arm64，Retina 2×；Node 24、npm 11、Rust / Cargo、本机 WKWebView。

| 执行步骤 | 实际结果 |
| --- | --- |
| `npm test` | 10 个文件、103 项通过。[本轮输出](frontend-test.txt) |
| `cargo test --manifest-path src-tauri/Cargo.toml preferences::tests` | 3 项通过，包含默认配置与偏好保存。[本轮输出](preferences-test.txt) |
| `npm run package:app` | TypeScript、Vite、Rust release、App 与 DMG 打包通过；Codex runtime 已捆绑。[本轮输出](package-build.txt) |
| `codesign --verify --deep --strict release/macos/QuoDex.app` | exit 0。安装到 `/Applications/QuoDex.app` 后再次检查通过，安装后的可执行文件 SHA256 与 release 相同。 |
| 隔离原生启动及交互 | 上表各旅程在真实打包窗口执行，任务为“示例任务 / 示例项目任务”；配置读取、写入失败、重试及尺寸均有实际结果。 |
| 已安装 App 启动冒烟 | 更新 `/Applications/QuoDex.app` 后启动成功，读取真实配额，显示两组实时任务；打开设置确认新控制带存在。用户偏好继续读取原目录；个人任务与额度内容没有保存到本记录。 |

构建产物：`release/macos/QuoDex.app`、`release/macos/QuoDex_0.2.5_aarch64.dmg`。已安装位置：`/Applications/QuoDex.app`。

```text
App executable SHA256
3a000858ce1f828c8dc755932590231d047f7b83b3bf0b6424e4a383e853cff5
DMG SHA256
fed61df09ca939479bdf85648ad1f8a896a0113e0a1f5fcd512c0365831196fa
Release / QA executable SHA256 after removing code signatures from temporary copies
e5ae6fc6d1c1d1f0be95b0d6b0039f953dd1c2bee99b65c9aaab805b2fdbf701
```

## 隔离原生复现

```sh
npm run package:app
python3 fixtures/task-capsules-macos.py --launch-services --output .scratch/settings-redesign/native-qa --y 400
```

读取 `native-ready.json` 的 `app`，用原生 UI 自动化或手动打开该 QA App。它复制最终产物到临时目录，只修改 Info.plist 的名称、独立应用标识与 8 个明确的夹具环境键，并 ad-hoc 重签；生产 App 不变，去掉签名后的可执行文件摘要一致。独立标识避免自动化误选用户实例；额度、任务和偏好都来自临时目录。

`--launch-services` 的 `pid` 是 `open` 启动器，`processKind` 为 `launcher`，不能把它当 App PID；结束时必须通过 QA App 的退出操作关闭窗口。只有不使用此选项时 `pid` 才是直接启动的 App 进程。本轮已退出 QA App，安装版本保持运行供用户查看。

失败复现：将 `native-ready.json` 中 `root` 下的 `config/display-preferences.json` 权限改为 0400，操作减少动效；确认 CRV-304 与额外 24px 行。恢复 0600 后点重试，检查提示消失与文件值保存。仅对隔离文件操作。

## 两路复核与限制

| 复核 | 结果与处理 |
| --- | --- |
| Spec | 核对批准 B 方案、84px 空间预算、260px 窄条、液态玻璃、保存与任务打开协调；未发现阻断。最终原生对照见上表。 |
| Standards | 修复错误行扩容期间重试、关闭期间异步保存失败、后继缩小失败导致丢失最近原生位置、丢失后端诊断的问题；均补充先失败后通过的交互回归。QA 环境仅保留明确夹具键，启动器 PID 含义在此记录。 |

Windows 未现场启动或截图验证；macOS 的单窗截图不代表完整桌面上的背景观感。没有做 Windows 发布，也没有提升版本号、推送或创建 PR。用户最终使用感受与液态玻璃强度仍为 Acceptance pending。
