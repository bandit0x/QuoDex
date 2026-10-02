---
name: QuoDex Task Status Extension
description: 透明额度驾驶舱上方的聊天任务状态行与临时详情
colors:
  running: "#50d8ff"
  completed: "#65edb8"
  waiting: "#ffd27a"
  failed: "#ff897e"
  unknown: "#c4d6e1"
  circle-surface: "rgba(3, 15, 22, .75)"
  circle-interactive: "rgba(13, 37, 48, .95)"
  state-interior: "#071723"
  popover-surface: "rgba(7, 19, 30, .98)"
  text-primary: "#edfaff"
  text-secondary: "#b9d9e7"
  detail-reason: "#ffd5ce"
  action-surface: "#204555"
  list-hover: "#183543"
typography:
  title:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, "SF Pro Text", system-ui, sans-serif'
    fontSize: "24px"
  body:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, "SF Pro Text", system-ui, sans-serif'
    fontSize: "22px"
  label:
    fontSize: "20px"
  list-label:
    fontSize: "18px"
    lineHeight: 1.4
  minutes:
    fontSize: "14px"
    fontWeight: 650
rounded:
  circle: "50%"
  popover: "18px"
  action: "8px"
spacing:
  detail-gap: "8px"
  list-gap: "4px"
components:
  task-running:
    backgroundColor: "{colors.state-interior}"
    textColor: "{colors.running}"
    rounded: "{rounded.circle}"
    size: "40.8px"
  task-completed:
    backgroundColor: "{colors.state-interior}"
    textColor: "{colors.completed}"
    rounded: "{rounded.circle}"
    size: "40.8px"
  task-waiting:
    backgroundColor: "{colors.circle-surface}"
    textColor: "{colors.waiting}"
    rounded: "{rounded.circle}"
    size: "40.8px"
  task-failed:
    backgroundColor: "{colors.circle-surface}"
    textColor: "{colors.failed}"
    rounded: "{rounded.circle}"
    size: "40.8px"
  task-unknown:
    backgroundColor: "{colors.circle-surface}"
    textColor: "{colors.unknown}"
    rounded: "{rounded.circle}"
    size: "40.8px"
  task-popover:
    backgroundColor: "{colors.popover-surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.popover}"
    padding: "16px 20px"
  task-dismiss:
    backgroundColor: "{colors.action-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.action}"
    padding: "8px 16px"
  task-overflow:
    backgroundColor: "{colors.circle-surface}"
    rounded: "{rounded.circle}"
    size: "40.8px"
---

# Design System: QuoDex Task Status Extension

## Overview

**Creative North Star: "透明额度驾驶舱"**

这是既有 QuoDex 界面的局部扩展，仅约束任务圆圈、溢出入口和临时详情。上方透明区域使聊天状态先进入视线，原驾驶舱的液态玻璃、额度布局、来源色与字体继续由既有实现拥有。本文件没有创建新的产品身份，也不替代根级设计系统。

采用已批准的 V5 局部表达：扫读圆圈，悬停或键盘聚焦查看名称与原因，点击打开聊天，超出容量时通过 `...` 查看其余项。运行圈以轻呼吸和持续形变的边缘水光表达活动，完成勾与分钟向圈内收拢。该局部扩展继承既有世界，五块方向合同、QUALITY BAR、concept-seed 的适用依据与批准记录统一在 [brief.md](brief.md)。

本文从 [TaskStatusStrip.tsx](../../../src/TaskStatusStrip.tsx)、[TaskStatusStrip.css](../../../src/TaskStatusStrip.css)、[TaskWaterFlow.tsx](../../../src/TaskWaterFlow.tsx)、[App.css](../../../src/App.css)、[App.tsx](../../../src/App.tsx) 与 [windowClient.ts](../../../src/windowClient.ts) 提取，并参照 V5 原生产物。当前状态、来源版本、交付产物、验证证据与限制只维护在 [brief.md](brief.md)；独立视觉复核见 [finish-review.md](../../../.impeccable/review/task-water-v5/finish-review.md)。

