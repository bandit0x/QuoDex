# 双来源任务胶囊验证记录

状态：**Acceptance pending**。本记录是实现与验证状态的唯一入口；macOS arm64 浅背景现场检查已通过，仍待用户验收。首次双胶囊版本经独立 finish reviewer 检查；本次透明度修订的 Standards / Spec 审查各 0 项发现。

## 版本、产物与环境

- 来源基线：首次双胶囊实现基于 `v0.2.5` / `1a80d5ee8a69f25ef9cb80f9c2c330f5f5915ecb`；本次透明度修订基于 `aeb0d6a`，位于 `codex/task-source-capsules` 分支，包版本仍为 `0.2.5`。
- 产物：`release/macos/QuoDex.app`、`release/macos/QuoDex_0.2.5_aarch64.dmg`。
- 现场：macOS `27.0.1`（`26A434`）、`arm64`、浅色桌面背景，运行真实打包 App。
- App 主二进制 SHA256：`7ba815d156ba268d00f5ff4a9d29e36912c1fbee4ed84f180072678d53246b46`。
- DMG SHA256：`7b7262286674ffdabf314058a8fcff8b0eba1c29d67f2cfbed29357cba0f3596`。

安装复核：已替换并启动 `/Applications/QuoDex.app`；安装包主二进制与上述 SHA256 一致，安装后签名复核成功。真实用户环境中两个来源分别显示，额度读取正常；ZCode 列表展开和收起成功。用户任务标题与账号数值不写入本记录；本次调整前、调整后与列表截图仅保留在本地 ignored 的 `.scratch/task-source-design/transparency-{before,after,list}-installed.png`。旧 App 与显示配置备份位于 `.scratch/task-source-design/rollback-transparency-20261004-145024/`。

## 2026-10-04 透明度修订

用户反馈毛玻璃遮挡过重，背景几乎不可见。本次保留批准的 C 方向，仅降低材质和网页叠层的遮挡：

| 参数 | 调整前 | 调整后 |
| --- | --- | --- |
| macOS 原生 HUD 材质 alpha | 0.42 | 0.14 |
| 胶囊渐变两端 alpha | 0.07 / 0.09 | 0.02 / 0.035 |
| 胶囊网页模糊 | 24px | 8px |
| 列表 / 详情底色 alpha | 0.78 | 0.62 |
| 列表 / 详情网页模糊 | 24px | 12px |

安装后的原生截图中，胶囊底色明显变淡，来源文字描边与状态图标仍清楚，列表内容与来源标题可读，布局与点击身份保持原样。本次重新运行前端 91 项与 Rust 95 项测试、构建打包、包与安装后签名检查，并完成真实安装 App 启动、来源列表展开与收起检查。

本次隔离原生夹具直接启动未能产生可被截图接口识别的窗口，LaunchServices 重试返回 `-10810`，因此没有把旧夹具截图作为本次材质结果。当前现场证据来自安装后的真实用户环境；下方 8 张已提交截图保留为首次双胶囊版本的历史逻辑验收证据。

## 实际结果

| 检查 | 结果与范围 |
| --- | --- |
| 前端测试 | 10 个文件、91 项通过；包含分组计数、同 ID 来源隔离、独立新鲜度、失败轮次、浮层、布局与材质区域检查。 |
| Rust 测试 | 95 项通过、0 失败、5 项 ignored；SQLite 与真实 IPC 消息格式的本地夹具覆盖来源隔离、状态轮次与异常恢复。 |
| 构建与打包 | `npm run package:app` 成功；包含 `tsc`、Vite 生产构建、Rust release 构建及 App / DMG 打包。 |
| 签名检查 | `codesign --verify --deep --strict release/macos/QuoDex.app` 成功。 |
| 原生启动冒烟 | 本次真实安装 App 启动成功，驾驶舱、任务胶囊可见，配额读取正常；隔离原生夹具启动限制见上。 |
| 原生交互 | 本次复核来源列表展开与收起、来源文字与列表可读性。首次双胶囊版本曾在隔离数据上验证窄条、独立 `+N`、失败轮次、来源故障恢复、额度切换、减少动效、展开方向、空组与公共诊断；本次没有重复全部历史旅程。 |

本次构建与测试日志仅保留在 ignored 的 `.scratch/task-source-design/transparency-{frontend,rust,package}.log`，不作为源码产物复制。Rust 第一次在沙箱内运行时 Unix socket 绑定被拒绝，允许本地 socket 后重新运行得到 95 项通过。5 项 ignored 分别需要本机运行中的 Codex 聊天、已登录 ZCode 个人账号、真实网关、现有 ZCode 数据库或运行中的 ZCode 桌面进程；此次没有把它们计为通过。

任务由采集层显式提供 `source`，以 `source:id` 区分聊天、以 `turnId` 区分执行轮次。完成保留 30 分钟，失败移除只隐藏该来源该聊天的当前失败轮次。两来源各自保留健康状态、诊断与观察时间；2 秒心跳 + 3 秒回复期限 + 1 秒前端读取 + 2 秒余量形成 8 秒过期阈值。过期来源的非终态任务降为未知，已确认完成 / 失败保留；不会用另一来源的新时间冒充健康。

## 与批准图逐项对照

