# 跨 PC 账本：托管数据库与轻量后台调研

调研日期：2026-10-13（Asia/Shanghai）。研究范围：只汇总 Codex / ZCode 历史 token 账本；不要求后台常驻；允许上传最小账目；当前只审方案。产品状态统一看主方案入口，本文件仅保存可复现研究证据。

## 结论

优先沿用本地 SQLite，把最小账目批次放到已有 WebDAV 或托管对象存储，各 PC 下载后按请求身份去重汇总。Supabase 托管可作为有中心查询、账户隔离需求时的备选；本轮不推荐 PocketBase 自建，也不推荐自建 PostgREST。原因不是后端能力不足，而是服务端计算并非当前核心旅程，数据库会新增 schema、RLS、身份会话、项目配额和迁移维护。

“不维持服务”仍需要某个联网中转介质。如果使用现成云存储，不需要用户维护常驻进程，但仍需开通账户、配置专用凭证并处理过期或撤销。最终供应商与网络可达性尚未确定，不能保证免费额度、可用性或设备间实时一致。

## 高星项目与维护快照

GitHub REST API 实时查询，不把 star 当可靠性证明。`pushed_at` 不等于默认分支最后提交，以下单列后者。

| 项目 | stars | SPDX | 固定研究 commit | 默认分支提交 UTC | 本轮取舍 |
| --- | ---: | --- | --- | --- | --- |
| [PocketBase](https://github.com/pocketbase/pocketbase) | 61,384 | MIT | `6f370ea741f33adf889eef02e3c1b884a47aa522` | 2026-10-08 16:21:49 | 深读 4 文件；轻量后台能力足够，但自建运维不符合用户约束 |
| [Supabase](https://github.com/supabase/supabase) | 111,443 | Apache-2.0 | `fe8b4df66d599b37e5a752d11d3d7f90f64240d9` | 2026-10-13 03:06:49 | 评估官方托管；API 核心追到独立 PostgREST 仓库，不把平台 README 当代码审查 |
| [PostgREST](https://github.com/PostgREST/postgrest) | 27,711 | MIT | `ee09d9afe2e1105ec5b4dc673d44d832089ff66e` | 2026-10-12 11:14:00 | 深读 5 实现文件和 1 测试文件；借鉴唯一键、JWT→数据库权限传递，暂不引入服务 |

三个仓库近期均有提交；未做完整漏洞扫描，也未证明这些 HEAD 等于任何托管供应商实际部署版本。Supabase 多组件各有许可，Apache-2.0 只指该平台仓库。

## 源码学习：PocketBase

1. [`apis/batch.go`：`ValidBatchActions`、`batchProcessor.Process`](https://github.com/pocketbase/pocketbase/blob/6f370ea741f33adf889eef02e3c1b884a47aa522/apis/batch.go#L38)。批量 PUT 先按 record ID 查询，再转 update/create；整批由 `RunInTransaction` 包裹，失败给出请求索引及 `batch_request_failed`。这支持“一个批次成功或回滚”，但没有自动理解 QuoDex 的 `(source, request_key)`，更不含 ZCode 新旧版本裁决。可学事务边界和逐项诊断，不能直接把 batch API 当完整同步协议。
2. [`core/db_tx.go`：`RunInTransaction`、`runInTransaction`、`createTxApp`](https://github.com/pocketbase/pocketbase/blob/6f370ea741f33adf889eef02e3c1b884a47aa522/core/db_tx.go#L11)。使用非并发写连接，通过回调中的事务 app 传播连接，已有事务则复用。适合个人用量写入规模；客户端仍必须处理“服务端提交成功、HTTP 回包丢失”的重放，数据库事务并不等于端到端 exactly-once。
3. [`apis/record_crud.go`：`recordUpdate`](https://github.com/pocketbase/pocketbase/blob/6f370ea741f33adf889eef02e3c1b884a47aa522/apis/record_crud.go#L392)。`UpdateRule == nil` 时只允许 superuser；存在规则时通过 resolver 构建过滤并重新取记录。采用时必须设置所属用户限制及允许更新字段；不能把管理员 token 配进桌面客户端。
4. [`apis/middlewares.go`：`loadAuthToken`](https://github.com/pocketbase/pocketbase/blob/6f370ea741f33adf889eef02e3c1b884a47aa522/apis/middlewares.go#L174)。加载失败后继续路由，本身不强制拒绝匿名；授权依赖后续 middleware/collection rules。审计应覆盖实际路径，不能看到 token middleware 就认定访问已受保护。

部署方面，官方说明要求处理服务器、备份等事项，且 v1.0 以前不保证完全向后兼容。单二进制减少部署步骤，却没有消除运维；本机未装 Go/Docker 与本次只做研究并无冲突，但不应为此额外装工具或搭服务。[生产部署文档](https://pocketbase.io/docs/going-to-production/)、[版本稳定性说明](https://pocketbase.io/docs/)

## 源码学习：PostgREST / Supabase 数据 API

1. [`Query/QueryBuilder.hs`：`mutatePlanToQuery`](https://github.com/PostgREST/postgrest/blob/ee09d9afe2e1105ec5b4dc673d44d832089ff66e/src/library/PostgREST/Query/QueryBuilder.hs#L131)。`IgnoreDuplicates` 生成 `ON CONFLICT (...) DO NOTHING`；`MergeDuplicates` 用 `EXCLUDED` 替换提交列。前者可吸收完全相同的请求重放；后者没有应用级版本条件，会让晚到旧数据替换新数据。不能直接以通用 upsert 解决 ZCode 更新。
2. [`Auth/Jwt.hs`：`parseAndDecodeClaims`、`checkForErrors`、`parseClaims`](https://github.com/PostgREST/postgrest/blob/ee09d9afe2e1105ec5b4dc673d44d832089ff66e/src/library/PostgREST/Auth/Jwt.hs#L45)。签名解码后校验时间/audience 并选择 role；这是请求身份识别，不是设备撤销和业务授权的完整实现。
3. [`Query/PreQuery.hs`：`txVarQuery`](https://github.com/PostgREST/postgrest/blob/ee09d9afe2e1105ec5b4dc673d44d832089ff66e/src/library/PostgREST/Query/PreQuery.hs#L39)。把 role 和 JWT claims 传给数据库事务，再让数据库权限/RLS 实施隔离。因此 `owner_id` 不能信任客户端自由填写；策略必须与认证身份绑定。
4. [`Query.hs`：`mainQuery`](https://github.com/PostgREST/postgrest/blob/ee09d9afe2e1105ec5b4dc673d44d832089ff66e/src/library/PostgREST/Query.hs#L53)。读、写、RPC 使用不同 plan，但都携带前置事务变量。若需要条件更新及同步确认，应把数据库操作放进一个 RPC/事务，避免客户端多次 HTTP 调用假装原子；这是备选方案建议，尚未实现。
5. [`Auth.hs`：`getAuthResult`](https://github.com/PostgREST/postgrest/blob/ee09d9afe2e1105ec5b4dc673d44d832089ff66e/src/library/PostgREST/Auth.hs#L22)。通过 JWT cache 取得 claims 后再解析，进一步说明不能把 JWT 验签等同于实时查询设备是否被撤销。
6. [`test/spec/Feature/Query/UpsertSpec.hs`](https://github.com/PostgREST/postgrest/blob/ee09d9afe2e1105ec5b4dc673d44d832089ff66e/test/spec/Feature/Query/UpsertSpec.hs#L57)。现成测试覆盖复合主键、单/复合 unique key、ignore/merge 两种策略。借鉴应是重放与唯一键行为的测试场景；这里只阅读测试，未运行外部测试套件。

安全边界：Supabase secret/service-role key 能绕过 RLS，不可放入分发的桌面应用；汇总 view 和 SECURITY DEFINER RPC 也必须审计其权限。撤销会话的 access token 可持续有效到 `exp`，若产品要求立即断开丢失设备，必须增加服务端检查或明确等待期限。[RLS 官方文档](https://supabase.com/docs/guides/database/postgres/row-level-security)、[退出会话语义](https://supabase.com/docs/guides/auth/signout)

## 与 QuoDex 现有语义的适配

阅读基线：QuoDex `17b8fc0c3432acc3eca7d4b325165c9ed782022f` 的 `src-tauri/src/usage_ledger.rs`、`src-tauri/Cargo.toml`、`CONTEXT.md`、`AGENTS.md`、package scripts 和 README 前 50 行。

- 本地唯一键已经是 `(source, request_key)`。远端如果中心化，单用户唯一键应保持这一逻辑；多租户才加 `owner_id`。`device_id` 是上传来源，不能加入逻辑去重键，否则复制相同日志到两台 PC 会计两次。是否还需 account namespace 取决于上游 ID 作用域的证据，不擅自假定。
- Codex 同 key 不同 total 的本地行为是保留已有记录并报冲突；ZCode 会替换已有记录。跨 PC 不能简单相加各机日总量，也不能把所有事件都设成不可变。
- `updated_at_ms` 是 QuoDex 入账时钟；`source_ts_ms` 是请求起始/来源时间。两者都不能天然证明跨机观察到的 ZCode 版本新旧。必须调查上游 revision/更新时间是否可信；若没有，应保留冲突并制定确定性策略，不能悄悄“最后上传者胜出”。
- 当前相同 total 会直接判定 Unchanged。若将来同步细分 token，必须单独定义 total 不变而细分变化的处理；本轮汇总 total 的范围不应被悄悄扩大。
- 当地日桶是读取时按时区生成。应同步原始请求时间与计数，不能累加各地已归档的日桶；跨时区用户可能同总量但不同日分布，统计时区要在产品合同写清。
- Rust 已有 Tokio，可将网络传输、持久化 outbox、导入事务留在 Rust。既有 REST 后端不要求 Rust SDK，标准 HTTPS 足够；对象存储可复用成熟 S3 实现，具体 SDK 与包体积另做实现前验证。密钥应由系统凭证存储保护，不传入网页状态、日志或仓库。

## 推荐协议边界：远端保存，客户端计算

此节是设计建议，不是已实现能力；与另外两份同步研究合并后再定案。

1. 本机继续单独记账。入账变化与待同步记录在同一个 SQLite 事务提交，避免崩溃时“已记账但永远未上传”。如果采用可重建的扫描队列，需要证明 checkpoint 不会跳过未导出的变化。
2. 输出仅含 schema version、匿名同步空间/设备标识、source、稳定请求标识或可去重派生值、原始时间、total 及必要版本信息。排除聊天标题、提示词、路径、项目名、原始日志、账号邮箱和上游认证信息。
3. 每台设备仅发布自己的不可变批次对象；对象上传完成并经完整性校验后才发布可发现的索引/清单。避免所有 PC 争写一个 `total.json`；device ID 放传输命名空间，不改变逻辑请求身份。远端确认丢失时以同批次 ID 重试，不执行“总量 + N”。
4. 接收方在本地事务中校验格式、合并账目并推进拉取游标；缺失/损坏对象不推进游标。每机从已持久化账目渲染总量，断网展示上次同步时间和待同步项数。
5. 本机新账与远端已确认账必须按请求 ID 做并集；禁止简单计算“云端总量 + 本机总量”。避免把拉下来的其他设备记录再当成自己的新事件上传。
6. 首期不急于做远端垃圾回收、压缩合并或跨设备全局锁。不可变批次增长到需要压缩时，再定义旧设备恢复与保留水位协议；提前自动删除远端对象会引入数据丢失边界。

重放可以用稳定身份做到幂等；ZCode 版本裁决仍是独立的业务难题。无论选择 WebDAV、S3、PocketBase 还是 Supabase，都不会自动替产品定义正确答案。

## 费用与实际维护比较

| 方案 | 需要用户持续维护什么 | 适合当前旅程程度 | 主要限制 |
| --- | --- | --- | --- |
| 已有托管 WebDAV | 已有账户/应用密码、空间及配额 | 若用户已经有可靠服务，新增负担最小 | 各服务 PUT/MOVE/ETag/列目录语义不同，须用选定服务实测；不能把自建 Nextcloud 算作免运维 |
| 托管对象存储，如 R2 | 专用 bucket、设备凭证、账户计费与网络可达性 | 无服务端计算时优先候选 | 需客户端同步协议；认证配置可能比 WebDAV复杂；免常驻不等于零配置 |
| 托管 Supabase | 项目、SQL schema、RLS、认证/撤销、迁移与配额 | 有中心查询、多用户隔离时才更值 | 对单人小账本额外引入数据库计算和会话管理 |
| 自建 PocketBase / PostgREST | 服务可用性、TLS、更新、备份及恢复 | 不符合本轮“不维持服务”偏好 | 运维成本超过账本存储需求 |

2026-10-13 查询：Supabase Free 含 500 MB 数据库、5 GB egress，闲置一周会暂停；Pro 起价 25 USD/月。费用不是唯一缺点：即便免费，也有 schema/RLS/会话管理成本。[Supabase 定价](https://supabase.com/pricing)

R2 Standard 当前每月免费额度为 10 GB-month、100 万 Class A 和 1,000 万 Class B 请求；超出后存储 0.015 USD/GB-month，A 4.50 USD/百万，B 0.36 USD/百万，直接出网免费。按 3 台 PC、每 5 分钟各 1 次列举 + 1 次有变化时的批次写入，上界约 51,840 次 A/月（30 天全天运行，未计额外分页）；通常账本体积很小，但这只是估算，不是测量或免费承诺。申请 token 前需开通 R2。[R2 定价](https://developers.cloudflare.com/r2/pricing/)、[开通与 token](https://developers.cloudflare.com/r2/api/tokens/)

R2 长期凭证可限制至专用 bucket；每设备使用独立凭证有利于逐个撤销。但 bucket 范围权限不等于每设备只能写自己的 prefix，不能据此声称已有强设备隔离。若所有机器共用一个凭证，撤销其中一台就需轮换其他机器；客户端“移除设备”按钮也不自动令云端凭证失效。R2 公开文档描述强一致性，但通过 CDN 缓存等路径还有附加语义，实际原型应走所选存储 API。[认证权限](https://developers.cloudflare.com/r2/api/tokens/)、[一致性模型](https://developers.cloudflare.com/r2/reference/consistency/)

## 仍需主流程确认的问题

- 用户是否已有 WebDAV/对象存储账户；办公网络可访问哪个供应商。
- 可接受的同步延迟，以及“设备离线时所有电脑总量”实际只能包含最近上传的历史这一边界。
- ZCode 相同请求的版本依据；无法辨别新旧时怎样提示并保存冲突。
- 需要云存储服务商不可读账目吗；最小化字段不等于端到端加密。
- 设备遗失后要求立即阻止后续读取/上传，还是允许在供应商控制台撤销；既已下载的数据无法远程收回。
- 历史导入、清空同步空间、断开同步的语义，以及是否保留本地导入历史。

## 可复现记录与限制

环境为 PowerShell 7.6.5；所有外部源码仅下载至 `%TEMP%/quodex-remote-record-backend`，没有运行外部服务、安装 Go/Docker、访问真实账本或上传代码/用户数据。GitHub metadata 使用 `GET https://api.github.com/repos/{owner}/{repo}`；固定 commit 用 `GET /repos/{owner}/{repo}/commits/{default_branch}`；源码用 `https://raw.githubusercontent.com/{owner}/{repo}/{sha}/{path}`。可按上方 commit 链接逐文件重读。

路径发现曾遇到旧版 `src/PostgREST/...` 及已拆分测试猜测路径的 404，随后读取固定 commit 的 git tree 确认实际路径为 `src/library/PostgREST/...`、测试仍在 `UpsertSpec.hs`；报告仅引用成功读取文件。没有把猜测路径或未执行测试当证据。

本轮证据限于源码阅读、官方文档和实时仓库元数据；没有验证实际供应商网络、权限配置、离线恢复、账本一致性、构建或 UI。下一步是先批准产品与同步合同，再用合成数据验证重复导入、断网/丢回包、旧机重放、两机同时发布、凭证撤销与时区差异。任何 UI 改动先出效果图审核。