同目录的 [design.json](design.json) 是 schemaVersion 2 扩展 sidecar，记录 frontmatter 无法承载的阴影、动效、原生尺度与独立组件示例。示例无需 React，也不执行真实聊天操作；运行示例仅呈现生产 Canvas 未绘制时的后备轮廓与 CSS 呼吸，真实形变水流必须连接 TaskWaterFlow，不能用 sidecar 的静态轮廓证明动态观感。

**Key Characteristics:**

- 无整块容器的透明单行，保留原驾驶舱材质。
- 状态颜色与 SVG 符号、运行态 Canvas 水流共同表达含义。
- 圈内同时容纳完成勾与真实结束时间的分钟数。
- 原生窗口为可交互弹层提供独立空间。

## Colors

任务圈沿用驾驶舱的青色语汇，其他颜色用于明确区分状态；颜色值以 frontmatter 为准，范围仅限本组件。

### Primary

- **运行青**：继承根样式的 `--cyan`，用于运行态后备轮廓与键盘焦点；Canvas 边缘从深青过渡至青白水光。
- **完成绿**：用于成功轮廓、勾和分钟数，使同一状态保持同色。

### Secondary

- **等待琥珀**：与暂停 SVG 配对，表达等待用户操作。
- **错误珊瑚**：与感叹号 SVG 配对，表达执行报错。
- **原因浅珊瑚**：详情原因与来源诊断文字。

### Neutral

- **未知灰蓝**：与虚线轮廓和问号配对，不能被替换为成功颜色。
- **圆圈暗底 / 圆圈交互底**：为桌面透景上的小图标提供局部对比。
- **状态内底**：用于完成 SVG 的圆形填充与运行 Canvas 的中心暗底；运行圆心不放额外符号。
- **详情深底**：近乎不透明的详情表面，保证名称与原因可读。
- **主文字 / 次文字**：分别用于名称、正文与辅助说明。
- **操作深青 / 列表悬停深青**：用于移除提醒按钮和溢出项反馈。

**The State Pairing Rule.** 状态同时使用颜色与可辨形态；运行使用轻呼吸与形变水流边缘，完成使用勾与分钟，等待使用暂停，报错使用感叹号，未知使用虚线问号。

## Typography

**Body Font:** 继承 App.css 的 Segoe UI Variable / Segoe UI 及平台回退栈。未增加任务专用字体或 display 字体。

**Character:** 沿用常驻浮窗的紧凑文字，标题略大于正文，辅助说明退一级。分钟数采用 `tabular-nums`，保持数字变化时的稳定读感。

### Hierarchy

Frontmatter 的字号全部是缩放前的 CSS 值。任务组件位于现有 `--overlay-scale: 0.5` 的框架内，原生逻辑尺寸为其一半。

- **Title**：详情中的聊天名称；继承浏览器 `strong` 的粗体。
- **Body**：详情状态与原因、溢出项名称。
- **Label**：详情中的“点击圆圈打开聊天”等辅助说明。
- **List label**：溢出列表的状态说明。
- **Minutes**：完成圈内的 `0m` 至 `29m`；650 字重，等宽数字。SVG 文字字号为 14 CSS px，即 7 逻辑 px；用 SVG 基线定位，不继承列表说明的行高与字号。

**The Local Scale Rule.** 这里的小字号服务于已批准的 300px 桌面浮窗，不能扩展为其他页面的通用正文尺度。

## Layout

所有尺寸说明区分 CSS px 与 Tauri 逻辑 px；操作系统显示缩放会进一步改变截图的物理像素。

| 范围 | 实际规则 |
| --- | --- |
| 基础窗口 | 紧凑 300 × 130、展开 300 × 160、窄条 260 × 48 逻辑 px |
| 框架 | 宽高以缩放倒数建立 CSS 画布，再以 0.5 缩放；原点在左上 |
| 任务圆圈 | 40.8 × 40.8 CSS px，即 20.4 × 20.4 逻辑 px |
| 单圈按钮 | 54 × 56 CSS px，即 27 × 28 逻辑 px |
| 行区域 | 64 CSS px 的内部行高；原生窗口增加 36 逻辑 px |
| 详情空间 | 打开时再增加 160 逻辑 px；对应 CSS 变量值 320px |
| 详情面板 | 最大高度 296 CSS px，即 148 逻辑 px；超出内容在面板内滚动 |
| 横向留白 | 任务行通常左右 28 CSS px；窄条为 10 CSS px；详情保持左右 28 CSS px |

