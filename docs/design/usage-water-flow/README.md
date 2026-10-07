# 用量页水流背景 · 染料涡流（C 方向，已实施）

状态：Verified（2026-10-07 用户从 A/B/C 原型中选定 C；已实施进 `usage-material.js` 并通过全部既有 QA，新构建已替换 /Applications/QuoDex.app 并真机验收。流协议探测、玻璃冠面与业务数据零改动。）

## 现状与根因

背景共三层：`.ocean-backdrop` CSS 渐变兜底（无 WebGL 时的全部内容）、`#ocean-canvas` WebGL 水流（`usage-material.js` 的 WATER_SHADER）、`.ocean-floor` 底部渐变。WebGL 水路架构本身完好：fbm/curl 单 pass 着色器、context-loss 恢复、24fps 限速、像素预算（≤600k）、reduced-motion 冻结、玻璃冠面按需重绘。

2026-10-07 实测（本地静态服务 + 浏览器）：`usage-material-ready` 生效、无降级原因、系统"减弱动态效果"为关。但相隔约 3.8s 的两帧水面截图肉眼无差——水在动，只是动得不可察觉。

根因是运动学参数与层次设计，不是 bug：

1. `flowTime = uTime × 0.16`，curl 域漂移速度约 0.02 域单位/秒，即每秒相位仅推进噪声域的约 0.3%，3 秒累计不足特征波长的 1%。
2. 场各向同性（无主流方向），没有"水在往哪儿走"的结构线索，人眼对纯噪声相位慢漂不敏感。
3. 渲染分辨率再乘 0.58 降采样（1280×720 → 742×417）加 24fps，细节柔化，进一步掩盖微动。
4. 附带健壮性隐患：`draw()` 内 `scanSurfaces()/drawGlassSurfaces()` 无异常保护，首帧若抛错则 rAF 链条永久断裂（永远静止）；且 `elapsed` 按帧间隔累加并钳制 100ms，rAF 被系统节流（遮挡/后台）后恢复时相位推进不足，长时间节流后观感等同冻结。

## GitHub 调研（代码层面）

