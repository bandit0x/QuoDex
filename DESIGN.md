---
name: QuoDex Floating Glass
description: 既有透明额度浮窗与已批准的设置控制仓材质契约
colors:
  focus-cyan: "#50d8ff"
  source-cyan: "rgb(94, 211, 255)"
  source-emerald: "rgb(88, 242, 171)"
  text-primary: "#eaf8fc"
  text-secondary: "#afc3d2"
  lens-label: "#f0fbff"
  saved-mint: "#9ff3cd"
  error-coral: "#ffd1c7"
typography:
  source-label:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, "SF Pro Text", system-ui, sans-serif'
    fontSize: "22px"
    fontWeight: 650
    lineHeight: 1.1
  control-label:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, "SF Pro Text", system-ui, sans-serif'
    fontSize: "18px"
    fontWeight: 540
  plan-value:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, "SF Pro Text", system-ui, sans-serif'
    fontSize: "21px"
  action:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, "SF Pro Text", system-ui, sans-serif'
    fontSize: "18px"
  quit-label:
    fontFamily: '"Segoe UI Variable", "Segoe UI", -apple-system, "SF Pro Text", system-ui, sans-serif'
    fontSize: "20px"
    fontWeight: 620
rounded:
  glass: "34px"
  lens: "999px"
  bead: "50%"
  action: "12px"
  field: "8px"
spacing:
  bead-inset: "2px"
  label-gap: "4px"
  narrow-column-gap: "8px"
  column-gap: "12px"
  narrow-inset: "16px"
  control-inset: "22px"
components:
  source-codex:
    textColor: "{colors.lens-label}"
    typography: "{typography.source-label}"
    rounded: "{rounded.lens}"
    padding: "6px 12px"
    height: "72px"
  source-zcode:
    textColor: "{colors.lens-label}"
    typography: "{typography.source-label}"
    rounded: "{rounded.lens}"
    padding: "6px 12px"
    height: "72px"
  source-carousel:
    textColor: "{colors.lens-label}"
    typography: "{typography.source-label}"
    rounded: "{rounded.lens}"
    padding: "6px 12px"
    height: "72px"
  control-chamber:
    textColor: "{colors.text-primary}"
    rounded: "{rounded.glass}"
    padding: "12px 22px"
    height: "88px"
  opacity-slider:
    typography: "{typography.control-label}"
    height: "36px"
  motion-switch:
    rounded: "{rounded.lens}"
    width: "60px"
    height: "28px"
  quit-action:
    icon: "power"
    textColor: "#ffc4b2"
    hover-text-color: "#ffd7c8"
    typography: "{typography.quit-label}"
    rounded: "{rounded.action}"
    accent-border: "rgba(255, 128, 103, .44)"
    padding: "0 14px"
    height: "48px"
    width: "108px"
  collapse-action:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.action}"
    padding: "0"
    height: "60px"
---

# Design System: QuoDex Floating Glass

## Overview

**Creative North Star: "透明额度驾驶舱"**

保留现有常驻浮窗的液态玻璃语言：桌面透景、曲面反射与厚壁吸收。原额度仓保留深蓝与青绿光学响应；设置控制仓采用同一中性玻璃材质，以内外壁和明暗体现厚度，按用户最新修正取消左右蓝绿分色。中心冠面和卷边壁面作为同一光学表面，来源入口保持已认可的独立凸面透镜。

本文件只提取浮窗共享样式和本次设置组件中可复用的规则，未建立新的产品身份。B 的具体构图、目标图来源与设置尺度合同放在[设置控制仓契约](docs/design/settings-control-chamber/README.md)。tokens 来自 [App.css](src/App.css)、[SettingsDock.css](src/SettingsDock.css)、[SettingsDock.tsx](src/SettingsDock.tsx) 和 [OpticalShell.tsx](src/OpticalShell.tsx)；光学、阴影、动效及组件示例由 [.impeccable/design.json](.impeccable/design.json) 扩展。它们记录代码与已确认方向，不能代替视觉判定；原生证据与验收只见[唯一入口](docs/verification/settings-dock/README.md)。

**Key Characteristics:**

- 相邻功能表面以透明间距分离，控制项在一个内腔中组织。
- 凸面来源透镜以内部青绿光表达选择，以压缩表达按下。
- 控制中心与厚壁共用高度场、法线和光照响应。
- 细槽与玻璃珠承担输入反馈，保存状态保留独立收起操作。

## Colors

颜色值以 frontmatter 为准；Shader 的线性颜色系数属于光学模型，另存 sidecar，不能直接当成界面十六进制色值。

### Primary

- **焦点青**：沿用共享焦点色，定位键盘当前操作的位置。
- **来源青 / 来源翡翠**：来源透镜的状态点、内部选中光及边缘回光；轮播沿用来源青。

### Secondary

