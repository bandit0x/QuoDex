# 置于顶层：诊断与验收记录

状态：**Acceptance pending**。设置开关、构建、自动检查和真实 macOS 应用旅程已验证；游戏场景由用户验收。

## 为什么旧版开了置顶，游戏后仍可能消失

旧版 `src-tauri/tauri.conf.json` 已有 `alwaysOnTop: true`。锁定的 `tao 0.35.3` 在 macOS 仅设置 `NSWindow.level`，默认没有跨 Space 或全屏辅助窗口策略。窗口层级只决定同一 Space 中的前后关系；加入其他应用的全屏 Space 需要另外配置窗口行为。

真实应用初始化前读回的旧策略是 `level=5 / collectionBehavior=0`，可在本目录原生采样的 `initialSnapshot` 中核对。新策略使用 `CGWindowLevelForKey` 查询标准浮动层级，加入 `CanJoinAllSpaces`、`FullScreenAuxiliary`，并在 macOS 13+ 加入 `CanJoinAllApplications`；关闭时恢复普通层级和原有 Space 行为。

这证实了旧策略遗漏全屏 Space 参与。尚未获得游戏窗口模式与遮挡现场，不能据此认定它是 Slay the Spire 场景的唯一原因。按用户要求，本次实现及验证期间没有再启动或操作游戏。

