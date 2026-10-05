# Codex 和 ZCode token 用量探测调研

调研日期：2026 年 10 月 5 日。范围由用户确认：QuoDex 浮窗展示的 Codex 和 ZCode 两个来源。

**结论：两者均能在本机自行统计 token 消耗，无须调用官方用量汇总接口。** Codex 可读取会话日志的逐请求用量，ZCode 可读取 SQLite 的 `model_usage`，由 QuoDex 负责去重、累计和保存。原始计数仍来自模型响应或客户端记录；如果连这些数字也不采用，完全自行分词只能得到可见文本的估算。两者需要明确标注统计范围，不能用额度百分比反推 token 数。

状态：取数可行性 **Verified**；QuoDex 产品接入 **Not built**。本次只增加研究记录，没有修改产品代码、发起模型请求、推送或发布。

## 实测结果和范围

来源版本：QuoDex `12a9cba61c22eac3b7dfe1f63f13e9ced466ccbe`，`package.json` 版本 `0.3.0`。环境：macOS `27.0.1`，ZCode `3.14.4`，项目内 Codex CLI `0.147.0`，本机 Codex CLI `0.160.0`。以下是研究期间的快照，运行中的任务可能使后续读数变化。

| 来源 | 实际读取 | 范围和结果 |
| --- | --- | --- |
| Codex | `account/usage/read` | 两个 CLI 版本都成功返回 `summary.lifetimeTokens = 7,544,973,578`，每日统计桶共 81 个 |
| Codex | 服务端每日桶 | `2026-10-05` 桶为 `25,958,540`；服务端日期边界和更新延迟尚未确认 |
| ZCode | SQLite `model_usage` | 现存 7,285 条请求记录，`SUM(computed_total_tokens) = 1,516,123,893`；这是本机留存数据的合计 |
| ZCode | 单条请求样本 | 输入 `88,240`，输出 `1,193`，缓存读取 `87,040`，总数 `89,433` |

这两项合计没有相同的时间和设备范围，不能直接据此比较两个来源谁更省 token。token 活动数也不能直接解释成套餐扣费或人民币费用。

## 自行统计的方式和实测

| 方式 | 原始数据和我们负责的部分 | 可验证程度 |
| --- | --- | --- |
| 本地自行记账 | 读取逐请求用量，由 QuoDex 按来源、日期、项目和聊天去重汇总；可保存自己的历史 | 普通聊天和 ZCode 请求记录已实际验证，不调用官方用量接口 |
| 完全自行分词 | 使用匹配模型的 tokenizer 对完整实际输入和可见输出计数 | 方案可行，但本次未运行分词器；缺少隐藏内容时只能称为估算 |

Codex 新格式 rollout 的 `token_usage_record.payload.usage` 是单次用量，`turn_token_usage` 和 `thread_token_usage` 是累计快照。独立统计应按 `(thread_id, response_id)` 去重后累加 `usage`，保留原始时间和归属。SQLite `threads.rollout_path` 用于定位文件；整个流程可以离线执行。

四个没有 fork、没有压缩、初始记录完整的根聊天，离线独立汇总分别得到 `4,435,404`、`5,130,376`、`1,955,180`、`3,204,612` tokens，均与各自本地 SQLite 累计一致。其中第一条有 53 个独立响应，却有 55 条 `token_count` 通知；若直接相加后者的 `last_token_usage`，会错误得到 `4,618,454`。

以下示例在项目根目录执行，只统计该项目最近更新的一条本地聊天，并输出计数；它不处理 fork 历史归属，也不是完整的历史聚合器：

```sh
python3 - <<'PY'
import json
import sqlite3
from pathlib import Path

state = Path.home() / '.codex/state_5.sqlite'
with sqlite3.connect(state.as_uri() + '?mode=ro', uri=True) as db:
    db.execute('PRAGMA query_only=ON')
    db.execute('PRAGMA busy_timeout=1000')
    row = db.execute('SELECT rollout_path FROM threads WHERE cwd=? '
                     'ORDER BY updated_at DESC LIMIT 1',
                     [str(Path.cwd())]).fetchone()
seen, total = set(), 0
if row:
    with Path(row[0]).open() as stream:
        for line in stream:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue  # 正在追加的最后一行可能尚未写完。
            if record.get('type') != 'token_usage_record':
                continue
            payload = record['payload']
            key = (payload.get('thread_id'), payload.get('response_id'))
            if not key[1] or key in seen:
                continue
            seen.add(key)
            total += payload['usage']['total_tokens']
print(json.dumps({'unique_responses': len(seen),
                  'total_tokens': total if seen else None}))
PY
```

老日志可能没有 `token_usage_record`，可使用最新 `total_token_usage` 或累计差分作为回退，须处理重复通知。另有两条含压缩或缺少初始历史的大聊天，其逐请求汇总和旧累计字段并不一致；因此历史全量、fork 重放与压缩完整性仍需专项验证。建议从启用统计时建立基线，持续保存去重后的记录，并把缺失历史标为不完整，不把样本验证扩展成全历史保证。

