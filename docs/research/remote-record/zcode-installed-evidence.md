# 本机 ZCode 程序包：用量身份与修正证据

采集日期：2026-10-13。只读检查安装程序文本与安装版本元数据；未打开用户聊天 SQLite、日志或凭据；未连接网盘、未执行 ZCode CLI、未改动安装目录。以下为程序静态证据，未声称已运行生产数据迁移或原生 fixture。

## 来源与复核定位

- 安装程序：`D:/ZCode/ZCode.exe`；注册表安装版本 `3.15.1`。
- 程序包：`D:/ZCode/resources/glm/zcode.cjs`，15,126,820 bytes。
- SHA256：`B816E38656E70FB585FE2AB1EA010DA89CDA928DAC1CCB5D83255FD18796DA6E`。
- `D:/ZCode/resources/glm/.node-bundle-meta.json` 声明 source 为 `apps/zcode-cli/packages/cli/dist/zcode.cjs`，runtime=`electron-node`，platform=`win32-x64`。
- `D:/ZCode/resources/app.asar` 中 `package.json`：`@zcode/desktop` / `3.15.1`。
- 同 ASAR 中 `out/metadata/build-meta.json`：appVersion=`3.15.1`，buildCommitId=`f18d6db7`，buildTime=`2026-10-10T06:47:14.105Z`，electronBuilderVersion=`26.8.1`。
- 全部行号均指该 SHA256 的 `zcode.cjs`；压缩 JS 的单行可能较长，复核应按函数名在目标行截取，不整行输出。

## 身份生成：已证实

`modelUsageId` 的压缩名为 `jLa`，位于第 14596 行，零基字符偏移 12950756。其逻辑为：

```js
const base = request.assistantMessageId
  ?? request.traceContext.spanId
  ?? `${request.querySource}_${request.startedAt}`;
return `usage_model_${request.querySource}_${base}_${request.attemptIndex ?? 0}`;
```

因此 `model_usage.id` 本身不是一个单独 UUID，存在三条身份来源。证据链：

1. 第 93 行 `createMessageId` / `Ll` 默认返回 `msg_${createSortableIdSegment()}`；后者为 `Date.now().toString(36) + '_' + crypto.randomUUID()`。第 14674 行 `runModelStep` / `R6o` 每次生成 `Ll()`，传给 `y6a`，再由第 14662 行 `ePn` 传入 `recordModelUsageFact` / `a1`。
2. 没有 assistant message 的辅助请求使用 span ID。第 107 行 `_1r` 为 `crypto.randomUUID().slice(0,16)`；`MI` / `Ew` 创建该 ID；第 14483 行 `Jb` 包装 `Ew`。第 14596 行 `RMo` 的 MCP sampling 路径可看到 child trace 的调用。
3. 最弱 fallback 只有 querySource 和毫秒 startedAt；不存在跨机器唯一性保证。不能因为通常使用 UUID 就删掉身份边界条件。

`session_id` 可以增加独立会话的身份区分：第 93 行 `createSessionId` / `zv(e)` 返回 `sess_${e ?? crypto.randomUUID()}`。第 15449 行 protocol session/create 默认 `i.sessionId ?? zv()`，并禁止在没有 importedHistory 时传入 sessionId；第 15438 行 createZCodeApp 也默认生成 UUID。

边界：导入历史允许保留自定义 sessionId；subagent / workflow 等路径也有由调用者标识构造 session ID 的分支。故“默认新会话生成独立 UUID”已证实，“任意第三方导入永不碰撞”未证实。

## 原始表及更新：已证实

第 818–860 行建表包括：

- `id text primary key`
- `logical_request_id text not null`
- `attempt_index integer not null default 0`
- `session_id text not null references session(id) on delete cascade`
- `turn_id` / `trace_id` / `span_id` / `assistant_message_id`
- `query_source` / `provider_id` / `model_id`
- `status in ('running', 'completed', 'error', 'cancelled')`
- `started_at` / `first_token_at` / `completed_at` / duration
- input / output / reasoning / cache creation / cache read / provider total / computed total
- retry 及错误信息、raw usage / provider metadata

