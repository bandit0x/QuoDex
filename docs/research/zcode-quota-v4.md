# ZCode 4 个人编程套餐配额查询设计

2026-11-24，QuoDex 基线 ea2b9de，Windows，ZCode Desktop 4.0.0.10870，随附 CLI 0.18.0。方案待验证。

## 证据与复核

- 在仓库运行 cargo test --manifest-path src-tauri/Cargo.toml real_gateway_start_plan_probe_is_prioritized -- --ignored --nocapture 可走实际配额读取入口。此前本机复现 CRV-507，使用同一配置密钥直接查询得到业务码 1000。该结果不能确定密钥何时失效。
- 运行 zcode --help 可确认 app-server 入口。在本机安装目录 resources/glm/zcode.cjs 中从 usage/stats 跟到 VJn，数据源是 sessionStore.queryAppUsage，返回会话、请求和 token 计数。订阅剩余额度需由服务端提供。
- 桌面安装包 resources/app.asar 中，getCodingPlanUsageSnapshot 通过 AccountProviderRequestAuthService 解析个人项目授权，fetchQuota 查询 monitor。ProjectAccessTokenClient 可请求签发令牌，缺少配套项目密钥时官方客户端还可能创建密钥。这是特定构建的实现证据，公开的第三方 OAuth 授权契约仍需核实。
- [ZCode 官方配置文档](https://zcode.z.ai/en/docs/configuration)分别说明账号登录和 Coding Plan API Key 两种连接方式。未用新的有效密钥进行实网配额验证。

## 同类实现

| 项目与源码 | 许可证和所查提交日期 | 可借鉴内容、风险及适配成本 |
| --- | --- | --- |
| [CodexBar 配额插件](https://github.com/steipete/CodexBar/blob/a26ca57/Sources/CodexBarCore/Resources/Plugins/zai.js) | MIT，2026-11-21 | 区分个人与团队请求，按窗口类型解析。凭据与区域绑定的思路适配成本低，任意地址覆盖不宜与自动取得的凭据混用。 |
| [ClaudeBar 请求配置](https://github.com/tddworks/ClaudeBar/blob/e999eb9/Modules/Providers/Resources/Providers/zai.json)和[解析器](https://github.com/tddworks/ClaudeBar/blob/e999eb9/Modules/Providers/Resources/Providers/zai-usage.js) | Apache-2.0，2026-11-20 | 将密钥和来源地址配对，保留重置时间，区分额度窗口。可直接借鉴测试用例的覆盖范围，引入整个插件执行器成本高。 |
| [go-z-ai 配额服务](https://github.com/SamyRai/go-z-ai/blob/e276fbe/pkg/client/quota.go) | Apache-2.0，2026-10-03 | 区分带计数的积分窗口和只给百分比的旧窗口。复用字段语义成本低，引入 Go 服务会增加桌面分发依赖。 |

## 查询合同

1. 显式密钥模式。复用 QuoDex 现有的 ZCODE_BIGMODEL_USAGE_API_KEY 覆盖能力。将密钥与用户选择的 CN 或国际区一起解析，分别向固定 HTTPS 官方主机 open.bigmodel.cn 或 api.z.ai 发 GET /api/monitor/usage/quota/limit。禁用跨域重定向。明确显示“指定密钥的套餐”，只凭这把密钥无法证实它属于桌面当前账号。旧配置中的密钥仍可兼容，认证被拒后暂停对相同凭据的自动重试，配置变化或手动刷新后重试。
2. 桌面账号模式。优先采用供应商面向第三方开放的账号授权或已认证额度快照接口。准入条件是能确认账号、区域、个人套餐范围、可用权限及撤销方式。目前尚未找到满足条件的公开接口。若未来选用项目短期令牌，须先确认供应商支持的授权方式、令牌寿命与实际权限，并单独确认签发授权；项目密钥缺失时交由 ZCode 处理。当前设计不直接搬用桌面客户端的私有签发流程。
3. 数据契约。复用现有 Rust 快照和前端刷新入口。每次请求绑定来源、区域及授权代次，只接受仍属于该代次的响应。账户切换时清除旧余额、在途结果和授权缓存。认证拒绝、无套餐、限流以及未知响应分别显示具体原因与稳定编号。仅在账号范围确定且一致时显示其重置卡。
4. 显示与刷新。依据服务端的窗口单位、跨度、剩余量及重置时间展示。只有百分比时仅显示比例；字段缺失、未知类型或零额度不得伪造成满额。合并同一来源的并发刷新，429 按 Retry-After 退避。保留最后成功值时标记读取时间与过期状态。

## 验收与决策

第一步在 Windows 上用同一套餐的有效显式密钥查询两次，不调用模型，逐项对照官方额度页的窗口、余额和重置时间，记录本地时间与脱敏结果。密钥经本机配置提供，不进入聊天、命令参数或验证记录。第二步用匿名 fixture 验证业务码 1000、401/403、429、区域不匹配、部分窗口和账号切换中到达的旧响应。最后构建实际桌面程序，切到 ZCode，连续刷新两次并与官方页面核对。

若验收要求是零配置跟随桌面账号，显式密钥路径不能代替该项验收。下一步先向供应商核实受支持的桌面账号查询接口；如只能签发项目令牌，另行决定是否扩大原有只读权限。本次只提交调研设计。
