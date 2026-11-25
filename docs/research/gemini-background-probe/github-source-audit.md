# GitHub 源码核查：普通聊天页能否读到 Gemini 额度

2026-11-25。问题限定为 Windows、Google One AI Plus、只安装 QuoDex。区分桌面 Antigravity、终端 agy 和 Gemini Web。以下链接均指向所查源码版本。GitHub 仓库元数据显示，所取七个项目中，Tehan 的最近推送在 9 月，其余六个在 11 月。ai-usage-hub 为 GPL-3.0，其余六个为 MIT。开源许可证作用于各自代码，服务访问另受 Google 的条款约束。[Antigravity FAQ](https://antigravity.google/docs/faq) · [附加条款第 6 条](https://antigravity.google/terms)

## Windows 桌面版开着，Models 面板关着

两个独立的 Windows 项目都实现了从运行中的 Antigravity 本机服务请求分组额度的路径。输入是账号的额度摘要，采集程序不依赖当前前台页标题、滚动位置或面板文字。本机已安装的 Desktop 2.35.1.0 含有名称相符的服务程序。源码证明查询路径存在；本轮没有在该版本的真实 AI Plus 会话上验证响应结构、返回周期数或数据新鲜度。

| 项目与入口 | 源码里的实际行为 | 对 QuoDex 的影响 |
| --- | --- | --- |
| hfatih/ai-usage-hub，Rust 的 Google provider | 优先使用运行中的本机会话，先取账号状态，再请求强制刷新分组摘要，逐组遍历每个 bucket。查不到本机额度时切换到另一条账号来源。 | 单独测试本机路径才能证明桌面端有效。其反序列化要求顶层数值字段；其显示函数一到重置时刻就返回 100%，会覆盖响应中的剩余额度。[本机调用与来源选择](https://github.com/hfatih/ai-usage-hub/blob/a12ea669e27f934a38a722b29106d9c524ff0cce/src-tauri/src/providers/google.rs#L115-L175) · [响应结构](https://github.com/hfatih/ai-usage-hub/blob/a12ea669e27f934a38a722b29106d9c524ff0cce/src-tauri/src/providers/google.rs#L77-L104) · [满额推断](https://github.com/hfatih/ai-usage-hub/blob/a12ea669e27f934a38a722b29106d9c524ff0cce/src-tauri/src/providers/google.rs#L356-L378) |
| Tehan-Hewage/Antigravity-Usage-Indicator，PowerShell 同步程序 | 启动时读取一次，此后默认每两分钟取一次。遍历组和桶，写剩余比例和重置时间；服务无响应时保留先前文件。 | 套餐硬编码为 Google AI Pro，即使输入来自 Plus 也会误标；非 Claude 组且名称不含已知五小时英文词的桶会被标为 Weekly。适合验证取数思路，分组规则不适合直接复用。[周期、分组与采样时间](https://github.com/Tehan-Hewage/Antigravity-Usage-Indicator/blob/f0315755ada3700c05fc5e08d28827399601f41a/scripts/sync_daemon.ps1#L103-L154) · [失联与定时器](https://github.com/Tehan-Hewage/Antigravity-Usage-Indicator/blob/f0315755ada3700c05fc5e08d28827399601f41a/scripts/sync_daemon.ps1#L163-L184) |

这两个项目的本机连接依赖应用内部会话，两者的实现均放宽了本地 TLS 证书验证。查询路径属于实现细节；未查到 Google 对个人版第三方只读客户端的兼容承诺。若已退出桌面，守护程序保留的旧文件只代表最近一次成功采样。

**如何识别真正的四个窗口。** CodexBar 把每个桶的 ID、方向明确的剩余比例、启用状态、显式周期和重置时间分别保留，并兼容直接数值以及嵌套数值。上游测试还覆盖了无法从名称推断周期的桶。T3 Code 同样按服务报告的周期映射五小时和每周，按 ID 单独处理 Argon/Carbon，旧的按模型返回且缺周期的响应不会被赋予虚构周期。它通过独立登录的运行时取数，主要可借鉴分组逻辑。[CodexBar 的摘要解析](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Providers/Antigravity/AntigravityQuotaSummaryParser.swift#L46-L85) · [周期优先级测试](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Tests/CodexBarTests/AntigravityQuotaSourceParityTests.swift#L86-L112) · [T3 Code 的分组与旧格式](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/apps/server/src/provider/antigravityUsageLimits.ts#L249-L305)

## 已有终端 agy 会话

shiroiyuki/antigravity-statusline 使用官方 CLI 给状态栏程序的标准输入。其 Python 实现支持字典或列表，兼容剩余百分数或剩余比例；上游用例同时传入 Gemini、Argon 和第三方模型组，分别断言短周期和周余额。用户不必进入 Models 或执行交互式额度命令。前提是用户已经在用 CLI 并启用了对应状态栏；这种事件输入没有保证闲置期间每五分钟都能取得一次新云端读数。此外，其渲染器把识别不出周周期的桶归为五小时，QuoDex 应对未知周期保留原义。[标准输入入口](https://github.com/shiroiyuki/antigravity-statusline/blob/7267c929696bd5b995937fb62fcd00bf9d26472c/scripts/statusline_render.py#L694-L705) · [读数与周期](https://github.com/shiroiyuki/antigravity-statusline/blob/7267c929696bd5b995937fb62fcd00bf9d26472c/scripts/statusline_render.py#L430-L461) · [六个独立读数的用例](https://github.com/shiroiyuki/antigravity-statusline/blob/7267c929696bd5b995937fb62fcd00bf9d26472c/tests/test_statusline_render.py#L71-L99) · [Google 官方输入格式](https://antigravity.google/docs/cli/statusline/)

## 刷新策略的可复现实验

JerryGong1002/antigravity-weekly-quota 是编辑器扩展。它优先取分组摘要；缺少普通 Gemini 组时会查询按模型提供的数据，缺失周期可单独显示为 model。扩展合并同时进行的刷新，在额度重置点后请求新数据，刷新失败有独立状态。常规定时默认 120 秒、下限 60 秒。该项目还依赖编辑器扩展和现有账号凭据，QuoDex 可独立借鉴其刷新时机。[回退](https://github.com/JerryGong1002/antigravity-weekly-quota/blob/ddfe13439cdb416ecabe5027ede14c056d5635eb/quota-client.js#L224-L245) · [刷新合并](https://github.com/JerryGong1002/antigravity-weekly-quota/blob/ddfe13439cdb416ecabe5027ede14c056d5635eb/extension.js#L72-L95) · [定时器](https://github.com/JerryGong1002/antigravity-weekly-quota/blob/ddfe13439cdb416ecabe5027ede14c056d5635eb/extension.js#L127-L141)

本轮在 Windows / Node 24 上只运行该固定提交中纯显示、时间判定代码。将其 `quota-ui.js` 和 `test/quota-refresh.test.js` 保持相对目录，执行 `node test/quota-refresh.test.js`。四项通过，覆盖重置后刷新、无新重置时避免循环、模型回退和最早重置定时。另向原版 `normalize` 输入匿名分组，五小时/周剩余比例依次为 0.37/0.82 和 0.64/0.91，原版 `percent` 实得 Gemini 37%/82%、Claude 64%/91%。再调用 `percent({window:'weekly'})`，实际返回 0；当桶存在而余额缺失时就会显示耗尽。四个正常模拟值以及此缺值行为均非用户真实余额。[测试源码](https://github.com/JerryGong1002/antigravity-weekly-quota/blob/ddfe13439cdb416ecabe5027ede14c056d5635eb/test/quota-refresh.test.js) · [缺失值处理](https://github.com/JerryGong1002/antigravity-weekly-quota/blob/ddfe13439cdb416ecabe5027ede14c056d5635eb/quota-ui.js#L9-L11)

## QuoDex 的判定

桌面模式最有价值的实机检查，是在普通聊天页面且从未打开 Models 的那次桌面会话中读取分组摘要，同一登录身份下等待一次自然消耗或重置，观察下次采样是否变化，最后才打开官方面板核对。验收时隔离缓存、CLI、云端凭据回退和 UI 读取，让每次成功都能归因到运行中的桌面客户端。退出或缺字段时保留上次成功时间或显示未知。本机存在服务程序、发出了强制刷新请求、时间戳变化，均不足以证明 Google One AI Plus 账号的四个窗口能持续更新。0.4.15 的桌面探针仍以 UI 为来源。[现行探针](../../../src-tauri/src/gemini_quota/windows_reader.rs)

## Gemini 网页仓的两种开源实现

2026-11-25 逐函数核查两个 MIT 项目的固定提交。lobner/gemini-usage 所查提交日期为 11 月 8 日，CodexBar 为 11 月 21 日。两者都从登录账号的网页用量响应中读取五小时和周周期，安装方式与失败时的显示行为不同。[gemini-usage 提交](https://github.com/lobner/gemini-usage/commit/89c23ef416e073395903a6c280eb0e25a0f293cf) · [CodexBar 提交](https://github.com/steipete/CodexBar/commit/a26ca57b518667a659d69524c473af2735069612)

| 检查项 | lobner/gemini-usage | steipete/CodexBar |
| --- | --- | --- |
| 数据来源 | 浏览器扩展用浏览器自己的登录会话读取网页用量；另有独立的 Antigravity CLI 读取函数。 | 只有选择 Web 时加载 `gemini-web`；自动和 API 模式走另一条读取路径。[lobner 的 AG 入口](https://github.com/lobner/gemini-usage/blob/89c23ef416e073395903a6c280eb0e25a0f293cf/src/usage/mod.rs#L245-L277) · [CodexBar 的策略选择](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Providers/Gemini/GeminiProviderDescriptor.swift#L75-L89) |
| 刷新与维护成本 | 浏览器运行时，每分钟采样一次。并发调用合并。扩展从普通 Gemini 首页识别当前用量查询，缓存标识六小时，查询失败且标识已变化时重试一次。 | 插件每次被调用时使用写入该版本源码的查询标识，通过宿主提供、受权限控制的浏览器会话取数；网页更换标识时取数存在中断风险。[lobner 的定时与发现](https://github.com/lobner/gemini-usage/blob/89c23ef416e073395903a6c280eb0e25a0f293cf/extension/background.js#L17-L125) · [CodexBar 的查询](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Resources/Plugins/gemini-web.ts#L6-L35) |
| 周期与方向 | 从 `getUsageInfo.pools` 解出桶类型、`percentageUsed`、重置时间。Rust 主程序要求两个周期都合法，并将 `TIER_HELIUM` 显示为 Plus。 | 用 `GXU_FIVE_HOURLY` 和 `GXU_WEEKLY` 分别选择周期，保留能读到的单个周期。两个实现的输入都是已用比例，0.42 对应 58% 剩余。额外 credits 属于独立字段。[lobner 的解析](https://github.com/lobner/gemini-usage/blob/89c23ef416e073395903a6c280eb0e25a0f293cf/extension/gemini.js#L67-L97) · [Rust 接收端](https://github.com/lobner/gemini-usage/blob/89c23ef416e073395903a6c280eb0e25a0f293cf/src/web.rs#L125-L167) · [CodexBar 的解析](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Resources/Plugins/gemini-web.ts#L64-L95) |
| 失效与旧值 | 登出错误单独处理；扩展把额度或错误传给本机接收器。桌面保留上次成功读数，超过十分钟标旧，若越过重置时间则在显示时把已用量推算为零。 | 区分登录失效、429、服务端异常和结构变化。只有额外 credits 时报告无可用额度窗口。[lobner 的失败上报](https://github.com/lobner/gemini-usage/blob/89c23ef416e073395903a6c280eb0e25a0f293cf/extension/background.js#L54-L100) · [旧值与重置处理](https://github.com/lobner/gemini-usage/blob/89c23ef416e073395903a6c280eb0e25a0f293cf/src/web.rs#L34-L72) · [CodexBar 的错误分类](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Resources/Plugins/gemini-web.ts#L35-L64) |

### 本次匿名验证

- Windows、Node 24.18.0，使用上游固定版本的纯 JS 解析模块，运行 `extension/gemini.test.mjs` 的五项断言组，五项通过。用例覆盖网页资源变更、两周期与 credits、登录页、空账号、失效查询。本轮用例未访问 Google。复现可在同一提交的检出目录运行 `node --test extension/gemini.test.mjs`。[上游用例](https://github.com/lobner/gemini-usage/blob/89c23ef416e073395903a6c280eb0e25a0f293cf/extension/gemini.test.mjs#L12-L68)
- 对 CodexBar 的发布版 JS 插件注入模拟 HTTP 响应。两个已用比例 0.42/0.1 得到 42%/10% 已用；只有周桶且已用为零得到五小时缺失、周 0% 已用；1.2 被截到 100% 已用；单独 credits 返回来源不可用；HTTP 401、429、503 分别得到认证过期、限流、来源不可用。[所测发布版插件](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Resources/Plugins/gemini-web.js) · [上游测试](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/TestsPlugin/GeminiWebPluginTests.swift)

对 QuoDex，这些证据能确认网页仓有独立双周期数据源，也能建立解析测试。lobner 的前提是扩展与本机接收器，CodexBar 的前提是允许宿主使用浏览器会话。QuoDex 的单包方案仍需在自己的专用浏览器会话下验证 AI Plus 实际返回。读取失败时应保留成功采样时间，即使本机时钟已跨过重置点，也要等服务端的新数据再更新液面。