该 model_usage 表没有 source revision、updated_at、行版本号或 immutable-final 标记。

第 1659–1748 行 `recordModelUsage` / `p2r` 执行 `INSERT ... ON CONFLICT(id) DO UPDATE`，覆盖包含 session_id、status、started_at、completed_at、全部 token 的字段；没有按状态禁止再次更新，也没有比较新旧来源时间。应用接口 `recordModelUsage(t)` 在第 1950 行直接转发给 p2r。

第 14596 行 `recordModelUsageFact` / `a1`：

- `startedAt` 取调用者传入的开始时间；主要 model step 第 14674 行用 `Date.now()` 在请求前保存，成功/失败均传同一变量。
- `completedAt` 用写该用量事实时的 `Date.now()`；这是观察结束时间，不是可证明的数据库修订版本。
- `logicalRequestId` 优先 assistantMessageId，再 spanId，再 querySource+startedAt；attemptIndex 是重试次数维度，不是记录修订版本。
- 已读主请求、compact、辅助生成、MCP sampling 调用路径在完成/错误/取消后写入事实。schema 允许 running，不能据此声称所有历史版本都只写终态。
- computed_total 默认：input>0 取 input，否则 cacheCreation+cacheRead，再加 output；reasoning 是细分，不再追加总量（第 1659、1950 行）。

SQL upsert 允许任意修正，包括下降；没有证据证明 completed 永不可变。不能用 max(token)、最后下载者覆盖、completed_at 较晚、QuoDex 本机 updated_at 较晚来作跨机事实仲裁。

## 统计与保留期：额外已证实

第 1876–1910 行 `queryAppUsage` 直接按 started_at 时间范围 sum(computed_total_tokens)，不筛 status。因此 ccusage 的 completed-only 口径不应替代 QuoDex 原统计合同。

第 1950 行保留期常量为 30 天；第 1876 行 `pruneUsage` 每次删除 started_at 早于阈值的 model_usage / turn_usage / tool_usage。QuoDex 独立账本有保留价值；同步迁移不可假设旧源行始终仍可重扫。

## 对实现的建议（推断）

1. 新观察记录的同步 identity 至少取长度前缀编码的 `(zcode, native_session_id, native_model_usage_id)` 再 hash，独立于安装路径和采集 device。相同原始 SQLite 复制到不同路径仍保留这两个字段；普通独立新会话由 UUID session 身份区分。设备只进入 provenance / delivery sequence。
2. 对无 native session ID 的旧账目不要猜测恢复，不从旧路径 hash 反推。仍能从源表读到的行可建立显式 old_key → new_identity 对照；已经被 30 天修剪的旧账目无法凭当前账本字段恢复 session_id，应继续本地保留并标记跨机身份未迁移，或走用户明确确认的 legacy source namespace，不能悄悄重复上传。
3. 相同 key 不同受统计字段保留争议候选，显示 partial 小计；完整 payload hash 应包含 source timestamp 和统计细分。该方案比凭观察时间选胜者更稳妥，但不能自动恢复来源无 revision 的修订历史。
4. 首轮支持范围应写明“已验证安装版本 3.15.1 的默认生成身份与原始数据库复制”；历史导入自定义 session ID、其他版本格式和 fallback 碰撞需用匿名 fixture 验证并让冲突可见。
5. 不能把本次静态证据写成双 PC 真机验收。应补匿名 SQLite fixture：相同路径独立 session、不同路径相同 session/id、同 id 不同 session、同 key total 下降、token总数不变但细分更正、源行修剪后的 legacy 映射缺失。

## 复现命令要点

使用 PowerShell 7：`Get-FileHash -Algorithm SHA256 D:/ZCode/resources/glm/zcode.cjs`；`rg -n -o '.{0,120}(modelUsageId|logicalRequestId|recordModelUsage).{0,260}' D:/ZCode/resources/glm/zcode.cjs`。读取 schema 指定 818–860 行与 upsert 1659–1748 行。ASAR 仅读取 header 与上述两个 metadata entry，未解包整个应用、未运行其代码。
