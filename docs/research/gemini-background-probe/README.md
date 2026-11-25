# Gemini 三仓后台探测调研

2026-11-25，QuoDex 0.4.15（源码 `4cd7b10`），目标账号为 Google One AI Plus。验收条件是用户只安装 QuoDex，首次可登录，此后关闭所有额度页、退出 Antigravity Desktop，六个读数仍能反映同一账号在其他地方产生的消耗或自然重置。

| 来源 | 不开额度页面的取数方法 | 当前证据 |
| --- | --- | --- |
| Gemini Web | 点击连接后，在独立的系统浏览器配置里登录一次。QuoDex 用同一配置在后台加载 Google 的用量视图，解析五小时和每周两行。 | 0.4.15 已有该路径。模拟服务确认关窗后能读到新值；真实 Google 站点只核实了未登录状态。 |
| AG Gemini、AG Claude/GPT | 官方运行时可以一次请求两个模型组的额度；第三方实现也能解析同一类分组数据。 | 个人版缺少已确认的第三方只读授权。0.4.15 两组均取自桌面 Models 面板，退出后没有新的数据源。 |

## Web 取数与本机实测

现有 `connect()` 打开专用浏览器并直接导航到官方用量地址，`read()` 在该窗口关闭后用同一配置启动无窗口浏览器。日常使用不需要用户进入设置。若首次连接也要只看登录界面，可让连接入口落在普通 Gemini 首页，再由后台完成首读；此变更尚未实施。[0.4.15 探针](../../../src-tauri/src/gemini_quota/web_session.rs) · [Chrome Headless](https://developer.chrome.com/docs/chromium/headless) · [Google 官方限额说明](https://support.google.com/gemini/answer/16275805?hl=en)

CodexBar 的实现给出了另一种取数依据。网页自身的用量查询在 `getUsageInfo.pools` 中返回 `GXU_FIVE_HOURLY` 和 `GXU_WEEKLY`，已用比例与重置时间分开。它依赖网页会话和特定查询签名，网页更新会带来适配成本。QuoDex 现阶段优先验证已有页面解析，浏览器管理专用会话。公开的 Gemini Developer API 按 Cloud 项目计算请求与 token 限额，不能用来填个人订阅仓。[CodexBar 固定版本源码](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Resources/Plugins/gemini-web.ts#L63-L88) · [Google API 限额](https://ai.google.dev/gemini-api/docs/rate-limits) · [Google OAuth 权限目录](https://developers.google.com/identity/protocols/oauth2/scopes)

本轮运行环境为 Windows 11 build 26200、Chrome 158.0.8127.37、PowerShell 7.6.9。

- 从仓库根运行 `python docs/research/gemini-background-probe/verify-browser-session.py`。实验只关闭自己创建的匿名测试窗口。后台两次读到的五小时/每周剩余分别为 73%/88% 和 69%/82%；服务端撤销会话后返回 `Sign in required`。[可复现脚本](verify-browser-session.py)
- 用另一个全新临时配置，按发行探针的无窗口参数访问真实的 `https://gemini.google.com/usage`，仅统计解析器匹配的节点。Chrome 退出码 0，用量周期列表数 0，检测到登录入口。此为真实站点的未登录对照。
- 本机未建立 QuoDex 专用 Web 配置，检查时 Antigravity 已退出。未访问默认浏览器的登录数据。本轮没有取得此账号关窗后的六个新值。此前真实账号的六个读数是在两处官方面板打开时取得的。[历史基线](../../verification/gemini-live/README.md#真实账号读数复验)

## 本机 Antigravity 与网页版候选

安装目录的文件清单显示 Desktop 2.35.1.0 带有 `Antigravity.exe` 和 `language_server.exe`，没有 `agy.exe`。PATH 及官方默认 CLI 安装位置也未找到它。Google 的浏览器 Remote Control 连接运行中的本地主机实例；Remote Agents 是另一项云端功能，官方文档明确排除 AI Plus。没有证据表明该网页在 AI Plus 的桌面程序退出后提供两个模型组的余额。官方 CLI 的 status line 可向脚本提供额度桶，依赖运行中的 CLI。[Remote Control](https://antigravity.google/docs/remote-control/) · [Remote Agents 适用套餐](https://antigravity.google/docs/remote-agents/) · [Status line 字段](https://antigravity.google/docs/cli/statusline/)

CodexBar 还记录了 OAuth 回退可在某些账号上返回分组摘要，部分回复只表示模型可用，旧数据也可能缺周限额。单次返回成功、模型列表全满、身份验证成功均不能证明读到了 AI Plus 的四个余额。这条实现同样缺少 QuoDex 对个人订阅查询的服务方授权依据。[CodexBar 的来源与回退说明](https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md)

## 官方可返回的四个读数

Google 的额度命令会向后端刷新，Gemini 模型组与 Claude/GPT 共享组各有五小时和每周限额。CLI 从 v1.1.11 开始可用 `agy -p /usage --output-format json` 输出结构化数据，不必打开 Models 或进入交互终端，也不会发起模型回合、消耗推理额度或创建聊天。这个入口证明服务端可以在桌面应用关闭时按需取数。它要求可用的官方 CLI 及个人登录。[官方额度说明](https://antigravity.google/docs/cli/commands/usage?app=antigravity-ide) · [v1.1.11 发行说明](https://antigravity.google/docs/changelog)

## T3 Code 的实际依赖

1. T3 Code 为 Antigravity 安装并管理官方 CLI，维护独立的登录配置。首次登录通过 CLI 的 ACP 登录流程交由 Google 处理。Google 登录成功后，额度页可显示 T3 以外的活动产生的消耗。[T3 用户文档](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/docs/user/providers-antigravity.md) · [登录实现](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/apps/server/src/provider/AntigravityAuth.ts#L89-L119)
2. 该版本的额度探针使用已登录运行时的授权请求 Google 内部的 `retrieveUserQuotaSummary`。返回没有可用窗口时探针尝试 `fetchAvailableModels`。主路径按已启用的 `bucketId`、`window`、`remainingFraction`、`resetTime` 映射。它单独处理 Argon 和 Carbon 等独立计量组。旧响应若没有披露周期，不能推定为五小时。QuoDex 对已识别的两组可以分别展示四个值，对新增分组应保留其独立含义。[请求与回退](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/apps/server/src/provider/antigravityUsageLimits.ts#L434-L478) · [分组与周期](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/apps/server/src/provider/antigravityUsageLimits.ts#L249-L312)
3. 11 月 19 日合入的 #38957 适配了 CLI 1.5.x 登录。随后 #40178 的报告在 T3 nightly 20261121.5024、CLI 1.5.13 上复现闲置约一小时后额度冻结，重启后误报登录过期。Windows 用户在同一 issue 也报告了该现象。问题出在短期访问令牌续期，用户的 Google 登录仍有效。11 月 25 日核查时，#40474 仍为 Open，修复提案在有效期结束后通过无窗口官方 CLI 完成握手，再取额度。[已合入的适配](https://github.com/pingdotgg/t3code/pull/38957) · [上游复现记录](https://github.com/pingdotgg/t3code/issues/40178) · [待合入的续期改动](https://github.com/pingdotgg/t3code/pull/40474)

## 零额外安装与公开发行

CodexBar 也记录了在关闭桌面客户端后依赖 `agy` 刷新的方法，另列了 macOS Gemini.app 随包提供的 helper。这个 macOS 路径不能作为 Windows Antigravity Desktop 随附可用 CLI 的证据。它还记录了额度命令可能缺少账号身份，从输出中不能确认账号时不宜合并两处的历史。[CodexBar 实现说明](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/docs/antigravity.md)

Google 的认证文档把个人 OAuth 列在官方客户端登录方式中；SDK 的编程认证列出 Gemini API key、Gemini Enterprise/Vertex AI 与本地模型。所查文档中未发现 QuoDex 可用自己注册的 OAuth 客户端申请的个人订阅读取权限、公开的额度查询 API，或桌面应用退出后继续发布新额度的官方导出接口。[官方认证说明](https://antigravity.google/docs/install/#programmatic-authentication)

对开源发行还有独立约束。Google 的 FAQ 说明，个人计划下不支持第三方应用包装 headless CLI，直接脚本及 CI 是其预期用法。附加条款第 6 条限制第三方工具访问服务。在开发者论坛，类似桌面助手使用原版 CLI、Google 登录且不触碰令牌，申请也被拒绝。该个案涉及模型调用，所查资料未见针对只读额度工具的例外。因而，自动下载、内置或调用已安装 CLI 均不能单凭技术可行就列为有官方支持的 QuoDex 发行方案。[Antigravity FAQ](https://antigravity.google/docs/faq) · [附加条款第 6 条](https://antigravity.google/terms) · [论坛原始答复](https://discuss.ai.google.dev/t/request-for-approval-free-desktop-app-that-brings-non-technical-users-to-gemini-with-their-own-google-plan/196378/2)

在现有证据下，若要把 AG 两仓纳入单包后台探针，下一项外部依赖是 Google 给出适用于**第三方只读订阅额度**的接口、官方导出或明确的集成许可。获得接口后，真实账号应覆盖关闭额度页及桌面、跨一次自然变化、闲置超过一小时、重启应用、断网和撤销登录。只有来源返回新响应才移动成功采样时间，失败时保留上次成功时间。

## 真实账号验收条件

首次网页登录成功后，由用户关闭可见窗口。保持额度页面和 AG 桌面关闭，等 QuoDex 连续自动采样。通过其他设备的自然使用或跨重置观察服务端变化，最后才打开官方界面对照各周期；断网期间不推进上次成功时间。跨过一小时、重启 QuoDex 后再取一次，核对账号一致；撤销专用登录后应提示重新连接。单一来源失联只影响其自身。任何缺失周期显示未知，不能用另一仓数值填补。

## 早期实验档案

以下是此前验证 CLI 和扩展的过程，仅供复现历史实验；当时对关闭浏览器、扩展通信和 CLI 打包的设计均属于旧方案。

### 早期 CLI 与扩展实验

| 仓 | 首次连接 | 后续数据来源 | 运行条件 |
| --- | --- | --- | --- |
| AG Gemini、AG Claude/GPT | QuoDex 检查官方 `agy` 的版本与登录状态。需要登录时，由用户启动官方登录并选定账号 | 后台运行 `agy -p /usage --output-format json`，一次获取两个模型组的五小时和每周窗口 | CLI 可用、登录有效、有网络。桌面编辑器和 Models 面板都可以关闭 |
| Gemini Web | 用户在已登录的 Chrome 或 Edge 配置中启用 QuoDex 扩展，授权 Gemini 站点并绑定网页账号 | 扩展后台请求网页自身使用的用量查询，把额度和重置时间传回 QuoDex | 已连接的浏览器配置在运行。可以关闭全部 Gemini 标签页；完全退出浏览器时显示上次读数及时间 |

建议首次连接、应用唤醒和手动刷新时立即取数，平时每五分钟刷新。每个来源合并重复请求。连接状态分开显示，一条链路失效时另一条继续。对限流按服务返回的等待时间退避，普通网络错误退避重试。退出账号或撤销授权后停止刷新，重新连接由用户发起。

### 当时的依据与实现边界

2026-11-25 核查三个上游。T3 Code 和 CodexBar 使用 MIT 许可，仓库最近一次推送分别是 11 月 25 日和 11 月 21 日。Google 的 CLI 发行仓最近一次推送是 11 月 24 日，仓库元数据未声明开源许可证。方案按用户安装的官方程序调用 CLI；浏览器侧与 QuoDex 适配层独立实现。[T3 Code](https://github.com/pingdotgg/t3code) · [CodexBar](https://github.com/steipete/CodexBar) · [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli)

1. **T3 Code。** 核对了其调用官方 CLI 发起登录，以及按模型族和周期映射额度的实现。T3 的服务端适配了内部配额接口，维护成本包含协议和凭据生命周期。QuoDex 借鉴授权和分组，将凭据管理留给官方客户端。[登录实现](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/apps/server/src/provider/AntigravityAuth.ts#L89) · [分组与周期](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/apps/server/src/provider/antigravityUsageLimits.ts#L253-L284)
2. **Antigravity CLI。** Google 的发布说明确认只读 print 命令支持结构化输出，且不生成聊天、不消耗模型额度。运行前检查版本和斜杠命令解析是否启用。仅接受成功的 `usage` 报告和明确启用的已知桶。缺组、缺周期、未知模型、普通推理 token 统计各自保留原义；缺失值不换算为满额。使用独立空工作目录，后台刷新不能意外弹出登录或发起模型调用；这两点列入 Windows 兼容性验证。[官方发布说明](https://antigravity.google/docs/changelog) · [官方分组定义](https://antigravity.google/docs/cli/commands/usage/) · [CodexBar 的 CLI 版本与兼容记录](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/docs/antigravity.md)
3. **CodexBar 的 Gemini Web 实现。** 其独立网页来源从 `getUsageInfo.pools` 提取 `GXU_FIVE_HOURLY` 与 `GXU_WEEKLY`。按明确的已用比例计算剩余量，保留服务端重置时间。它证明独立网页数据源存在。QuoDex 拟用浏览器代发固定请求，省去导出 Cookie 的步骤。Gemini 网页查询属于产品内部协议，上游签名、账号选择或响应结构变化须作为可见故障处理。Gemini CLI 的 Code Assist 桶与 Web 订阅仓分开。[网页解析源码](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Resources/Plugins/gemini-web.ts#L72-L87) · [官方 Gemini Apps 限额](https://support.google.com/gemini/answer/16275805?hl=en)

浏览器扩展只申请 Gemini 主机权限，固定查询地址，通过 Native Messaging 将窗口类型、剩余比例、重置时间及本机连接标识发给限定扩展 ID 的本机程序。浏览器自己附带站点会话；QuoDex 不保存 Google 密码、Cookie 或刷新令牌。主机权限覆盖整个 Gemini 域名，代码内另限定查询路径。浏览器关闭时不代用户启动。首次绑定时验证浏览器配置与账号选择，账号切换时清除上一账号的缓存。AG 报告可能省略账号身份，绑定应依赖官方可验证的会话信息；身份不可确认时先提示确认，不能沿用另一账号的历史。[Chrome 扩展网络权限](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) · [本机通信](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

### 当时的复现与验收

Windows 发行包冒烟使用官方 1.5.16 x64 ZIP，SHA-256 为 `F36C1B7CBF584B5C5A24DD768076013588BE302D6EC954417817DED7E74AE10B`。在临时目录运行包内 CLI 的 `--version` 和 `--help`，两者均退出 0，版本为 1.5.16，帮助列出 print 和 ACP 入口。未安装到系统、未发起授权。本机 PATH 与官方默认安装目录均未发现已安装的 `agy`。发行包验证未覆盖真实账号查询。[官方发行包](https://github.com/google-antigravity/antigravity-cli/releases/tag/1.5.16)

本地实验在一次性 Chromium 配置中加载仅允许访问回环测试域的扩展。运行 `node docs/research/gemini-background-probe/verify-extension.mjs`，独立安装的 Playwright 可通过 `PLAYWRIGHT_MODULE` 指定模块 file URL。未登录返回 401；登录后关闭所有测试站点标签，后台读到模拟的 67 和 89；撤销会话后返回 401。实验未使用 Google 账号，只验证浏览器后台传输。

真实账号验收分三步：

1. 对同一个账号一次性核对三个仓各自两个周期的剩余量与重置时间，以官方页面为参照。关闭两个额度页面及 AG 桌面，用 QuoDex 手动刷新并跨过一次自动刷新，记录独立的新采样时间。产生自然用量变化或周期重置后，再核对数值变化，排除重复读取缓存。
2. 重启 QuoDex 检查连接是否延续；完全退出浏览器后 Web 显示上次采样时间，AG 继续刷新。恢复浏览器后 Web 自动恢复。本地缓存按来源与绑定账号隔离。
3. 撤销单一授权、切换 Google 账号、模拟断网或缺失桶，检查受影响仓的时间与状态，验证原聊天、桌面焦点及另一来源的更新。只有真实 Windows 账号过完这些检查，才可以替换当前页面探针。