| 项目 | 技术内核 | License/维护 | 吸收 | 不采用 |
|---|---|---|---|---|
| [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation)（约 31k★） | GPU Navier–Stokes：半拉格朗日 advection（`vUv - dt*velocity*texelSize`，衰减 `1+dissipation*dt`）、vorticity confinement（CURL 30）、20 次 Jacobi 压力迭代（SIM 128 / DYE 1024）、高斯 splat（`exp(-dot(p,p)/radius)*color`，SPLAT_FORCE 6000） | MIT；成熟稳定 | 染料输运 + 涡流注入的动效语法；鼠标交互注入 | 不整套照搬：每帧 6+ pass 多 FBO ping-pong 持续 GPU 开销最大；涡流随机性强，与数据面板的克制气质有张力 |
| [tkabalin/WebGL-Fluid-Background](https://github.com/tkabalin/WebGL-Fluid-Background) | 上述项目的背景化 fork：全屏 fixed 画布、内容 z-index 分层、参数外置 config | 随上游 MIT | 背景整合与降级思路 | 实现细节一般，只作整合参考 |
| [mrdoob/three.js `examples/jsm/objects/Water.js`](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_shaders_ocean.html) | `getNoise()`：4 次法线贴图采样，除数 103/107/(8907,9803)/(1091,1027) 各配不同时间滚动（t/17、t/29…），合成后 `surfaceNormal` 扰动反射与折射——**多尺度、多方向、错速滚动**是肉眼可感运动的核心语法 | MIT；活跃 | 错速滚动噪声层的构造法（程序化生成，免掉 waternormals.jpg 外链） | 镜像反射、clip-plane 等 3D 机制与背景平面无关 |
| [evanw/webgl-water](https://github.com/evanw/webgl-water)（1278★） | 高度场水面 + 光线经波面折射投影到池底累积亮度生成真实焦散 | **无 license**——推导思路可借鉴，代码不可拷贝 | 焦散 = 光经波面折射的投影；用于加强焦散线条的方向感 | 全 3D 池面机制不适用；无 license 禁止复制代码 |
| liquid-glass 家族（[dashersw/liquid-glass-js](https://github.com/dashersw/liquid-glass-js)、[rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react) 等） | Apple Liquid Glass：DOM 边缘位移折射 + 色差 | 多为 MIT | 可选后续：`.glass-panel` 边缘位移折射（现有 GLASS_SHADER 的 `refractedUv` 已有雏形） | 不引入库：CSP `script-src 'self'` + include_str 内嵌要求自包含单文件 |

CSS/SVG 波浪类（如 coiger/fill-water-animation 一类 keyframes 位移方案）不列入候选：无法匹配现有玻璃光学质感，而降级态（无 WebGL）已有稳定的静态渐变兜底，不需要低配动效。

## 本项目已有的水流资产（并列参考）

- `usage-material.js`：fbm/curl 单 pass 水面 + 玻璃冠面 Fresnel/GGX——**保留架构，只换运动学**。
- 浮窗任务环水光（`.impeccable/mocks/task-status/v3/index.html`）：canvas 波峰 packet 的"伸缩、追赶、汇合再分开"已被用户见过的水流动效语法，可迁移到背景焦散线条的呼吸。
- DESIGN.md 约束：不用假液面、气泡或放大渐变替代光学曲面；reduced-motion 跟随系统统一设置；无 WebGL 时保持稳定可读的水色暗底。

## 设计方向

原型见本目录 `prototype.html`（自包含单文件，直接浏览器打开；四按钮切换 现状/A/B/C，C 模式支持鼠标划入注入染料）。

### 方向 A · 加速暗流（轻）

只重参数化现有单 pass：`flowTime` 0.16 → 0.5 左右；curl 域加恒定主流方向（约右上 12°）；焦散线带宽与亮度 +15%；渲染比例 0.58 → 0.8（仍 ≤600k 像素预算）。观感：纹理整体缓慢迁徙，从"静止"到"缓流"。成本最低、气质延续，但仍是"一张纹理在漂"，没有水形结构变化。

### 方向 B · 双层波面 + 行进焦散（推荐）

参考来源：Water.js 错速滚动（采用构造法）；webgl-water 焦散投影（借鉴推导）；任务环波峰呼吸（迁移语法）。仍在单 pass 内：

- 程序化两层水纹：大尺度慢层（约 0.10 域单位/秒）+ 小尺度快层（约 0.23 域单位/秒），方向相差约 40°，合成法线——波峰线持续位移、交叉，形成可见的水形。
- 焦散网络整体沿主流方向行进 + 在波峰处局部增亮，替代现在的原地闪烁。
- 每 9 秒一次极淡波光沿单一方向掠过（对应任务环的呼吸语法）。
- 玻璃冠面（GLASS_SHADER）模块不动。

成本中等（仍单 pass、单 FBO、像素预算不变）；流动感最强，与"液体舱"主题最贴合。

### 方向 C · 染料涡流（重，可交互）

采用 Fluid-Sim 语法：染料半拉格朗日输运 + 涡流注入；速度场用 curl-noise 代替压力求解（比全套 sim 低一档成本，每帧速度/染料/合成 3 pass），鼠标划入注入染料。观感最"活"、不可预测，但随机性最强，且 GPU 持续占用显著高于 A/B。适合演示与候选，不建议直接作为常驻背景。

## 推荐

**B 为目标形态，A 是 B 的第一步**（修健壮性与重参数化两步共享）；C 不推荐做背景（气质与功耗），若想要交互彩蛋可后置单独评审。

## 实施切分（选定 B 后，小步验证）

（用户实际选定 C，以下按 C 记录实际执行；原 B 路径留档见 git 历史。）

1. 健壮性修复（不改观感）：`draw()` 全程异常保护（`water-frame-error` 诊断编号 + console.warn，单帧失败不再永久杀死 rAF 链）；时间基保持帧间隔累加 + 钳制（染料是有状态模拟，钳制 dt 恰好保证节流恢复不跳变）。
2. 染料涡流管线：单 pass WATER_SHADER 替换为三条 program——速度场（fbm 势函数旋度 + 缓慢环境流，160px 级）、染料输运（半拉格朗日回溯 + 0.28/s 耗散 + 三个游走注入源 + 鼠标注入，384px 级 RGBA16F ping-pong）、合成（沿用旧深水/浅水纵向光与边缘暗角，染料作为发光体叠加）。需要 `EXT_color_buffer_float`，缺失时带 `water-float-targets-unavailable` 编号回退 CSS 静态底。
3. 鼠标注入：背景画布 `pointer-events:none`，监听挂在 `window` 的 pointermove 上，destroy 时移除；划过处注入亮度随帧衰减。
4. context 丢失/恢复：恢复时重建全部 FBO 与 program 并重新预演（110 步）染料，既有 QA 的 lose/restore 检查直接覆盖。
5. 复测：reduced-motion 输出预演后的定格单帧；无 WebGL/浮点目标缺失回退静态渐变；24fps 与 ≤600k 像素预算保持。
6. 交付：`cargo build --release --features tauri/custom-protocol` → 替换 /Applications/QuoDex.app 二进制（ad-hoc codesign）→ 重启真机验收。

## 验收标准

- 主观（第一位，用户验收）：打开页面 2 秒内，不注视图表也能察觉背景在流动。
- 客观（辅助）：同口径 3 秒像素差分（通道和阈值 24）达到现状基线的 3 倍以上。注意基线并非 0：现状每 3 秒有约 5% 像素在无结构闪烁，人眼仍读作"静止"——所以数值只是必要条件，方向性结构运动才是判据（原型实测：现状 5.1% / A 26.1% / B 27.0% / C 20.7%）。
- 性能：24fps 上限与 ≤600k 像素预算保持；GPU 占用不高于现状的 2 倍。
- 降级：无 WebGL 回退静态渐变；reduced-motion 输出单帧；两者均不报错、布局不变。
- 实现（`usage-material.js`）改动仅限水流 shader 与循环；玻璃冠面、业务数据、DOM 结构不动。

## 查看与复现

```sh
open docs/design/usage-water-flow/prototype.html
```

原型与生产实现的差异已注明在原型页脚：单 pass 三方向为等比迁移，C 为 curl-noise 简化版（无压力求解）。

## 验证记录

- 2026-10-07 现状基线：静态服务 + Chromium 内嵌浏览器实测，`usage-material-ready`、无降级原因；rAF 在该内嵌环境一度被重度节流（1.2s 内 0 帧），强制重绘后画布正常出图（1032×580），证明渲染链路完好、问题在运动学。相隔 3.8s 双帧截图肉眼无差。内嵌浏览器节流下的帧差分数值仅作下界，真机数值在实施步骤 2 补测。
- 2026-10-07 原型验证（同环境、同口径 3s 通道和阈值 24 差分）：现状基线渲染与生产水面一致，读数 5.1%（有变化、无结构、人眼读作静止——与用户报告互相印证）；A · 加速暗流 26.1%；B · 双层波面 27.0%（截图显示大尺度波面结构 + 沿波峰的焦散，方向性运动成立）；C · 染料涡流 20.7%（染料团持续漂移汇散，最"活"但随机性最强、偏离现有材质语言）。四模式均无 JS 错误；初始化自诊断（错误直接落读数栏）生效过一次并据此修掉 `prevFrame` 暂时性死区。
- 2026-10-07 C 方向实施验证：静态服务双帧相隔 4s 染料团明显漂移变形；真实二进制 QA（`scripts/verify-usage-ui.mjs`，fixture + 无头 Chrome）13/13 全部 Verified——含"WebGL 水/玻璃 shader 编译""WEBGL_lose_context 真实丢失回退并恢复""reduced-motion 画布定格""无 console/page 错误"，产物在 `docs/verification/usage-liquid-glass/`；vitest 12 文件 169 测试全过；鼠标沿对角线划动后染料沿路径注入扩散；/Applications/QuoDex.app 替换重启后真机页面（127.0.0.1 随机端口）真实数据 + 染料涡流正常，相隔 5s 两帧流态明显不同，`usage-material-ready` 无降级原因。已知限制：染料模拟持续占用 GPU（24fps、160/384px 级渲染目标 + ≤600k 像素合成，属既有预算内）；涡流形态随机，与旧版确定性纹理相比每次打开构图不同（C 方向的固有特征）；真机 GPU 占用未做 Activity Monitor 量化对比。