ZCode 的自行统计已经是本地 SQL 汇总。可按 `model_usage.id` 保存请求记录，处理同一记录后续更新，并关联 session 父链；自己的数据库可保留超过源应用 30 天的历史。这是接入建议，尚未实现持久化、定时读取或产品界面。

如果完全不用模型返回的 `usage`，需逐次统计完整请求，而不能只把聊天最终显示的文本分词一次。实际请求还包含角色边界、工具 schema 和其他格式；不可见推理无法从正文恢复。[OpenAI token 计数文档](https://developers.openai.com/api/docs/guides/token-counting)、[推理模型文档](https://developers.openai.com/api/docs/guides/reasoning)支持这些限制。GLM-5.3 的[官方模型库](https://huggingface.co/zai-org/GLM-5.3/tree/main)提供 tokenizer 和聊天模板用法，但本次未下载或运行，也没有验证托管服务与该模板完全一致。缓存实际命中和收费同样无法单凭文本推断。

## Codex 读取方式

[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)明确提供 `account/usage/read`，返回 `summary` 和可选的 `dailyUsageBuckets`。指标可能为 `null`，应显示不可用而不是零。此接口要求 Codex 服务支持的认证；API key 和 Bedrock 认证不支持该接口。

启动一个独立 app-server，按顺序交互发送下面三条 NDJSON 消息。发送第二条前等待第一条初始化响应，发送第三条后等待 `id = 2` 的响应。不要发送 `turn/start`。

```sh
codex app-server --listen stdio://
```

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"quodex_readonly_research","version":"0.0.0"}}}
{"method":"initialized","params":{}}
{"id":2,"method":"account/usage/read","params":{}}
```

实测使用现有登录态，没有读取或打印凭据。沙箱内启动进程曾被拒绝，经自动批准的沙箱提升后，项目 `0.147.0` 和本机 `0.160.0` 都返回成功。`codex` 应替换为待验证版本的可执行文件；研究分别使用项目内和本机的现有可执行文件，没有下载升级。

接入点是 `src-tauri/src/capacity.rs` 的 `request_rate_limits`：目前调用 `account/rateLimits/read`，可沿用进程初始化和响应读取逻辑增加 token 查询，无须升级项目所带 CLI。额度百分比与 token 用量应保留独立字段和状态。

如果需要按聊天任务显示：

- 本机 `~/.codex/state_5.sqlite` 的 `threads.tokens_used` 可读到累计用量。QuoDex 项目目录下 53 个有 token 事件的会话，全部与对应 rollout 最新 `total_token_usage.total_tokens` 相等；其中 42 个值超过上下文窗口大小，因此该列在本机并非当前上下文占用量。
- rollout JSONL 的 `event_msg` / `token_count` 提供累计 `total_token_usage`、最近一次 `last_token_usage`，以及输入、缓存、输出和推理细分。累计快照不能逐行相加；缓存是输入的细分，推理是输出的细分，不能再次加到总数里。
- `thread/tokenUsage/updated` 是执行中聊天的协议通知。`thread/read` 本身不返回 token 用量、不订阅；独立启动的 app-server 不能据此声称订阅到了另一个 Desktop 进程的实时事件。本次没有验证跨进程订阅。

本地会话总和会受子 agent、fork 历史、删除记录和设备范围影响。若需要服务端账号累计，可选用 `account/usage/read`；本机自行统计则采用上一节的逐请求记录。不能把简单 `SUM(threads.tokens_used)` 称为账号全域消耗。

## ZCode 读取方式

[ZCode 官方使用统计文档](https://zcode.z.ai/cn/docs/usage-stats)区分本机的“应用用量”和远端的“编程套餐”。本机数据库位于 `~/.zcode/cli/db/db.sqlite`，当前已有 `model_usage`、`turn_usage`、`tool_usage` 三张统计表。

安装包 [runtime 的 `queryAppUsage`](/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs:1816) 使用 `SUM(model_usage.computed_total_tokens)`；时间范围由 `started_at` 筛选，没有额外排除 `status` 或 `query_source`。因此应用用量包括主请求、子 agent、标题生成和完成检查等后台请求；失败请求有已记录 token 时也计入。`turn_usage` 是轮次汇总，不能和 `model_usage` 相加。本机两张表总数也不完全一致。

下面命令只读取数字字段，使用 SQLite 只读连接，不访问聊天正文、配置或凭据：

```sh
python3 - <<'PY'
import json
import sqlite3
from pathlib import Path

path = Path.home() / '.zcode/cli/db/db.sqlite'
with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
    db.execute('PRAGMA query_only=ON')
    db.execute('PRAGMA busy_timeout=1000')
    fields = ['input_tokens', 'output_tokens', 'reasoning_tokens',
              'cache_creation_input_tokens', 'cache_read_input_tokens',
              'computed_total_tokens']
    row = db.execute('SELECT COUNT(*), ' + ', '.join(
        'SUM(' + field + ')' for field in fields
    ) + ' FROM model_usage').fetchone()
    print(json.dumps(dict(zip(['request_rows'] + fields, row))))
