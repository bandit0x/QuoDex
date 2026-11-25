# Gemini 三仓后台探测方案

目标环境为 Windows 上的 Google One AI Plus 个人账号。首次连接完成后，用户可以关闭两个额度页面，继续聊天或退出 Antigravity Desktop。QuoDex 自行取数，详情显示各仓的采样时间及两个周期。此目录是方案与传输实验，当前发布程序仍使用可见页面探针。

## 普通用户的发行要求

用户从 Releases 安装 QuoDex，点「连接 Gemini」，在已有的系统浏览器里完成一次正常登录。网页仓也必须零扩展。开发者模式、手工加载扩展、运行安装脚本、注册本机桥、另装 CLI 或配置 PATH 均不属于这条安装旅程。

网页候选使用单独的浏览器配置存放这次登录。关掉登录窗口后，QuoDex 可尝试用同一浏览器后台读取官方用量页，只保留五小时和每周窗口。账户退出后提示重新连接。真实账号新时间戳、无扩展的干净安装以及原聊天跳转均须单独验收。

AG 的研究版从官方 CLI 读到过真实值。尚未找到面向第三方桌面应用公开的个人订阅额度端点。Google 的附加条款第 6 条限制第三方软件访问服务。现有实验没有建立可供公开发行的独立授权途径，将 CLI 自动下载到产品目录也不能据此宣称三仓已支持。[Google Antigravity 条款](https://antigravity.google/terms)

## 早期 CLI 与扩展实验（已退出发行方案）

| 仓 | 首次连接 | 后续数据来源 | 运行条件 |
| --- | --- | --- | --- |
| AG Gemini、AG Claude/GPT | QuoDex 检查官方 `agy` 的版本与登录状态。需要登录时，由用户启动官方登录并选定账号 | 后台运行 `agy -p /usage --output-format json`，一次获取两个模型组的五小时和每周窗口 | CLI 可用、登录有效、有网络。桌面编辑器和 Models 面板都可以关闭 |
| Gemini Web | 用户在已登录的 Chrome 或 Edge 配置中启用 QuoDex 扩展，授权 Gemini 站点并绑定网页账号 | 扩展后台请求网页自身使用的用量查询，把额度和重置时间传回 QuoDex | 已连接的浏览器配置在运行。可以关闭全部 Gemini 标签页；完全退出浏览器时显示上次读数及时间 |

建议首次连接、应用唤醒和手动刷新时立即取数，平时每五分钟刷新。每个来源合并重复请求。连接状态分开显示，一条链路失效时另一条继续。对限流按服务返回的等待时间退避，普通网络错误退避重试。退出账号或撤销授权后停止刷新，重新连接由用户发起。

## 依据与实现边界

2026-11-25 核查三个上游。T3 Code 和 CodexBar 使用 MIT 许可，仓库最近一次推送分别是 11 月 25 日和 11 月 21 日。Google 的 CLI 发行仓最近一次推送是 11 月 24 日，仓库元数据未声明开源许可证。方案按用户安装的官方程序调用 CLI；浏览器侧与 QuoDex 适配层独立实现。[T3 Code](https://github.com/pingdotgg/t3code) · [CodexBar](https://github.com/steipete/CodexBar) · [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli)

1. **T3 Code。** 核对了其调用官方 CLI 发起登录，以及按模型族和周期映射额度的实现。T3 的服务端适配了内部配额接口，维护成本包含协议和凭据生命周期。QuoDex 借鉴授权和分组，将凭据管理留给官方客户端。[登录实现](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/apps/server/src/provider/AntigravityAuth.ts#L89) · [分组与周期](https://github.com/pingdotgg/t3code/blob/7e0d1cb9ba4253682978b4a1b5bc427727ba567a/apps/server/src/provider/antigravityUsageLimits.ts#L253-L284)
2. **Antigravity CLI。** Google 的发布说明确认只读 print 命令支持结构化输出，且不生成聊天、不消耗模型额度。运行前检查版本和斜杠命令解析是否启用。仅接受成功的 `usage` 报告和明确启用的已知桶。缺组、缺周期、未知模型、普通推理 token 统计各自保留原义；缺失值不换算为满额。使用独立空工作目录，后台刷新不能意外弹出登录或发起模型调用；这两点列入 Windows 兼容性验证。[官方发布说明](https://antigravity.google/docs/changelog) · [官方分组定义](https://antigravity.google/docs/cli/commands/usage/) · [CodexBar 的 CLI 版本与兼容记录](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/docs/antigravity.md)
3. **CodexBar 的 Gemini Web 实现。** 其独立网页来源从 `getUsageInfo.pools` 提取 `GXU_FIVE_HOURLY` 与 `GXU_WEEKLY`。按明确的已用比例计算剩余量，保留服务端重置时间。它证明独立网页数据源存在。QuoDex 拟用浏览器代发固定请求，省去导出 Cookie 的步骤。Gemini 网页查询属于产品内部协议，上游签名、账号选择或响应结构变化须作为可见故障处理。Gemini CLI 的 Code Assist 桶与 Web 订阅仓分开。[网页解析源码](https://github.com/steipete/CodexBar/blob/a26ca57b518667a659d69524c473af2735069612/Sources/CodexBarCore/Resources/Plugins/gemini-web.ts#L72-L87) · [官方 Gemini Apps 限额](https://support.google.com/gemini/answer/16275805?hl=en)

浏览器扩展只申请 Gemini 主机权限，固定查询地址，通过 Native Messaging 将窗口类型、剩余比例、重置时间及本机连接标识发给限定扩展 ID 的本机程序。浏览器自己附带站点会话；QuoDex 不保存 Google 密码、Cookie 或刷新令牌。主机权限覆盖整个 Gemini 域名，代码内另限定查询路径。浏览器关闭时不代用户启动。首次绑定时验证浏览器配置与账号选择，账号切换时清除上一账号的缓存。AG 报告可能省略账号身份，绑定应依赖官方可验证的会话信息；身份不可确认时先提示确认，不能沿用另一账号的历史。[Chrome 扩展网络权限](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) · [本机通信](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

## 复现与验收

Windows 发行包冒烟使用官方 1.5.16 x64 ZIP，SHA-256 为 `F36C1B7CBF584B5C5A24DD768076013588BE302D6EC954417817DED7E74AE10B`。在临时目录运行包内 CLI 的 `--version` 和 `--help`，两者均退出 0，版本为 1.5.16，帮助列出 print 和 ACP 入口。未安装到系统、未发起授权。本机 PATH 与官方默认安装目录均未发现已安装的 `agy`。发行包验证未覆盖真实账号查询。[官方发行包](https://github.com/google-antigravity/antigravity-cli/releases/tag/1.5.16)

本地实验在一次性 Chromium 配置中加载仅允许访问回环测试域的扩展。运行 `node docs/research/gemini-background-probe/verify-extension.mjs`，独立安装的 Playwright 可通过 `PLAYWRIGHT_MODULE` 指定模块 file URL。未登录返回 401；登录后关闭所有测试站点标签，后台读到模拟的 67 和 89；撤销会话后返回 401。实验未使用 Google 账号，只验证浏览器后台传输。

真实账号验收分三步：

1. 对同一个账号一次性核对三个仓各自两个周期的剩余量与重置时间，以官方页面为参照。关闭两个额度页面及 AG 桌面，用 QuoDex 手动刷新并跨过一次自动刷新，记录独立的新采样时间。产生自然用量变化或周期重置后，再核对数值变化，排除重复读取缓存。
2. 重启 QuoDex 检查连接是否延续；完全退出浏览器后 Web 显示上次采样时间，AG 继续刷新。恢复浏览器后 Web 自动恢复。本地缓存按来源与绑定账号隔离。
3. 撤销单一授权、切换 Google 账号、模拟断网或缺失桶，检查受影响仓的时间与状态，验证原聊天、桌面焦点及另一来源的更新。只有真实 Windows 账号过完这些检查，才可以替换当前页面探针。
