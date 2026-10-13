# 用量事件、去重与跨机合并：代码级调研

日期：2026-10-13（Asia/Shanghai）。研究范围：已确认的 Codex / ZCode token 历史账本。用户先审方案，不维护常驻服务，允许远端最小账目。证据是固定版本源码静态阅读，未运行上游测试；下述测试均指读到的测试，不声称通过。

本地来源版本：`17b8fc0c3432acc3eca7d4b325165c9ed782022f`。只读项目源码、下载公开源码到系统 TEMP；未读取真实用户账本、聊天日志或凭据。

## 1. 项目选择与活跃度

以下 stars / SHA / push 时间来自本轮 GitHub REST API 的 `repos/{owner}/{repo}` 和 `commits/{default_branch}` 实时读取；数值会变化。

| 项目 | stars | license | 固定版本 / 最近 push UTC | 取舍 |
|---|---:|---|---|---|
| [ccusage/ccusage](https://github.com/ccusage/ccusage) | 18,986 | MIT，根 LICENSE 实际指向 apps/ccusage/LICENSE；API 显示 NOASSERTION | `a1c55688e86a4eb692edd12664abde7c0b98e1f4` / 2026-10-13 02:42:10 | 选择：已有 Rust Codex、ZCode reader，直接研究口径与 replay；不整体移植其 CLI/定价系统 |
| [steipete/CodexBar](https://github.com/steipete/CodexBar) | 22,427 | MIT | `d554d44931807e568471c5ff0d7f786b9c33053b` / 2026-10-13 02:32:49 | 选择：真实跨机 identified request 合并、CloudKit 队列/冲突边界；借算法而非 Swift / CloudKit 平台代码 |
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | 61,103 | API NOASSERTION，未做完整许可证判断 | `00e25792c5d7458517bcaa671466d367c5b04409` / 2026-10-13 03:13:36 | 仅初筛，未做代码级分析：本需求已有本地历史记录，代理网关不覆盖原有历史且扩大接入范围；不把本行算深研 |

上两项目均未 archived，查询当日仍有 push。许可证需保留归属：[ccusage MIT](https://github.com/ccusage/ccusage/blob/a1c55688e86a4eb692edd12664abde7c0b98e1f4/apps/ccusage/LICENSE)、[CodexBar MIT](https://github.com/steipete/CodexBar/blob/d554d44931807e568471c5ff0d7f786b9c33053b/LICENSE)。活跃度不等于安全审计通过。

## 2. ccusage：不能把累计快照直接相加

已深入阅读 7 个源文件：Codex loader/parser/replay/aggregate、ZCode loader/parser、core date_utils。

1. [Codex parser.rs](https://github.com/ccusage/ccusage/blob/a1c55688e86a4eb692edd12664abde7c0b98e1f4/rust/adapters/codex/src/parser.rs#L479)：`visit_codex_session_entry` 在 `token_count` 路径比较 `total_token_usage` 是否推进；只在推进时采用 `last_token_usage`，否则计算累计差值。相同累计快照不产生第二次用量。它另外处理 compaction 的 response ID，避免新旧两种记录双计。
2. [replay.rs](https://github.com/ccusage/ccusage/blob/a1c55688e86a4eb692edd12664abde7c0b98e1f4/rust/adapters/codex/src/replay.rs#L153)：`replay_prefix` 通过父会话、fork 时间识别继承历史，仅截取 fork 之前的父记录；父文件缺失返回空前缀，使 parser 进入时间突发启发式。`is_replayed_compaction` 对压缩请求按 response ID 及 fork 时间识别复制。
3. [loader.rs 测试](https://github.com/ccusage/ccusage/blob/a1c55688e86a4eb692edd12664abde7c0b98e1f4/rust/adapters/codex/src/loader.rs#L1513)：覆盖 fork 复制前缀、跨秒复制突发、累计值不变、父日志丢失与嵌套 fork。启发式是上游兼容旧日志的选择，不是可靠跨机请求身份，不应引入 QuoDex 当前显式 request record 路径。
4. [ZCode loader.rs](https://github.com/ccusage/ccusage/blob/a1c55688e86a4eb692edd12664abde7c0b98e1f4/rust/adapters/zcode/src/loader.rs#L58)：扫描多个 home 后以 `model_usage.id` 的全局 `HashSet` 去重；SQL 只选 `status = completed`（L158）。它没有展示修改记录的跨机版本仲裁；同 ID 首条胜出不等于可安全同步。
5. [ZCode parser.rs](https://github.com/ccusage/ccusage/blob/a1c55688e86a4eb692edd12664abde7c0b98e1f4/rust/adapters/zcode/src/parser.rs#L27)：保留毫秒时间戳；校验 id/session/model/time；cache read/creation 从 input 内扣分后展示，并用 computed_total fallback。与 QuoDex 直接尊重 computed_total、包含有用量的失败请求的合同不同，不能照搬过滤口径。
6. [date_utils.rs](https://github.com/ccusage/ccusage/blob/a1c55688e86a4eb692edd12664abde7c0b98e1f4/rust/crates/ccusage-core/src/date_utils.rs#L206)：日期范围转换成指定 IANA 时区的半开毫秒区间；`format_date_tz` 用该时区逐事件归档，可处理历史 DST。每日汇总依赖统一报表时区，不能把各机本地日桶直接相加。

适配成本：Rust 数据模型和时间处理思想低到中；整体接入 ccusage crate 中到高，会引入定价/CLI/多 provider 范围，而且会改变现有统计合同。安全边界：不上传 JSONL 原文，禁止把项目路径、session 文本和 provider key 混入同步数据；schema 漂移不能吞为零用量。

## 3. CodexBar：请求合并与 iCloud 快照是两条路线

### 3.1 可直接借鉴的 identified request 合并

[CodexRequestLedger.swift](https://github.com/steipete/CodexBar/blob/d554d44931807e568471c5ff0d7f786b9c33053b/Sources/CodexBarCore/Providers/Codex/CodexRequestLedger.swift) 已逐段读到 load / validate / merge / digest：

- `digest`（L224）用每段 UTF-8 字节长度前缀编码 `(codex, threadID, responseID)` 再 SHA256，避开分隔符歧义；device ID 不进入请求身份。
- `load` 通过 owned request observer 收集，保留 UTC 原始毫秒。相同 ID 的 usage 向量不同会标记冲突；相同 usage 的时间不同选最早时间。
- `merge`（L189）要求各份 ledger 的 UTC 起止窗口相同，合并 ID 集合；冲突 ID 从数值中排除，后来的正常值也不会自动洗掉冲突；返回 requestCount、conflictCount、excludedCount、partial。
- `validate`（L31）限制 schema/provider、50,000 条、32 MiB 输出、时间范围、非负 token、cache≤input、reasoning≤output及整数溢出。总量采用 input+output，cache/reasoning 已包含其中，不能再叠加。
- 这是明确标为 `identified-request-subtotal` 的小计，不冒充账户全量；旧格式无稳定 ID 的行记入 excludedCount。

[RemoteCodexCostFetcher.swift](https://github.com/steipete/CodexBar/blob/d554d44931807e568471c5ff0d7f786b9c33053b/Sources/CodexBarCore/Providers/Codex/RemoteCodexCostFetcher.swift#L186) 的 `fetchIdentifiedUsage` 是一次性 SSH 执行 CLI 导出 request ledger。参数有 StrictHostKeyChecking、禁用 agent forwarding、无 TTY、环境白名单、输出字节上限、60 秒 timeout。它依赖远端 Unix shell/CLI及主机在线，不适合直接作为 Windows 办公 PC 的默认同步 UX。

[测试](https://github.com/steipete/CodexBar/blob/d554d44931807e568471c5ff0d7f786b9c33053b/Tests/CodexBarTests/CostUsageCodexRequestLedgerTests.swift#L163) 明确构造 parent owner 的复制记录，断言不计到 child；还覆盖 response 身份跨归档文件去重、thread 与 execution session 不混用、新旧记录 mirror、SQLite reopen。仅阅读，未运行。

### 3.2 iCloud 不能被误称为 token 账本同步

[SyncModels.swift](https://github.com/steipete/CodexBar/blob/d554d44931807e568471c5ff0d7f786b9c33053b/Sources/CodexBarCore/Sync/SyncModels.swift#L11) 只有 ProviderIntent / Device / AccountSnapshot / Preferences。AccountSnapshot 名称按 provider + accountKey + deviceID，内容是 UsageSnapshot；本轮读到的机制不能证明 token 逐请求账本经 iCloud 同步。

[CloudSyncEngine.swift](https://github.com/steipete/CodexBar/blob/d554d44931807e568471c5ff0d7f786b9c33053b/Sources/CodexBar/Sync/CloudSyncEngine.swift#L646) 使用 CKSyncEngine + privateCloudDatabase；usagePayload / displayLabel 使用 encryptedValues。serverRecordChanged 进入 `resolveConflict`（L1115），由 [SyncConflictResolver](https://github.com/steipete/CodexBar/blob/d554d44931807e568471c5ff0d7f786b9c33053b/Sources/CodexBarCore/Sync/SyncModels.swift#L405) 先比 editCount，再比 modifiedAt。该规则适合设置快照，不能直接判定 token 修正的新旧。

[CloudSyncPersistence.swift](https://github.com/steipete/CodexBar/blob/d554d44931807e568471c5ff0d7f786b9c33053b/Sources/CodexBar/Sync/CloudSyncPersistence.swift#L13) 持久化引擎状态、已确认系统字段、pending 删除和设备快照；`save` 原子写入。可借鉴“远端确认后清除 pending”和重启恢复。其配置允许 opt-in secrets 字段，QuoDex 首期没有同步凭据的必要。CloudKit 的 Apple entitlement / Apple ID / Swift 平台依赖使 Windows 适配成本高，不推荐。

## 4. 对当前 QuoDex 的具体影响

已确认本项目：`usage_service.rs:281` 为 `codex:{record.thread_id}:{record.response_id}`；ZCode 为 `zcode:{path_hash}:{id}`（L236），`usage_sources.rs:352` 的 path_hash 是 canonical absolute path 的 SHA256 前 16 个 hex 字符。

- Codex 键结构适合保留源记录身份，但不能单凭字符串形式就声称所有源版本/fork 都已验证。上游 [OpenAI fork 测试](https://github.com/openai/codex/blob/12cca49c81c8aa6a37a5cc4e39964ee3b70f9458/codex-rs/core/tests/suite/fork_thread.rs#L287) 将 source items clone 到 fork history，并断言序列化后前缀保持；配合 CodexBar 的 parent-owner 测试支持“保留源 owner 来去重”的设计。仍需对 QuoDex 所支持的 Codex 版本创建匿名 fixture 实测，不能用最新 main 代替本机版本合同。
- ZCode 路径 hash 不是跨机源数据库身份：不同 PC 同路径可碰到同 namespace；复制到异路径会变 namespace 导致双计。这是同步前需解决的数据模型问题，不能用 device ID 简单修补（会破坏跨机日志复制去重）。
- 当前 upsert 只比较 total_tokens。相同 total 但细分或源时间修正不会更新；跨机 payload_hash / conflict 判断应包含完整受同步字段，不能只比 total。
- 当前 updated_at_ms 是本机入账时间；每次重新扫描/异机时钟不代表来源数据版本。ZCode 缺 source updated_at / revision / finality，因此“最后到达覆盖”“取 token 最大值”都不能证明正确（合法修正可下降）。
- 目前 daily_totals 使用读取时的单个 FixedOffset。若用户需要跨时区机器显示同一日期图，必须选固定报表时区；若要历史 DST 正确，应使用 IANA zone 的逐时点转换。全历史 token 总数不受分桶影响，日期区间总数会受影响。

ZCode 身份证据边界：本轮只证实 ccusage 把 `model_usage.id` 当去重键，没有读到 ZCode 官方生成 ID 的实现；不能证明它是跨安装唯一 UUID，也没有证实源 revision / updated_at 的可靠语义。status=completed 是 ccusage 的筛选条件，不足以证明完成后不可修正。不得直接删除当前路径 hash 发布。若同一已验证 event key 下出现不同 payload，在没有来源版本证据时保留全部候选、排除争议记录并标识小计不完整；同一来源当前本地值可以更新，但不得把它的观察时间假充跨机事实版本。该规则能避免错误自动裁决，却不能解决未验证 key 导致的漏并/误并，后者必须先以匿名原生 fixture 和生成代码证实。

## 5. 最小方案建议（推断，待总方案与用户约束确认）

在用户不维护常驻服务的约束下，可采用远端文件存储承载每设备独立、不可变且可重试的批次文件，客户端完成请求级合并；具体文件发布与索引协议由同步方案定义。同步归一化请求账目及来源证明，不同步 SQLite 整文件、不同步每日总数、不上传原始日志。保留本地持久账本；远端作为交换存储；每机本地计算全设备合并视图。

第一层 event identity 与第二层 delivery identity 分离：event identity 标识同一真实请求，delivery identity = installation UUID + 单调 seq 用于重试/游标。device/source 的记录是 provenance，不自动成为计费键。Codex 可使用长度前缀编码源 thread/response 的 digest；ZCode 需验证原生 id 的生成与复制语义，或引入明确可迁移的 source identity；在证据不够前保留冲突而非自动合并。

每个本地写入事务同时保存 outbox；只上传本地产生的观察，拉回的远端记录不再无限回传。远端 put/upsert 必须幂等；确认后推进游标；首次回填从本地账本重放；重复上传、断线、重启不增加总数。变更版本由可证明的来源 revision 或单一来源写者 seq 排序，不由 wall-clock 决胜；不同写者冲突暴露稳定诊断并保留原始候选。

首期验收 fixture：A/B 分别 100/200→两端 300；同一请求同时存在 A/B→只计一次；复制/fork/改路径；上传已落远端但 ACK 丢失重试；离线后补传；ZCode 100→80 修正；旧离线机 100 不可覆盖新 80；同日边界在两个时区；来源日志删除后持久账本仍可恢复；冲突与格式不支持不显示成完整全量。

## 6. 必须 grilling 的未决项

1. 已确认只汇总 token 历史账本；仍需明确 Codex/ZCode 全部账号合计还是逐账号。
2. 是否会跨 PC 同步/复制源日志或 ZCode 数据库？首期必须承诺这些路径不重复吗？
3. 已确认不维护常驻服务、允许远端最小账目；仍需明确具体远端存储与离线补传期望。
4. 数据归档采用统一时区还是各机当地时间？UI 必须解释未同步设备造成的“截至何时”，不能暗示实时全量。
5. 多个来源写者对同一可变 ZCode 请求给不同值时，能否以源最终状态/版本判断？若源无版本，首期需明确受支持范围及冲突处理，不能承诺无损自动仲裁。

## 7. 复现本次研究

用 PowerShell 7 的 `Invoke-RestMethod https://api.github.com/repos/{repo}` 读取 stars/license/pushed_at；用 `/commits/{branch}` 固定 SHA，再读 `/git/trees/{sha}?recursive=1` 定位文件；通过 `https://raw.githubusercontent.com/{repo}/{sha}/{path}` 下载上文列出的源文件，使用 rg 定位函数并读目标区间。外部文件保存在 `$env:TEMP/quodex-remote-record-usage`，没有依赖下载、构建、产品源码改动或发布。固定 commit 链接足以在 TEMP 清理后复核。