- **保存薄荷 / 错误珊瑚**：只承担对应的保存反馈、真实诊断与「退出应用」这一离开性操作；不替换来源选择色。

### Neutral

- **主文字 / 次文字**：控制标签、读数与次级操作分层。
- **透镜文字**：独立来源入口上的高对比文字。

**The State Color Rule.** 选中态由内部光和状态点共同表达；保存反馈、错误反馈与来源选择各自保留语义。

## Typography

继承平台正文栈，不增加展示字体。Frontmatter 字号是缩放前 CSS px，当前框架缩放后为其一半；这些小字号只服务于现有桌面浮窗。

来源名称用 `source-label`；控制标签和读数用 `control-label`；套餐值用 `plan-value`；退出与重试沿用 `action`。透明度读数使用等宽数字。文字阴影提升桌面透景上的可读性，不能靠强化边框掩盖文字对比不足。

**The Local Scale Rule.** 不将浮窗中的局部文字尺度推广为普通页面的正文规范。

## Layout

框架先建立双倍 CSS 画布，再以 `0.5` 缩放，原点位于左上。Tauri 窗口使用逻辑 px；操作系统显示缩放决定截图的物理像素。sidecar 的 `nativeLayout` 保存窗口预算，frontmatter 保存组件 CSS 尺度。

控制行将套餐、弹性透明度列、减少动效、退出和收起排在同一内腔。仅选中 ZCode 时展示套餐，其他来源将该空间让给透明度。窄条收紧内边距和列间距，保留功能。真实错误增加同仓第二行，不添加独立不透明告警条。

任务条独立于额度仓，每组最多直接显示 5 个实际状态。1–2 项时来源名称在左侧，3 项及以上时移到上方；溢出计数进入名称行，保持第五个实际状态。任务条固定预留 44px 原生逻辑高度，常规与窄条保持状态图形尺寸，不用缩小圆圈换容量。

**The Shared Cavity Rule.** 控制项共用一个光学内腔；避免给每个字段另套独立高亮边框。

## Elevation & Depth

厚度由几何光照、按光程计算的吸收、透射与内部回光共同表达；阴影用于将玻璃体从桌面中抬起。来源透镜、控制仓与原额度仓保留各自的轮廓和绘制入口。

控制变体把卷边壁面与中心冠面组合为一个高度场，用有限差分求法线。相同玻璃 IOR 下，Fresnel 和 GGX 响应覆盖中心及壁面；有限软箱以反射线与光源平面求交形成局部反射。光程改变 Beer–Lambert 吸收，中性内部回光和下沿暗部补充厚壁层次。具体参数和阴影词汇见 sidecar。模型存在本身不证明最终观感符合用户目标。

**The Optical Response Rule.** 中心高光必须响应曲面法线，不能退化为只乘壁面 rim 的二维颜色场。

## Shapes

玻璃仓使用共享柔圆角；来源透镜与细槽使用胶囊轮廓；滑块和开关的珠体使用圆形。控制变体在 WebGL 可用时关闭额外 CSS 双描边，避免把厚壁变为并列亮线。CSS 后备沿用既有玻璃语法，不宣称能复制 Shader 曲面。

## Components

来源透镜保持未选中、内部选中光、按下压缩三态。悬停抬升和压缩均为局部反馈；减少动效遵循框架统一设置。透镜光学画布只绘制，HTML 按钮保留输入与可访问语义。

透明度采用细槽和玻璃珠，键盘焦点沿槽。珠式开关在轨道内移动；套餐保持原生选择控件行为，不另加字段套框。成功勾呈现在独立位置，收起箭头持续可识别、可操作。

透明度即时预览，在松手、键盘提交或失焦时保存；真实失败保留原值、诊断编号和重试。关闭设置提交当前预览；退出先提交并等待串行写入，失败时保留控制坞供重试。

**The Independent Action Rule.** 保存结果不能替代收起动作；减少动效改变反馈强度，不改变功能可用性。

sidecar 的 HTML/CSS 片段用于独立检查按钮、输入与状态形状，均不连接原生保存或导航。它们不含生产 WebGL 渲染，不能作为控制仓材质或原生 UI 的验收证据。

## Do's and Don'ts

### Do:

- **Do** 保留额度仓默认绘制入口，将控制材质限制在显式变体中。
- **Do** 保留已认可的独立来源透镜与任务条结构。
- **Do** 区分 CSS px、原生逻辑 px 和截图物理像素。
- **Do** 在同一控制内腔内呈现读数、真实诊断和重试。
- **Do** 将视觉判定与原生证据链接到唯一验收入口。

### Don't:

- **Don't** 用额外增亮描边、假液面、气泡或放大渐变替代控制曲面。
- **Don't** 让成功勾替代或覆盖收起操作。
- **Don't** 将目标示意图、组件片段或模型参数当作实际 App 验证结果。
- **Don't** 将本次设置表面的局部布局提升为其他产品表面的通用限制。
