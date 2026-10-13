# 跨 PC 同步调研：共享对象存储与 local-first

研究日期：2026-10-13。研究者：research_sync 子代理。性质：源码研究与候选比较。最终选择与当前状态只见 [主方案](README.md)，下文保留选择前各候选的论证。未运行第三方项目，未上传 QuoDex 代码或用户数据。

## 结论

建议借鉴 Joplin 的“本机数据库 + 按对象同步 + 独立同步状态”模式，用现成 WebDAV 或 S3 存放加密的不可变用量对象；借鉴 Actual 的重复消息过滤与事务应用；Syncthing 可作为已有文件同步工具的可选运输层。不能把正在写入的 SQLite 文件直接放进同步盘，也不能相加每台 PC 的累计总额。

用户已确认：首期先审 token 账本同步方案，允许远端保存最小账目，不希望自己维护常驻服务；最新偏好是百度网盘或其他互联网网盘。统计对象为全部配对 PC 的个人历史账本，统计时区 Asia/Shanghai，在线自动同步目标约 1 分钟，UI 方向 A。服务选择的更新证据见本文末“互联网网盘补充调研”；首期仍只实现一个适配器。两台电脑不必同时在线；纯 P2P 不能覆盖这个要求。

## 取证方式与候选对比

通过浏览官方 GitHub 页面、GitHub REST API 查询默认分支 commit 与 stars，再按固定 SHA 下载相关源码到系统临时目录 `quodex-remote-record-sync-research`。未克隆进产品目录，未安装或执行第三方代码。以下 stars 为此次 API 返回值，随时间变化。

