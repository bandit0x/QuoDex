# 双来源任务胶囊验证记录

状态：**Acceptance pending**。本记录是实现与验证状态的唯一入口；macOS arm64 浅背景现场检查已通过，仍待用户验收。首次双胶囊版本经独立 finish reviewer 检查；本次设置遮挡修复的 Standards / Spec 审查各 0 项发现。

## 版本、产物与环境

- 来源基线：首次双胶囊实现基于 `v0.2.5` / `1a80d5ee8a69f25ef9cb80f9c2c330f5f5915ecb`；透明度修订基于 `aeb0d6a`，本次设置遮挡修复基于 `c0c7442`。分支为 `codex/task-source-capsules`，包版本仍为 `0.2.5`。
- 产物：`release/macos/QuoDex.app`、`release/macos/QuoDex_0.2.5_aarch64.dmg`。
- 现场：macOS `27.0.1`（`26A434`）、`arm64`、浅色桌面背景，运行真实打包 App。
- App 主二进制 SHA256：`e9991ac11389ae42c96d55214010b33c60accdac72127b4c41a3ee332e3d05cf`。
- DMG SHA256：`25e61293c96f92403c10636f114474853278ccb2d11d7437b23fe120ff071c77`。

安装复核：已替换并启动 `/Applications/QuoDex.app`；安装包主二进制与上述 SHA256 一致，安装后签名复核成功。真实用户环境中两个来源分别显示，额度读取正常。用户任务标题与账号数值不写入本记录；本次设置截图仅保留在本地 ignored 的 `.scratch/task-source-design/settings-overlap-{before,after-above,after-below,restored}.png`。旧 App 与显示配置备份位于 `.scratch/task-source-design/rollback-settings-20261004-174716/`。验收时临时选中的 ZCode 来源已恢复为原轮播偏好，窗口回到原桌面区域，其他显示偏好已核对备份一致。

## 2026-10-04 设置页遮挡修复

最小复现：任务区可见，展开驾驶舱后打开设置，再选择 ZCode 以显示“ZCode 套餐”行。原生截图中设置面板底部约为 `389px`，任务胶囊从约 `349px` 开始，产生约 `40px` 重叠；设置内容高约 `368` CSS px，半缩放后需要 `184` logical px，旧窗口只为设置预留 `160` logical px。

修复将原生设置预算设为 `192` logical px，并由 App 给 CSS 提供同源的 `--settings-space: 384px`。设置区留白、任务栏上方偏移与面板高度上限使用该预算；扣除 `16` CSS px 的放置间隙后，面板上限为 `368` CSS px，超高内容在面板内滚动。未更改任务分区、材质透明度、额度数据或关闭恢复流程。

| 本轮验证 | 证据与结果 |
| --- | --- |
| 修复前回归 | `npm test -- src/windowClient.test.ts`，新增 compact / expanded / collapsed 三个用例全部失败：旧预算 `160` 小于实测面板所需 `184`；日志 `settings-overlap-red.log`。最终用例还校验了 `8` logical px 间隙、上下位置、恢复状态与工作区边界。 |
| 当前前端 | 10 个文件、94 项通过；日志 `settings-overlap-frontend.log`。 |
| 当前产物 | 最终源码执行 `npm run package:app` 成功，包含 TS / Vite / Rust release 与 App / DMG；日志 `settings-overlap-package.log`。 |
| 原生向上展开 | 新包安装后，ZCode 套餐行、退出按钮完整可见；设置底部约 `389px`、胶囊起点约 `414px`，两者分离。见 `settings-overlap-after-above.png`。 |
| 原生向下展开 | 将浮窗移到屏幕顶部附近打开设置，任务栏与驾驶舱在上方，完整设置面板在下方，退出按钮可见。见 `settings-overlap-after-below.png`。 |
| 关闭与恢复 | 关闭设置恢复展开驾驶舱尺寸，见 `settings-overlap-restored.png`；随后还原原轮播、位置与显示偏好，并重新启动安装 App。 |

日志和本轮截图均在 ignored 的 `.scratch/task-source-design/`。本次未修改 Rust 逻辑，因此没有重复上轮 95 项 Rust 测试；Rust release 构建与安装前后签名检查为本次重新执行。三种初始布局与上下位置有自动规划回归，当前原生现场覆盖展开布局和真实用户数据；不把它扩展成全部布局、干净数据目录或 Windows 的现场验收。

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
| 前端测试 | 本次 10 个文件、94 项通过；新增设置面板预算回归，保留来源分组、新鲜度、失败轮次、布局与材质检查。 |
| Rust 测试 | 透明度修订时 95 项通过、0 失败、5 项 ignored；本次未改 Rust，未重复该测试。 |
| 构建与打包 | `npm run package:app` 成功；包含 `tsc`、Vite 生产构建、Rust release 构建及 App / DMG 打包。 |
| 签名检查 | `codesign --verify --deep --strict release/macos/QuoDex.app` 成功。 |
| 原生启动冒烟 | 本次真实安装 App 启动成功，驾驶舱、任务胶囊可见，配额读取正常；隔离原生夹具启动限制见上。 |
| 原生交互 | 本次复核设置向上 / 向下展开、ZCode 套餐行、退出按钮可见与关闭恢复。来源列表与全部历史任务旅程没有重复现场检查。 |

历史透明度修订日志保留在 ignored 的 `.scratch/task-source-design/transparency-{frontend,rust,package}.log`。当时 Rust 首次运行的 Unix socket 绑定被沙箱拒绝，允许本地 socket 后重跑得到 95 项通过。5 项 ignored 需要本机 Codex 聊天、已登录 ZCode 个人账号、真实网关、现有 ZCode 数据库或运行中的 ZCode 桌面进程，没有把它们计为通过。

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