可见圆圈缩小不改变单圈按钮：命中区域仍为 27 × 28 逻辑 px；原生 UIA 记录约 28 × 28 是边界取整，不是新的尺寸规范。

紧凑和展开容量为 10 个状态位；不超过 10 个全部显示，超出时 9 个聊天圈加一个 `...`。窄条容量为 9；超出时 8 个聊天圈加 `...`。行不换行，不因任务数量增加高度，也不在行内滚动。

任务行在额度源条件分支之外渲染，Codex / ZCode 轮播和 Pro 单仓不改变其存在。没有可展示任务且没有来源诊断时收起任务空间；读源失败而无已知聊天时保留诊断区域，不伪造零任务。

原生空间调整串行进行，增高时优先保持驾驶舱位置，并限制在当前工作区内。设置面板沿用既有上方 / 下方布局；设置展开时任务行禁用指针交互，避免与设置重叠操作。

**The One Row Rule.** 容量是状态位数量，`...` 占一个位；更多任务进入临时列表。

## Elevation & Depth

新增任务行没有背景容器。每个圈使用小面积暗底与柔和阴影；详情以近乎不透明的深底和更深阴影建立临时层级。驾驶舱原有玻璃、液体、折射与高光继续由原组件渲染；任务扩展不复制整套厚玻璃到圆圈。

### Shadow Vocabulary

- **圆圈阴影**（`0 3px 7px rgba(0, 4, 10, .4)`）：分开细小轮廓与桌面背景。
- **详情阴影**（`0 8px 18px rgba(0, 5, 12, .5)`）：表达临时详情在任务行上方的层次。

阴影为缩放前 CSS 值。任务行层级为 22，详情为 26；这些值是本地组件与现有界面的协调结果。

## Shapes

圆圈与溢出入口使用完整圆形；名义描边为 2.4 CSS px，即 1.2 逻辑 px，未知状态改用虚线。暂停、感叹号和问号使用 23 × 23 CSS px 的内联 SVG，线端与连接处圆润。运行态用 Canvas 绘制边缘，实际亮纹宽度与外轮廓随波场变化，不能将名义描边理解为恒宽机械环。

完成圈的轮廓、勾与分钟共用 `viewBox="0 0 40.8 40.8"`：圆心为 (20.4, 20.4)，半径 19.2，描边 2.4；勾路径采用 `translate(10.8 3.5) scale(.8)`，路径描边 2.8；文字位于 (20.4, 29.8)，居中锚定。外层去掉 CSS border，由同一 SVG 保持圈内留白。溢出列表直接复用该结构，列表 `small` 规则仅作用于外层状态说明，不能覆盖圈内分钟。

详情使用柔和圆角，移除提醒与溢出项使用较小圆角。根容器使用 `overflow: clip`：键盘聚焦不能把经过缩放的画布滚成另一位置；允许滚动的区域是详情面板。

## Components

### Task Circle

小型状态入口，表面与符号共同提供扫读信息。

- **Running**：Canvas 做 2.8 秒轻呼吸，透明度范围 1 → 0.85 → 1。两股非对称波包以 2.6 / 3.9 秒为基础周期，主流与追随流的速度、前沿宽度、拖尾长度和相对强度持续变化，追赶时汇合、错开后分开。外轮廓向内变化 0–0.34 逻辑 px，亮纹宽度 0.72–1.2 逻辑 px；所有变化留在可见圆形内，圆心不增加内轨、准星或转子。
- **Completed**：绿色勾与分钟同圈显示；按真实 `completedAtMs` 向下取整，从 `0m` 开始。结束后达到 30 分钟即不显示；缺失、无效或未来完成时间转为未知。
- **Waiting**：琥珀暂停符号，含义为等待用户操作；组件样例仅演示形状，不证明现场等待旅程。
- **Failed**：珊瑚感叹号。详情可提供原因与稳定诊断码；“移除提醒”针对当前报错轮次，低风险一次提交。
- **Unknown**：灰蓝虚线问号；不能以活动历史或不可确认时间推导绿色成功。