| 项目 | stars | license 证据 | 固定版本与最后默认分支提交 UTC | 适配成本与选择 |
| --- | ---: | --- | --- | --- |
| [Joplin](https://github.com/laurent22/joplin) | 56,706 | 根 LICENSE 为 AGPL-3.0-or-later，子目录可另有许可；GitHub SPDX 返回 NOASSERTION | `6de5ec074a0e58a338eca35a79b757556dd9976a`，2026-10-12 20:26:41 | 借鉴对象同步与失败状态；不嵌入完整 JS 同步器，不复制代码以免带入许可和模型耦合 |
| [Syncthing](https://github.com/syncthing/syncthing) | 89,343 | MPL-2.0 | `d70d210320c4dcce67774c5bf1f545912b99e5d8`，2026-10-12 04:05:09 | 已安装用户可复用其运输能力；内置 Go 引擎/进程管理/发现/中继适配成本高，不建议首期内置 |
| [Actual](https://github.com/actualbudget/actual) | 29,463 | MIT | `e27f2f6c45f01cc911d54437da48ab8fe5f8d5f4`，2026-10-12 21:57:26 | 借鉴日志去重与事务收敛；完整 CRDT+sync server 对只读统计过重，且不满足免运维前提 |

维护活跃度依据当前默认分支最近提交以及仓库 pushed_at（Joplin 10-12、Syncthing 10-13、Actual 10-12），不以 stars 代替安全性。没有对这些项目作完整漏洞审计。

## Joplin：深入源码所得

1. **同步状态与对象模型**：[同步规格](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/readme/dev/spec/sync.md) 将数据实体与 `sync_items` 分开，用 `sync_time`、`sync_disabled` 和 `sync_target` 记录状态。`info.json` 保存协议版本、最低客户端版本和加密配置。对 QuoDex 的启发是账目和“已发/已收”游标分离；旧客户端遇未知协议应停止该同步流而不影响本地统计。
2. **并发修改并非自动相加**：[Synchronizer.ts](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/packages/lib/Synchronizer.ts#L668) 在本地有修改时拉取远端正文，依据正文 `updated_time` 与 `sync_time` 判断两端冲突。注释明确指出存储服务的文件时间不够可靠。此处不能照搬为“时间大的 token 总数胜出”，更不能把两份计数相加。
3. **锁不是通用分布式事务**：[LockHandler.ts](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/packages/lib/services/synchronizer/LockHandler.ts#L39) 检查 TTL，区分 Sync 与 Exclusive；Exclusive 冲突按时间及客户端 ID 稳定选择。[同步器](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/packages/lib/Synchronizer.ts#L576) 续锁失败即取消。不能推断 WebDAV 上存在强一致全局锁。QuoDex 每个生产者只追加独立对象，可避免把全局锁引入核心路径。
4. **WebDAV 兼容性与重试**：[file-api-driver-webdav.js](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/packages/lib/file-api-driver-webdav.js#L16) 提供 `requestRepeatCount() = 3`；`delta()` 使用目录枚举实现 `basicDelta`；`list()` 解析 PROPFIND；`get()` 处理某些 IIS 对不存在文件返回 HTTP 200 的问题。启发：不能拿“支持 WebDAV”当作所有服务行为相同；验收必须针对选定服务做真实读写、路径和异常测试。
5. **S3 分页**：[file-api-driver-amazon-s3.js](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/packages/lib/file-api-driver-amazon-s3.js#L195) 同样通过 list 建 delta，处理 continuation token；传输与应用语义分离。QuoDex 必须完整分页，不能将单页结果视为远端完整历史。
6. **加密边界**：[EncryptionService.ts](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/packages/lib/services/e2ee/EncryptionService.ts#L98) 有 master key 管理，区分 StringV1/FileV1/KeyV1、分块和含算法及主密钥 ID 的头。借鉴“版本化密文封装与显式缺钥错误”，不能手写密码学或直接复制其历史算法兼容层。[根 LICENSE](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/LICENSE) 已实读。
7. **删除与失败**：[Synchronizer.ts](https://github.com/laurent22/joplin/blob/6de5ec074a0e58a338eca35a79b757556dd9976a/packages/lib/Synchronizer.ts#L586) 显式执行 delete_remote，再执行增量同步；异常区分缺钥、锁、failSafe、未知类型、同步中变化与网络错误。QuoDex 账本“来源清理不删除已入账”与笔记删除语义相反，不能继承远端文件缺失即删除本地记录的策略。

## Syncthing：深入源码所得

1. [vector.go](https://github.com/syncthing/syncthing/blob/d70d210320c4dcce67774c5bf1f545912b99e5d8/lib/protocol/vector.go#L129) 的 `Update`、`Merge`、`Compare`、`Concurrent` 区分先后与并发，合并是每设备版本计数的最大值，**不是业务 token 最大值**。
2. [folder_sendrecv.go](https://github.com/syncthing/syncthing/blob/d70d210320c4dcce67774c5bf1f545912b99e5d8/lib/model/folder_sendrecv.go#L1686) 检查文件冲突，调用 `moveForConflict` 保存 `.sync-conflict-...` 副本，再替换文件；临时文件替换失败则留存以供复用。`MaxConflicts == 0` 可直接移除旧副本。它不会解析 SQLite 两个分支的账目，所以“文件同步成功”不能证明“总用量合并正确”。
3. [删除分支](https://github.com/syncthing/syncthing/blob/d70d210320c4dcce67774c5bf1f545912b99e5d8/lib/model/folder_sendrecv.go#L908) 检查删除前状态，并在删除赢得冲突时保留冲突副本。直接共享数据库可能把本机工作集替换成另一份完整数据库。
4. [deviceid.go](https://github.com/syncthing/syncthing/blob/d70d210320c4dcce67774c5bf1f545912b99e5d8/lib/protocol/deviceid.go#L44) 的设备 ID 来自证书 SHA-256；[connections/service.go](https://github.com/syncthing/syncthing/blob/d70d210320c4dcce67774c5bf1f545912b99e5d8/lib/connections/service.go#L261) 从 TLS peer certificate 取身份，在 `OnHello`、配置设备检查和证书名验证通过后才建协议连接。复制设备私钥会复制身份，因此 QuoDex producer identity 不应跟随账本备份自动克隆。
5. [官方同步说明](https://docs.syncthing.net/users/syncing.html) 描述块传输、临时文件与冲突处理。推断：复用 Syncthing 运输不可变密文对象可行；复用其全引擎并不能省掉 QuoDex 请求键、版本、幂等导入和完整性设计。TLS 传输加密本身也不等于每台接收设备的落盘加密。

## Actual：对重复、乱序与恢复的补充验证

1. [sync/index.ts `compareMessages`](https://github.com/actualbudget/actual/blob/e27f2f6c45f01cc911d54437da48ab8fe5f8d5f4/packages/loot-core/src/server/sync/index.ts#L294) 按 dataset/row/column/timestamp 去重：重复消息跳过，落后消息标为 old；`_applyMessages` 在事务内更新数据、日志和持久化 clock，提交后才更新内存 Merkle。启发：QuoDex 应在同一事务内写账目与已导入对象标记，重启/重复下载不重复计数。
2. [`_fullSync`](https://github.com/actualbudget/actual/blob/e27f2f6c45f01cc911d54437da48ab8fe5f8d5f4/packages/loot-core/src/server/sync/index.ts#L878) 使用 token 请求 `/sync`，比较 Merkle 差异并继续追赶；同一 diff 连续 10 次或总次数 100 时走修复/报错路径。注释仍提 300，实际条件是 100，应以代码为准。需要专用在线服务；不能直接变成 WebDAV 客户端。
3. [timestamp.ts](https://github.com/actualbudget/actual/blob/e27f2f6c45f01cc911d54437da48ab8fe5f8d5f4/packages/crdt/src/crdt/timestamp.ts#L192) `send/recv` 是物理时间+计数器+node 的混合逻辑时钟，默认漂移边界 5 分钟。它给副本操作排序，却不能证明“后观察到的来源记录就是更正确的 token 数”；QuoDex 缺少来源 revision 时不能靠 HLC 解决业务真值。

## 为什么不直接同步 SQLite

当前 QuoDex `usage_ledger.rs` 没有开启 WAL，不能声称当前必有 WAL 旁文件。但任意字节文件复制都不提供两台独立数据库的行级 merge；同时写入后取一份最终文件会遗漏另一台新增账目。若以后改 WAL，已提交数据还可能停留在 `-wal` 中；[SQLite WAL 官方说明](https://www.sqlite.org/wal.html) 明确 WAL 依赖同机共享内存、网络文件系统不支持，事务提交并不要求先写主文件。安全快照可用作只读导出载体，却仍需请求级合并，不能相互覆盖运行中数据库。

## 候选协议草案（推断，未实现）

- 每台 PC 本地持续采集；采集事务同时写入 outbox，网络断开不阻塞本地统计。同步收到的记录不再次充当本机新采集数据发出，避免环路。
- 远端目录按随机 sync-space / producer 分区，使用不可变分段对象，如 `producer/sequence-contenthash.bin`。生产者只写自己的新对象，不共享可变 `totals.json`。身份保存在机器绑定位置；恢复账本产生新 producer，而业务请求 ID 仍保持稳定。身份克隆必须被检测，不能仅凭 hostname。
- SQLite 账本与 outbox 保留 request identity、原始时间、各 token 分量、来源版本证据；云端不放 prompt、聊天标题、绝对路径、账号 token、数据库扫描缓存。空间级 HMAC 可隐藏请求键，但需要配对共享密钥后仍保持相同键。
- 上传成功才标记 ack；响应丢失时重传同对象键，校验已存在内容 hash，禁止静默覆盖不同字节。下载后先完整性/版本/大小校验，再在单事务应用并记 inbox hash。不能用“收到过最大 seq”跨过空洞，需要连续游标或显式已收集合。
- 清单可以是可重建提示，不是唯一真相；全量分页或分区扫描补齐漏发现对象。远端列举短暂缺项不表示历史删除。首期不自动做跨设备 GC，不以云端对象消失反向清空账本。
- 需要更新账目时追加新 revision 事件；原对象不改。是否采用周期完整快照仅是规模优化，快照必须声明覆盖范围/版本并保留重放边界，不能相加多份快照。
- 加密采用成熟 AEAD 库，密钥本机安全存储，共享空间 key 配对；AEAD 绑定协议版本/空间/生产者/对象 ID。HTTPS、认证与密文完整性分层。共享空间成员持有 key 能读写内容；若要求撤销单台设备，需凭据与密钥轮换，不能只删除 UI 中的设备名称。
- 重试建议指数退避+jitter；401/403、空间不匹配、未知版本、hash 不一致、存储满与短暂网络失败分开诊断。客户端恢复后从持久 outbox/inbox 继续，显示最近成功同步时间与未同步数量，不许离线时称“全设备实时总量”。

## QuoDex 的前置根因，必须先解决

本地 `usage_ledger.rs` 主键为 `(source, request_key)`；Codex 同键不同 total 保留本地先到值，ZCode 同键不同 total 覆盖为最近导入值。这两种规则直接用于跨 PC 都可能依到达次序分叉。ZCode 现有键含本机路径，父代理已定位；这是业务身份问题，不是传输协议能修复的问题。

优先要求来源稳定 request ID + account namespace + 可验证 revision/finality。若来源没有 revision，不能谎称知道哪份新；候选保守规则是“相同规范化 payload 幂等合并；不同 payload 作为同一业务请求的争议版本保存并提示不完整”，或经用户接受后指定采集归属设备。后者必须明确复制日志与历史迁移限制。`max(total_tokens)` 仅在证明来源计数单调且总量定义一致后才成立，目前没有此证明。

## 需要 grill-with-docs 的用户决策

1. 已确认不维护常驻服务：现有可用的托管 WebDAV/S3 是哪一家；如果尚无，是否接受一次性申请和配置存储？不应首期同时实现两个适配器。
2. 已允许远端最小账目：是否必须端到端加密；办公网络能访问哪些端点？
3. 总量是“所有已配对 PC”还是“同一供应商账号”？切换账号要分开还是合计？
4. 同一日志会不会复制到多台 PC？对缺少权威 revision 的争议账目，接受标记待处理还是要求自动给出唯一数值？
5. 对同步延迟的接受程度，以及移除 PC 是停止贡献新数据还是抹除其历史？

## 收敛方案的关键细节（设计推断）

### 独立写者与账本复制

`device_id` 用于展示，`writer_epoch` 用于产生对象，`event_key` 用于业务去重，三者分开。writer 私钥/安装绑定 token 保存在 OS 安全存储，账本仅留其公钥或引用；仅复制 SQLite 到新机时缺少对应安全存储，因此自动创建新 writer。对象名还要含随机 batch ID 或内容 hash，旧序号复用不能覆盖不同内容。进程互斥阻止同一安装两个进程并发使用同一序列。

从同机旧备份恢复可能同时回滚序列和 outbox。启动时比对已发布对象，若同 `(writer_epoch, seq)` 不同内容，冻结旧 writer 的新写入并生成新 epoch，保留已有 outbox 和业务键进行幂等恢复。整个 OS 镜像连安全存储也克隆时，本机秘密无法证明设备物理唯一；不能承诺完美检测。随机 epoch/批次 ID 避免破坏性覆盖，发现重复序号时诊断，并提供“作为新电脑接入”恢复入口。该入口属于真实异常恢复，不应成为每次同步的必经按钮。

### 分页、缺号和完整性

固定前缀按 writer/epoch 分区，逐页收集不可变对象名；列表游标只是一轮枚举的临时状态，不能替代永久业务游标。对于 S3 使用 continuation token 直到结束；对于普通 WebDAV，目录枚举结果可能一次很大，因此按固定大小段目录分片，避免把所有历史对象塞进一个目录。

每批导入在事务中同时提交物化账目、inbox(batch ID/hash)和连续进度；先见 seq=3 再见 seq=1 不能把 2 永久跳过。远端 listing 期间有新上传时，下轮扫描补发现。可变 head 只是性能提示，丢失 head 或丢失列举项不能触发删除。首次导入结束只证明“本轮完整枚举的远端可见对象已应用”，不能证明所有离线设备都已上传；页面显示每台设备最后上传时间。

### 时间与冲突

原始请求时间仅用来按日统计；本机采集时间、云端 Last-Modified、设备 wall clock 都不能决定业务 revision 新旧。writer 内 sequence 只说明同一采集者观察顺序；跨 writer 没有自然真值顺序。离线时钟错误或倒退不影响唯一键和幂等导入。跨 writer 同事件不同内容必须依来源 revision/finality 判断，缺证据则保留争议状态而不是按时间选择看似最新的一份。

### 首次导入与长期规模

首次导入必须获取足以跨设备去重的请求键与版本，不能只下载每日累计。最坏网络与应用工作量随历史请求数 N 线性增长；分批压缩能减少请求次数和字节量，但不能消除请求级 identity 信息。首期使用有上限的批次大小、压缩后体积与解压体积限制、流式校验、事务小批导入、可重启进度以及取消后继续。页面先保留本机统计，标注全设备历史仍在导入，完成后再将全设备结果称为已汇总。

批次目标大小与具体轮询频率应通过真实服务基准确定，不能在未量测前承诺秒数。需要基准覆盖 1 年合成历史、多个 writer、慢网、对象分页，以及峰值内存。首期不引入 Merkle 树、自动压缩清理和通用插件接口；只有真实对象数量/费用达到边界后，再设计可验证覆盖范围的 checkpoint。首期适配器只暴露实际需要的 list/get/create 操作，避免预建多个服务集成。

## 建议验收矩阵

两套干净本地目录和选定真实存储：A/B 同时独立新增后总量一致；相同日志重复导入/跨机复制不翻倍；ZCode 同请求更新与逆序到达结果一致；A 离线新增+B 在线新增后恢复补齐；上传已成功但响应丢失；导入事务中断重启；对象缺号/分页/乱序/损坏；凭据过期/密钥错误；复制账本初始化新 PC；源日志删掉及远端对象短暂缺失不丢历史；跨时区展示仍按原始时间计算。不能用单机 mock 通过代替两设备真实往返验证。

可复现取证命令：GitHub REST `GET /repos/{owner}/{repo}`、`GET /repos/{owner}/{repo}/commits/{default_branch}`；按上述固定 SHA 读取 raw.githubusercontent.com 源文件。运行环境：PowerShell 7.6.5、Windows，本次仅阅读源码及官方文档。没有性能/兼容性/安全审计结论。

## 互联网网盘补充调研（2026-10-13）

### 可直接给用户选择的结论

| 选择 | 用户需要做什么 | QuoDex 侧工作与限制 | 推荐场景 |
| --- | --- | --- | --- |
| 坚果云官方 WebDAV | 注册/登录普通账号，生成一个应用密码，在 QuoDex 填一次账号和应用密码 | 无需注册开发者应用；实现 HTTP WebDAV、限流预算和目录分页/分片，首期成本最低 | 如果用户没有网盘偏好，建议优先选；适合少量 PC 的小账目 |
| OneDrive 官方 Graph | 用户在微软授权页登录同一账号；应用注册由 QuoDex 开发方一次完成 | 官方原生 public-client OAuth + PKCE，可免常驻中转服务；需注册应用、处理同意授权及办公网络可达性 | 已使用 OneDrive，希望完整原生登录体验 |
| 百度网盘官方 API | 个人自用路径需要完成开发者实名认证、创建“个人使用”应用并配置自己的 AK/SK，再授权网盘；或使用以后由 QuoDex 正式发布的已审核应用 | API 支持所需传输；当前可刷新授权要求应用 secret，公开桌面客户端的 secret 保密无法解决，需另选定期重新授权或可信 token 服务 | 明确要复用百度账号，并愿接受一次开发者配置或授权体验代价 |
| 网盘官方客户端同步文件夹 | 每台 PC 安装、登录官方客户端并选相同远端同步目录 | QuoDex 只导出/导入不可变对象；不能精确证明客户端已上传，无法自行保障一分钟端到端到达 | 已有可靠双向同步目录且接受额外客户端和延迟不可控 |

“互联网网盘”与“无需维护服务器”可以兼容。直接 API/WebDAV 是 QuoDex 自己与平台通信；同步文件夹是网盘客户端替 QuoDex 运输，两者的授权、可观测性与延迟不同。本次没有找到百度提供官方 WebDAV 的依据，不将任何第三方 WebDAV 代理当作百度官方能力。

### 百度网盘：最新准入不是一律必须企业或公开审核

本次 web 浏览工具无法打开百度文档正文，随后用 PowerShell 7 `Invoke-WebRequest` 匿名读取同一官方站点的公开 HTML 成功。旧 `union/doc/<短ID>` 当前可能返回简介；本报告改引迁移后的中文路径，已校验页面标题和更新时间，而非把 HTTP 200 当作命中目标文档。没有登录、没有进入真实账号控制台，也没有代用户申请。

- [实名认证介绍](https://pan.baidu.com/union/doc/使用入门/实名认证/实名认证介绍/) 当前页面标注 2022-03-24：允许个人与企业开发者；个人开发者需要身份证号码、邮箱、手机号，文档列出个人可创建 1 个应用并使用上传、下载、文件管理等基础能力，称可立即审核完成。材料与实际控制台额度可能随政策调整，本次未登录核实实际体验。
- [应用审核指南](https://pan.baidu.com/union/doc/使用入门/应用上线审核/应用上线审核试运行/) 标注 2026-08-03：选择“个人使用”，仅个人或小范围且不超过 10 人，创建后可用、免上线审核；“公开发布使用”自测后需正式审核，审核期间支持 10 人。审核要提供完整应用说明、测试指引、所需 API 清单和授权/业务演示视频；新增公开 API 权限须重新申请。不能把个人自用免审资格当成向所有 QuoDex 用户公开发布的资格。
- [接入流程](https://pan.baidu.com/union/doc/平台简介/接入流程/) 标注 2026-08-10：开发者认证后创建应用，取得 Appid、Appkey、Secretkey、Signkey，并配置 OAuth。普通最终用户通常只负责授权，开发者应用配置由应用提供方承担；但 QuoDex 若选择“每用户自有应用”来避开公开应用 secret 分发，则该用户需要做开发者配置，无法宣传成仅登录网盘就完成。

### 百度网盘：传输、OAuth 与费用边界

| 能力 | 已核实的官方接口/行为 | 对账本同步的影响 |
| --- | --- | --- |
| 文件列表 | [获取文件列表](https://pan.baidu.com/union/doc/基础网盘服务/获取文件信息/获取文件列表/)，2026-09-02，`GET /rest/2.0/xpan/file?method=list`，使用 `start/limit` 分页，建议每页不超过 1000 | 不把一页当全部；并发新增造成 offset 漂移时靠不可变 ID 去重与重新扫描补齐 |
| 单步上传 | [单步上传](https://pan.baidu.com/union/doc/基础网盘服务/上传/单步上传/)，2026-09-09，一次上传并创建文件，上限 2 GB；动态取得 HTTPS 上传域名；需上传权限及 `/apps/{appname}` 路径，支持 `ondup=fail` | 小账目批次适配，但生产权限需实测；不得用覆盖策略更新同名不可变对象 |
| 分片上传 | [预上传](https://pan.baidu.com/union/doc/基础网盘服务/上传/预上传/) 与 [分片上传](https://pan.baidu.com/union/doc/基础网盘服务/上传/分片上传/)，2026-09-09，预创建→分片→创建文件 | 通用后备流程，额外请求会影响约一分钟目标及配额；首期小对象无需夸大断点大文件收益 |
| 下载 | [下载](https://pan.baidu.com/union/doc/基础网盘服务/下载/)，2026-09-02，列表得 fs_id→filemetas 得 dlink→GET 内容；dlink 有效 8 小时，需指定 User-Agent 并带 access_token，可能 302 | 下载链接和 token 不能进日志；过期重新取链接；限定合法下载主机和重定向策略，避免泄露凭据 |

[设备码授权](https://pan.baidu.com/union/doc/使用入门/接入授权/设备码模式授权/) 明确：access token 有效 30 天、可刷新；换取和刷新均需要 `client_secret`；refresh token 单次使用，刷新响应的新 token 必须原子持久化；轮询设备码一般不得快于 5 秒。不同 PC 应各自独立授权保存凭据，不同步 refresh token，避免互相消耗一次性刷新凭据。[接入流程](https://pan.baidu.com/union/doc/平台简介/接入流程/) 推荐无 server 应用可使用简化授权，但不支持刷新，到期须重新登录。未查到官方 PKCE public-client 可刷新授权证据，不能承诺百度与 OneDrive 一样的无密钥桌面 OAuth 体验。

公开分发 QuoDex 时不能把同一个开发者 SecretKey 编进安装包假装保密。可行产品选择为：个人自有应用 secret 仅保存在本人设备安全存储；或应用公共 AppKey + 定期重新授权；或 QuoDex 方维护可信 token 服务。最后一种虽不要求用户运维，却新增项目方在线服务责任，不能在当前“免常驻服务”方案中偷偷加入。

[下载 FAQ](https://pan.baidu.com/union/doc/faq/下载/) 明确下载接口存在频控，但具体值不公开，下载速度跟账号会员身份有关。不能给出虚构 QPS，更不能将“每分钟一次计划”承诺为百度保证的一分钟到达。[应用审核指南](https://pan.baidu.com/union/doc/使用入门/应用上线审核/应用上线审核试运行/) 区分付费能力并要求付费合作上线前签约，但本次未找到基本 list/upload/download 的统一公开价格与免费调用量表；没有核实任何当前套餐对这些 API 保证免费或保证吞吐。不能把“个人使用免审核”推导成“所有 API 永久免费”。具体账号空间/会员价格和单步上传权限需在选定后由用户账号实际确认。

### 坚果云：最少接入步骤，但必须精算多 PC 请求

[官方 WebDAV 开启说明](https://help.jianguoyun.com/?p=2064) 提供普通用户生成应用密码的流程，无需 QuoDex 先申请开发者应用。限制为免费账号每 30 分钟 600 次请求，付费账号 1500 次；默认单文件 500 MB；单次列表含文件与目录最多 750 项，支持分页。应用密码不是只授权一个文件夹的证据：QuoDex 可约定只操作专用目录，但不能把客户端自律等同服务端目录级隔离，应配合客户端加密。

一分钟轮询的请求预算要按整个账号全部 PC 与其他 WebDAV 软件共享情况保守估计。例如 3 台 PC 每分钟各 1 次枚举，30 分钟是 90 次；若每台每分钟新增 1 个批次、另两台各取一次，则新增 90 次 PUT 和 180 次 GET，合计约 360 次，尚未计鉴权探测、目录操作、分页、重试与其他软件。此为模型推算，不能直接称免费版保证够用；writer 数或对象分页上升会破坏预算。空闲退避、有变更才上传、合并批次、每账号预算与限流提示必需。

750 项限制意味着一年每分钟一个文件不能全部堆在单一目录。固定分区、可遍历的封闭历史目录与“活跃目录提示”应设计清楚；如未核实坚果云分页扩展的具体协议，必须采用小于上限的有界目录，并对返回截断主动报错，禁止静默漏账。官方 [使用建议](https://help.jianguoyun.com/?p=9) 写免费版月上传 1 GB、下载 3 GB；该文较旧，当前网页仍公开提供，最终以账号套餐为准。[套餐页](https://www.jianguoyun.com/s/pricing) 本次未解析出可靠现价，因此不报未经核实的付费金额。

### OneDrive：原生 OAuth 较完整，网络与注册需验证

[Microsoft 原生桌面配置](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration) 明确桌面为 public client；[OAuth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) 要求原生客户端不用 secret，可结合 PKCE 与 `offline_access`。QuoDex 开发方注册一次支持个人 Microsoft 账号的 Entra 应用，最终用户在微软页面登录授权；不需要用户自己长期运行服务或每人注册开发应用。开发方当前是否已有可用租户/注册权限尚未核实；办公组织账号也可能有管理员同意策略，不保证所有企业账号都可直接授权。

[App folder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder) 支持 `Files.ReadWrite.AppFolder` 范围，仅限对应应用目录，个人与工作/学校 OneDrive 均有文档说明；用户仍可删除其中文件。传输支持 [单请求上传 ≤250 MB](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0)、[下载内容](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)。下载会 302 到短期预授权地址，对该地址不要附带 Authorization。可优先研究 [delta 增量与 nextLink 分页](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0)，但 delta 文档权限表未显式列出 AppFolder，因此首期不能未经试验宣称仅 AppFolder 权限必可使用任意子目录 delta；安全的后备是应用目录 children 枚举，权限与增量能力须一起验收。

[Graph 限流指南](https://learn.microsoft.com/en-us/graph/throttling) 要求 429 按 Retry-After 退避，无该头则指数退避，建议增量跟踪避免高频全集扫描；不能将其他 Graph 服务表的 60/min 数字误当 OneDrive 限额。[Microsoft 存储 FAQ](https://support.microsoft.com/en-au/onedrive/microsoft-storage-faqs) 说明普通免费账号 5 GB，共享于 OneDrive 和其他 Microsoft 存储用途。[Graph 计费 API 列表](https://learn.microsoft.com/en-us/graph/metered-api-list) 当前所列特例不包括本文常规文件读写，但这不是无限调用和未来永久免费承诺；付费空间价格未在本次核实。

### 直接 API 和官方客户端文件夹不能混为一谈

坚果云 [官网](https://www.jianguoyun.com/) 明确介绍任意文件夹同步与 WebDAV 两条能力。若走同步目录，QuoDex 的职责仅是原子写入封闭批次、校验收到的批次并幂等导入；不能将“本地文件已写好”显示成“云端已同步”。官方客户端退出、网络暂停、占位文件未下载时，QuoDex 最多判断已发现的远端批次，无法保证完整性或一分钟目标。

本次未找到百度官方客户端在当前账号套餐、Windows/macOS 版本下“同步空间/自动备份”可作为双向目录运输的一致规格，故将其标记为未核实。单向自动备份不足以实现 A→云→B→云→A；不能因为客户端有“备份”按钮就认定支持两端同步。也没有安装 Alist、第三方代理或访问真实账号来绕过官方准入。

补充验收要求：选定一种网盘后，用测试目录进行首次上传/列表分页/下载往返、重启刷新凭据、限流退避、两套设备目录并发、长期列表规模和带宽预算验证，观测正常小批次约一分钟的实际分布。上述文档研究仅证明接口与准入有依据，不证明 QuoDex 已接通。