批准合同为本地 `.scratch/task-source-design/proposal.md`，批准方向为 [C 高透明毛玻璃双来源胶囊](c-frosted.png)。本次保留既有额度驾驶舱，只扩展任务区。

| 批准要求 | 真实产物结果 | 截图证据 |
| --- | --- | --- |
| 固定左 Codex / 右 ZCode，两组可见；中性透光底与独立来源名称 | 布局、边界与来源归属保持固定；macOS 使用裁剪后的 `NSVisualEffectView` 采样窗口外桌面，来源文字浅背景实测对比约 9.7–10.5:1 | [默认双胶囊](native-capsules.png) |
| 状态语义不被来源色覆盖；每组超过 3 项用前 2 项与 `+N` | 运行 / 等待 / 失败 / 完成 / 未知继续用各自颜色与符号；窄条 3 / 4 项不跨组借位 | [窄条](native-narrow.png) |
| 来源名与 `+N` 打开本来源全部任务，标题标明来源与总数 | ZCode 列表只含该来源任务；失败行可移除，后续失败轮次重新出现；浮层按桌面余量向上或向下展开 | [ZCode 列表](native-zcode-list.png) |
| 单来源异常只影响自身，保留任务身份与已确认终态 | ZCode 数据库故障时运行降为未知，完成记录保留；恢复后重新更新，Codex 继续展示 | [来源不可用](native-source-unavailable.png) |
| 切换额度与减少动效不改变来源分区或点击身份 | 切换到 ZCode 额度后双胶囊仍保留；减少动效保留运行辨识 | [ZCode 额度 / 减少动效](native-zcode-reduced.png) |
| 公共错误独立表达，不伪装成单来源故障 | 公共提醒存储故障提供独立诊断入口与稳定诊断码 | [公共诊断](native-common-diagnostic.png) |
| 公共诊断存在时，健康空组仍显示“暂无任务” | 两组无任务但公共诊断存在时仍展示双来源与独立诊断 | [空组 / 公共诊断](native-empty-diagnostic.png) |
| 两组健康且为空时收起整个任务区 | 最后一次包现场确认任务区完全消失，App 返回 `300 × 130` | [健康空组收起](native-healthy-empty.png) |

以上 8 张现场图来自 `aeb0d6a` 对应的首次双胶囊打包 App，数据为隔离 SQLite 与 IPC 协议夹具；批准图属于虚构设计稿。它们属于历史验收证据，本次提高透明度后的材质以本地 `transparency-*-installed.png` 为准。现场图不是网页或组件预览，也不证明外部真实账号全链路可用。仅浅背景材质、文字与交互获得现场证据，批准图中的深背景效果仍未验证。

## 复现步骤

在项目根目录使用 Node 24（`PATH` 中必须能找到 `node`）、npm 11、Cargo、Python 3 与 macOS 打包工具：

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run package:app
codesign --verify --deep --strict release/macos/QuoDex.app
python3 fixtures/task-capsules-macos.py --y 800
```

启动脚本为 [fixtures/task-capsules-macos.py](../../../fixtures/task-capsules-macos.py)。每次启动创建新的 `qdx-caps-*` 目录，默认提供 Codex 6 项 / ZCode 3 项及隔离额度数据；App 通过真实 IPC / SQLite 读取它们。输出的 `.scratch/task-source-design/native-ready.json` 含 `pid`、`root`、`fixture: true`。后续夹具数据操作必须先确认此标记，只指向其 `root`，不能写真实用户目录。

1. 默认启动后，核对双来源、Codex 的 `+4`、ZCode 的 3 项；分别点击来源名和溢出入口，核对来源、总数、状态与名称。切窄条并检查 3 项与加入第 4 项后的前 2 项 + `+2`；测试应只变更上述隔离 ZCode 数据库。
2. 在 ZCode 列表移除失败提醒；同一 `turnId` 的提醒应保持隐藏。只在隔离数据里更换 `turnId` 并产生新失败后，提醒应重新出现。
3. 在隔离 `.zcode/v2/tasks-index.sqlite` 中执行 `ALTER TABLE tasks RENAME TO tasks_unavailable`，核对 ZCode 运行变未知、完成保留、Codex 正常；执行 `ALTER TABLE tasks_unavailable RENAME TO tasks` 恢复后核对自动更新。切换额度、布局与减少动效，核对任务归属不变。
4. 调整启动的 `--y` 物理坐标，在桌面上下边缘展开列表，核对方向、点击与滚动。`--empty` 复现健康空组收起；`--common-diagnostic` 复现公共诊断；`--empty --common-diagnostic` 复现空组仍保留公共诊断入口。

## 已知限制与待验收

- 深色桌面的自动化工具调用超时，没有完成现场复核；不能把浅背景对比结果扩展到所有背景。
- Windows 没有本轮现场环境；Windows 构建、原生模糊、裁剪 / 命中区、截图与真实旅程尚未验证。
- 协议夹具证明 SQLite / IPC 格式适配及首次双胶囊版本的真实 App 交互。本次透明度修订的现场证据来自安装后的真实用户环境，尚未重新完成干净数据目录原生夹具验证；上述 5 项人工环境测试仍为 ignored。
- 待用户验收安装后的实际桌面环境。跨平台发布前需要补齐 Windows 与深色桌面的原生检查，并记录真实应用跳转与账号数据读取结果。