悬停与 `:focus-visible` 改变圈底色；全局焦点描边继承运行青。可访问名称包含聊天名称、状态及完成分钟；图形本身 `aria-hidden`，避免重复朗读。

水流使用一个共享 `requestAnimationFrame` 循环，绘制上限 30fps；Canvas 栅格按实际可见宽度计算，DPR 上限为 2。聊天 ID 生成稳定相位，避免每次渲染随机跳变。不可见、页面隐藏、系统或应用减少动效时，该 Canvas 停止重绘；所有水流均停止时取消共享循环。Canvas 未就绪时显示名义描边与状态内底作为后备。

减少动效保留 2.8 秒低幅度透明度呼吸，范围 1 → 0.86 → 1，并停止空间流动；不可见或页面隐藏时连呼吸一起暂停。主行与溢出列表均复用 TaskCircle 与 TaskWaterFlow，尺寸、分钟和动效语义一致。

**The Living Edge Rule.** 运行提示是轻呼吸与逐帧变化的边缘水光；固定蒙版旋转、多轨环与转子不属于本次批准的任务组件表达。

### Overflow Entry

字面 `...` 表示尚未显示的聊天数量；按钮的可访问名称报告隐藏数量，`aria-expanded` 报告列表开关。入口沿用单圈按钮命中区域，可见圆形缩至 40.8 CSS px，文字为 25.5 CSS px。隐藏项中存在运行任务时入口使用相同 2.8 秒呼吸活动提示；减少动效使用低幅呼吸。点击展开列表，再点击某项打开对应聊天。

### Task Popover

悬停或聚焦圆圈打开详情，位于任务行上方；名称、状态、原因和低风险操作可完整读取。列表与长文字使用面板内滚动、细滚动条与任意位置换行，防止原生窗口裁切或遮住额度数字。

鼠标从圈移至详情时保留弹层。离开后延迟 160ms，关闭前结合原生鼠标位置判断；窗口增高引发的临时 mouseleave 不应使仍在圈或详情内的指针关闭弹层。异步查询使用递增序号忽略过期结果。Escape 或点击组件之外关闭。

详情是可交互 `role="dialog"`，焦点进入取消关闭计时；这里不添加模态遮罩或虚构焦点陷阱。点击圆圈或溢出项调用打开聊天，并关闭详情。

### Source Diagnostic

无已知任务而读取不可用时显示“任务状态不可用”与稳定诊断码；初始化阶段显示“正在读取任务”。该行与聊天圈不同，不能生成一个虚构聊天来承载来源错误。

## Do's and Don'ts

### Do:

- **Do** 继承现有驾驶舱的透明背景、材质和字体，只在任务组件边界使用本地状态色。
- **Do** 同时展示完成勾与按真实结束时间计算的分钟数。
- **Do** 在主行与溢出列表复用同一个任务圈，保持尺寸、分钟与减少动效一致。
- **Do** 为详情增加原生窗口空间，并让长内容在面板内滚动。
- **Do** 保留未知、来源诊断与减少动效的真实语义。
- **Do** 将当前状态、现场验收与限制统一记录在 brief.md。

### Don't:

- **Don't** 把任务行改成两排、行内滚动或随任务数扩大高度。
- **Don't** 把生成说明板的背景、装饰比例或字形用于重绘既有驾驶舱。
- **Don't** 用静态颜色替代运行活动提示，或用 Unicode 图标替代 SVG。
- **Don't** 将固定蒙版旋转、多轨或转子用于本轮运行圈，也不要把 Canvas 亮纹固化为恒宽机械环。
- **Don't** 把演示等待形状或协议夹具记作真实 Desktop 等待事件。
- **Don't** 将这里的局部尺寸、字号和颜色提升为产品范围的新规范。

未固化内容：演示聊天名称、夹具事件、旧稿装饰与全应用聚合 CPU 测量均不构成本组件的设计资产或系统能力；源码没有定义状态色阶，sidecar 不合成新的产品色阶。独立复核未发现本轮新增的 craft-floor 缺陷。