依据：本机锁定依赖 `tao-0.35.3/src/platform_impl/macos/{window.rs,ffi.rs}`、Tauri 默认配置，以及 Apple SDK 的 `NSWindow.h` 与 `CGWindowLevel.h`。官方接口说明：[窗口层级](https://developer.apple.com/documentation/appkit/nswindow/level-swift.property)、[跨 Space](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallspaces)、[全屏辅助窗口](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/fullscreenauxiliary)、[跨应用参与](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications)。本次网页工具未能解析 Apple Markdown 内容，接口细节以本机 SDK 声明及实际读回为证据。

## 实现与来源

- 来源基线：`aa6cc96dbfb9d230ac83879818929596ed8ddbf0`；实现版本为包含本记录的本地 `codex/always-on-top` 提交，产品版本 `0.3.0`。
- 设置面板新增默认开启的“置于顶层”；兼容没有该字段的旧偏好，并在重启时恢复选择。
- 原生主线程应用策略、读回确认后原子保存；保存失败精确回滚。启动诊断独立于偏好读取，避免重试覆盖其他选择。
- 失败置顶意图与普通编辑隔离；回滚失败后读回真实状态，无法确认时提示并禁用开关，保留显式重试。
- 交付包：`release/macos/QuoDex-always-on-top.app`，含现有打包流程要求的 Codex runtime；ad-hoc 签名校验通过。
- 应用可执行文件 SHA-256：`f7a32063bd337c072b80f1a25b366301f3f7c877fd2b9fbd5cc4c0384bdcd85c`。

## 验证环境与检查

环境：macOS `27.0.1 (26A434)`，Apple Silicon，当前 SDK `27.0`，Node `24.19.0`，Rust/Cargo `1.98.1`。Tauri `2.11.5`、runtime-wry `2.11.4`、Tao `0.35.3`。

| 检查 | 实际结果 |
| --- | --- |
| TypeScript | `tsc --noEmit` 通过；产品构建中的 `tsc` 通过 |
| 前端测试 | 10 个文件，117 passed |
| Rust 测试 | 106 passed，0 failed，5 ignored |
| Clippy | `--all-targets -- -D warnings` 通过 |
| 格式与 diff | 修改的 Rust 文件 rustfmt 检查及 `git diff --check` 通过 |
| 构建与签名 | Tauri release `.app` 构建、runtime 注入、`codesign --verify --deep --strict` 通过 |
| 两轴审查 | Standards 无剩余实质性发现；Spec 无剩余实质性发现 |

5 项 ignored 是原有个人账户、桌面任务和网关现场探测，不是置顶测试。没有使用其历史结果代替本次检查。新置顶 App 公共行为测试 9 项、原生策略与事务测试 8 项、偏好存储测试 6 项通过。为满足新版 Clippy，将旧本地 socket 测试夹具的读取循环等价改写为 `while let`。

本机没有 npm 的 PATH 入口，因此使用 bundled Node 执行原 scripts 的等价命令；构建临时覆盖 `beforeBuildCommand` 为绝对 Node 路径的 `tsc && vite build`，没有跳过前端构建或修改产品配置。输出 `dist/assets/index-OW_wT1NE.js` 与 `index-4MNdphXK.css`。

详细命令输出保留在当前工作区 `.scratch/always-on-top/{frontend-test.txt,rust-test.txt,clippy.txt,app-build.txt,review-*.txt}`。审查发现的偏好覆盖、失败意图串扰、透明度预览吞诊断及回滚未知状态，均先有红测试，再修复为绿。

## 真实应用检查

通过 `cua_repl` 启动 release 应用的隔离副本；只改变副本的 bundle 标识、`LSEnvironment` 和签名。实际程序代码与交付包在 Mach-O 签名段之前完全一致，SHA-256 均为 `7a2e7ec071ec0310a47db4c06ffc8d90f31a954a15697b29ccbb5f578056464c`。使用新配置目录、匿名额度协议 fixture 和空任务数据库，没有改用户配置；协议 fixture 不代表真实个人账户验证。

| 操作 | 实际结果与证据 |
| --- | --- |
| 开启 | 开关开启、已保存；原生 `level=3 / behavior=262401`，策略匹配请求。[采样](native-enabled.json) |
| 关闭 | 开关关闭、已保存；原生 `level=0 / behavior=0`，策略匹配请求。[采样](native-disabled.json) |
| 退出后重启 | 原保存的关闭选择恢复；新窗口仍为普通层级。[启动采样](native-restored.json) |
| 实际保存失败 | 仅将测试偏好目标文件替换为目录，开启请求返回 `CRV-304`；开关恢复关闭，显示可行动原因与重试。该错误返回路径已完成原生精确回滚及读回确认 |
| 恢复文件后重试 | 原开启意图成功保存；错误消失，开关开启，原生策略匹配。[采样](native-retried.json) |
| 窄条与 ZCode | 设置、套餐、透明度、两开关、保存状态、退出和收起均可见，未发生重叠；测试副本最后正常退出 |

真实 `.app` 的标准、保存成功、失败、重试成功、窄条及 ZCode 套餐窄条截图保存在本任务的 CUA 原生截图输出中。它们已与用户批准的[五态设计](approved-design.png)逐项对照：两行控制仓、原有玻璃材质、窄条额度尺寸和独立状态列一致；失败正文省略时诊断码与重试仍完整可见。真实写入很快，未单独捕获“正在保存”帧；保存中禁用和排队行为由公开 App 接口的延迟应答测试覆盖。

## 复现与用户验收

在退出其他 QuoDex 实例后，可从项目根用新目录直接启动同一个交付二进制进行独立原生检查。`QUODEX_NODE` 使用本机 Node 的绝对路径：

```sh
QUODEX_QA_DIR="$(mktemp -d)"
mkdir -p "$QUODEX_QA_DIR/config"
CODEX_CREDITS_CONFIG_DIR="$QUODEX_QA_DIR/config" \
CODEX_CREDITS_PIN_DIAGNOSTICS_FILE="$QUODEX_QA_DIR/pin.json" \
CODEX_SQLITE_HOME="$QUODEX_QA_DIR" \
QUODEX_TASK_IPC_ENDPOINT="$QUODEX_QA_DIR/unavailable.sock" \
ZCODE_DATA_BASE_DIR="$QUODEX_QA_DIR" \
CODEX_CREDITS_ZCODE_CONFIG_DIR="$QUODEX_QA_DIR/zcode" \
CODEX_CREDITS_APP_SERVER_EXECUTABLE="$QUODEX_NODE" \
CODEX_CREDITS_APP_SERVER_ARGS='["fixtures/app-server-fixture.mjs"]' \
"release/macos/QuoDex-always-on-top.app/Contents/MacOS/codex-credits-view"
```

右键额度面板打开设置，切换置顶，检查偏好文件和 `pin.json`；退出后用同一目录重启。诊断默认不导出；可选导出仅含自己窗口的匿名层级、Space 与可见性，生命周期采样，无轮询，不读取游戏或其他应用内容。

本地安装已按用户要求更新：`/Applications/QuoDex.app` 的可执行文件 SHA-256 与上述交付包一致，严格签名校验通过；重新启动后确认“置于顶层”开启，原有显示选择恢复。旧安装和 `release/macos` 中 7 个历史发行包已通过 macOS 废纸篓移除，可恢复；源码及用户配置保留。安装和清理收据在本机 `.scratch/always-on-top/{local-install.json,old-release-trash.json}`。

用户游戏验收：使用已更新的本地应用，自行启动游戏，检查窗口模式、全屏与桌面切换时是否仍可见。若仍被遮挡，需要游戏模式及当时的自身窗口采样来继续定位。当前没有游戏现场结论，也没有在 Windows 或其他 macOS 版本上做原生验收。