PY
```

接入点是 `src-tauri/src/zcode_tasks.rs`：已经以 `SQLITE_OPEN_READ_ONLY` 打开任务索引和该数据库，可沿用只读策略读取统计字段。按时间查询须先约定时区和范围；按项目查询可用 `tasks-index.sqlite` 的 `task_id` 关联根 `session.id`，再沿 `session.parent_id` 汇总 `task_type = 'subagent_child'` 的后代。本机 30 个未删除根任务都匹配到 session；不能把普通 fork 自动归为子 agent 消耗。

读取必须保留以下边界：

- [`recordModelUsageFact`](/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs:14588) 在单次模型请求完成、失败或取消后写入；长执行轮次中能逐请求增长，但正在输出的单次请求尚无完整用量。
- `recordTurnUsageFact` 在整个执行轮次结束后写入，不能用轮次表假定正在实时更新。
- [`pruneUsage`](/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs:1816) 默认保留 30 天，并在写入统计时清理旧记录。因此本机“全部”表示当前留存记录，不能标成账号终身总量；若要长期趋势，需要另行设计本地快照和去重。
- 本机样本所有请求的 `computed_total_tokens = input_tokens + output_tokens`。缓存已包含在输入里；不能把缓存字段再次加上。其他 provider 的语义需按其真实记录核验。
- 单任务 UI 的 [`queryTaskUsage`](/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs:1877) 使用相邻输入差值，且仅查当前 session；它与完整模型请求 token 累计不同，也不自动汇总子 agent。

安装包还存在内部 RPC `v4/usage/stats`、`v4/conversation/usage`，经 stdio 连接使用，没有证据表明它们是公开的本地 HTTP GET 接口。远端 `/api/monitor/usage/model-usage` 等接口可作为账号套餐统计的候选，但本次没有发凭据调用，状态是 **Not built**，不能以本地读取成功代替远端验证。

## 现成方案和接入建议

代码层面比较了 CodexBar、ccusage 和 tokscale；三者 LICENSE 均为 MIT，研究时三者都有 2026 年 10 月 5 日的提交。它们主要解决 Codex 日志累计、缓存拆分、fork 或 replay 去重，未发现可直接替换 ZCode 统计读取的组件。

| 方案 | 可借鉴的实现 | 适配成本和风险 |
| --- | --- | --- |
| [CodexBar](https://github.com/steipete/CodexBar) | [`CostUsageScanner.swift`](https://github.com/steipete/CodexBar/blob/6a26b2e9b1b60471970deb6fe663f9e5f284e2ce/Sources/CodexBarCore/Vendored/CostUsage/CostUsageScanner.swift) 的用量扫描和 fork 基线处理 | Swift 扫描器可参考；引入整个桌面应用成本高，账号和浏览器凭据逻辑超出本项目需要 |
| [ccusage](https://github.com/ccusage/ccusage) | [`parser.rs`](https://github.com/ccusage/ccusage/blob/5465bda47db7efaa7333361a80cd3070eeaa49b3/rust/adapters/codex/src/parser.rs) 的 Codex session 聚合；处理 replay、压缩和重复响应 | 适合独立 PoC 或交叉校验；产品若依赖它需固定版本，仍受日志格式变化影响 |
| [tokscale](https://github.com/junhoyeo/tokscale) | [`sessions/codex.rs`](https://github.com/junhoyeo/tokscale/blob/d4d1c751856e25913bce97bfbd7b254308863239/crates/tokscale-core/src/sessions/codex.rs) 的 session 身份去重和缓存／推理口径 | 与现有 Rust 技术栈接近；可借鉴解析思路，需处理 fork 与子 agent 重放 |

**推荐：两个来源统一采用本机自行统计，Codex 读逐请求日志，ZCode 读只读 `model_usage`。** 两条路径已有真实数据证据；参考成熟解析器处理去重和历史边界，由 QuoDex 维护自己的统计记录。首期定义为本机、从启用统计起的累计，另列可恢复的历史；官方账号接口作为可选交叉核对。聊天细分放在任务详情中，界面方案尚未设计或实现。

## 验证和下一步

已执行：读取项目规范和既有 ADR；实际打开两家官方文档；检查两个 Codex 版本协议并实际调用 token 接口；离线核对四个普通根聊天的逐请求累计；只读查询 ZCode schema 和计数；对照安装包的统计与清理调用链；核对三个参考项目源码。

实际结果：两条推荐路径都返回真实数字；没有访问模型生成端点，没有修改源应用数据。本次产物是研究记录，没有新的 QuoDex 构建产物；产品构建、产品测试和 UI 冒烟不能用于宣称 token 功能已经接入。

下一步建议：以本机自行统计写接入验收标准，决定累计、每日、项目和单聊天的展示范围。需验证空值、数据库忙、schema 变化、子 agent 归属、重复累计、压缩和更新延迟。额度与 token 数保持独立，不承诺通过它们换算费用。
