# 百度官方 HTTP adapter 契约取证

日期：2026-10-13。只匿名读取官方公开文档，没有访问任何真实网盘、调用数据 API、申请应用或测试真实授权。以下 fixture 为人工构造的协议示例，不能作为真实服务验证结果。`method`、路径、参数名与字段类型来自官方；重试/安全策略另标为实现建议。

## 先处理的文档冲突

1. **单步上传与 locateupload 前置冲突**：2026-09-09 的[单步上传](https://pan.baidu.com/union/doc/基础网盘服务/上传/单步上传/)称无需预上传，但必须动态获取上传域名；同日[获取上传域名](https://pan.baidu.com/union/doc/基础网盘服务/上传/获取上传域名/)却要求必填 `uploadid`，且必须与当前预上传任务一致。不能凭空用空 uploadid，也不能硬编码服务器绕过去。无真实网盘验证阶段，推荐完整预上传→locateupload→分片→create 链；或实现单步函数但不将其宣称为完整可运行主链。不存在已证实的“无需 uploadid 的 host discovery”契约。
2. **device/token 表格有过时字段**：[设备码授权](https://pan.baidu.com/union/doc/使用入门/接入授权/设备码模式授权/)的完整 URL/cURL 使用 `grant_type=device_token&code=...`，但下方参数表仍写 `response_type=token`，没有列 `code`。按完整请求示例实现，记录此差异；不要把 OAuth 请求写成 `device_code=<...>` 或标准 RFC 的 grant URI。
3. **上传成功不一定返回 errno**：单步与分片上传示例没有 errno；locateupload 用 `error_code`，而 XPan 多数接口用 `errno`。必须按端点解析成功结构，不能全局默认“缺 errno 是成功”，也不能全局 require errno。
4. **云端 MD5 不作为内容可信证明**：list 明确 md5 可能不是文件真实 MD5，而 filemetas 描述为内容 MD5；已有下载 FAQ 也说明可能不同。QuoDex 幂等冲突验证应下载并用自己的 SHA-256/AEAD 校验，不使用 list 的 MD5 相等作为唯一证据。

## 共同规则

- 使用 HTTPS。`access_token` 在官方请求 query 中，故所有 URL、HTTP error、重定向位置及调试日志必须脱敏；不要输出 SecretKey、设备码或 refresh token。
- URL query 与 form encoding 用库进行一次编码，不能手工拼接中文应用名或重复 URL encode。远端作用域限定 `/apps/<APP_NAME>/...`，APP_NAME 是申请时产品名，不是 API key 或 AppID。
- API 常以 HTTP 200 返回业务错误；先识别 HTTP/内容类型及体积，再解析 JSON 和业务码。`errno` 在公共错误文档为 string、具体接口为 int，建议兼容纯整数 JSON number/string；`request_id` 也兼容 number/string。`fs_id` 是 uint64，禁止经 JavaScript 浮点数往返。
- [公共错误码](https://pan.baidu.com/union/doc/平台简介/错误码/) 2026-08-13：`20012/31034` 限流，`20013/31024` 权限不足，`20016` token 过期，`20017/31045/-6` 认证问题，`20020` 越过应用路径，`-3/-9/31066` 对象不存在，`-10` 空间不足，`31061/-8` 对象已存在（具体取决于端点），`31360` URL 过期。`-7` 可同时是路径错误或权限，不能一律解释为不存在。
- 本文所有“应”均为 QuoDex 实现建议，不是百度对一致性/幂等性的保证。

## 1. Device OAuth

来源：[设备码模式](https://pan.baidu.com/union/doc/使用入门/接入授权/设备码模式授权/)，页面 2022-04-13；[OAuth 错误附录](https://openauth.baidu.com/doc/appendix.html)，页面最后更新 2026-07-03。

### 获取设备码

`GET https://openapi.baidu.com/oauth/2.0/device/code`

Query：`response_type=device_code`、`client_id=<AppKey>`、`scope=basic,netdisk`。官方 cURL 附 `User-Agent: pan.baidu.com`。

成功必需字段：`device_code:string`、`user_code:string`、`verification_url:string`、`qrcode_url:string`、`expires_in:int秒`、`interval:int秒`。无 errno 成功结构。

```json
{"device_code":"fixture-device","user_code":"ABCD1234","verification_url":"https://openapi.baidu.com/device","qrcode_url":"https://openapi.baidu.com/device/qrcode/fixture/ABCD1234","expires_in":300,"interval":5}
```

`verification_url` 是用户输入 user_code 的授权页，不能把 qrcode_url 当浏览器授权完成地址。也可按官方格式构造 `https://openapi.baidu.com/device?display=mobile&code=<user_code>`。授权 URL 主机仅接受明确官方 allowlist，禁止任意返回 URL 触发 shell/open。

### 轮询换 token

`GET https://openapi.baidu.com/oauth/2.0/token`

Query：`grant_type=device_token`、`code=<device_code>`、`client_id=<AppKey>`、`client_secret=<SecretKey>`。没有 `redirect_uri`；未证明需要发送 `response_type`。

轮询遵守返回 interval，同时注意官方文字要求请求间隔 **大于 5 秒**；建议最小 6 秒，而不是固定 1 秒。到 device code 有效期终止。官方要求总次数少于 expires_in/interval。

成功：`access_token:string`、`expires_in:int秒`、`refresh_token:string`、`scope:string`；可能有 `session_key/session_secret`，本功能不用。

```json
{"access_token":"fixture-access","expires_in":2592000,"refresh_token":"fixture-refresh","scope":"basic netdisk"}
```

失败为 OAuth 风格 `{"error":"authorization_pending","error_description":"fixture pending"}`，不是 XPan errno：

| error | 处理 |
| --- | --- |
| authorization_pending | 用户未确认，间隔后继续，保持同一 device code |
| slow_down | 轮询过快，提高间隔，不即刻重试 |
| authorization_declined | 用户拒绝，结束，不自动重新发起 |
| invalid_client | AK/SK 无效，要求修复配置 |
| invalid_grant | 凭据无效/过期/撤销/已使用，结束当前流程 |
| expired_token | 官方表对应 refresh token 已使用/过期；应按所处流程处理 |
| invalid_request / invalid_scope / unauthorized_client / unsupported_grant_type | 配置/请求不可用，不无限重试 |

`access_denied` 不是此次百度文档中的拒绝字符串，不能仅识别它而漏掉 `authorization_declined`。

### 刷新

同一 token endpoint，`GET` query：`grant_type=refresh_token`、`refresh_token=<current>`、`client_id`、`client_secret`；成功结构同上。文档称 access token 30 天，refresh token 有效期 10 年但**只能使用一次**。若 API 明确返回刷新失败，旧 refresh token 失效，须重新授权；不要沿用旧值循环重试。

实现建议：并发 single-flight，刷新成功与新旧凭据替换原子持久化。网络超时存在“服务端已刷新但响应丢失”的未知结果，不能像幂等 GET list 那样盲重试并宣称安全；标记需重新授权或待恢复。每台 PC 保存独立授权凭据，绝不同步 token 文件。

## 2. 文件 list

来源：[获取文件列表](https://pan.baidu.com/union/doc/基础网盘服务/获取文件信息/获取文件列表/)，2026-09-02。

`GET https://pan.baidu.com/rest/2.0/xpan/file`

Query：`method=list`、`access_token`、`dir=<absolute path>`、`order=name`、`desc=0`、`start=0`、`limit=1000`、`folder=0`。`dir` 默认 `/`，实现必须显式给应用目录。`limit` 默认及建议上限 1000。文档也列 num/page，但不要混用两套分页。

响应允许顶层 `list` 或 `data.list`；顶层 `errno` 成功/失败均返回，存在 `data.errno` 时也检查。条目：`fs_id:uint64`、`path:string`、`server_filename:string`、`size:uint`、`isdir:0|1`、时间戳等。只返回文件夹的 `folder=1` 可能只给 path，故本同步推荐 folder=0。

```json
{"errno":0,"request_id":123,"list":[{"fs_id":123456789012345,"path":"/apps/Fixture/objects/a.bin","server_filename":"a.bin","size":42,"isdir":0}]}
```

分页官方按 `start+limit` 继续。没有已核实的通用 `has_more`。实现建议：短页结束，满页必须继续（含最后额外空页）；不能以“当前页全都见过”结束。offset 在并发新增下不保证快照一致，应稳定排序、按 ID/hash 去重，并安排补扫。禁止从单次缺项推导业务删除。缺 list 而 errno=0 属于协议异常，不要默认空列表。

## 3. 动态上传服务器

来源：[获取上传域名](https://pan.baidu.com/union/doc/基础网盘服务/上传/获取上传域名/)，2026-09-09。

`GET https://d.pcs.baidu.com/rest/2.0/pcs/file`

全部必填 query：`method=locateupload`、`appid=250528`（**官方写固定该值，不是本 appid**）、`access_token`、`path`、`uploadid=<precreate返回>`、`upload_version=2.0`。

```json
{"error_code":0,"error_msg":"","request_id":"fixture","expire":60,"host":"c.pcs.baidu.com","servers":[{"server":"https://c3.pcs.baidu.com"}],"bak_servers":[],"quic_servers":[],"server_time":1800000000}
```

选 `servers[].server` 中 HTTPS origin，保留协议；不要对已有 https URL 再拼 https。官方示例还有 `https://panup.pcs.baidu.com`（QUIC 列表），不应直接把 QUIC 当普通 HTTP fallback。`host` 是裸推荐主机名，优先遵循官方指定 servers。过期或不可用重新定位，不长期缓存或硬编码。

官方未给完整永久域名白名单。实现可严格仅接受已研究的 HTTPS `.pcs.baidu.com` 主机并拒绝 userinfo/自定义端口/path/query，把新主机视为需显式审查，而不是静默放开全部网络；这是可能降低兼容性的 fail-closed 策略，不是“官方保证所有 host 永远该后缀”。local fake HTTP origin 只能通过测试构造注入，不能放宽生产凭据转发规则。

## 4. 单步上传（入口函数可实现，整体前置尚有文档矛盾）

来源：[单步上传](https://pan.baidu.com/union/doc/基础网盘服务/上传/单步上传/)，2026-09-09。

`POST <located HTTPS origin>/rest/2.0/pcs/file`

Query：`method=upload`、`access_token`、`path`、`ondup=fail`。body：`multipart/form-data`，二进制 part 名为 **file**。header `User-Agent: pan.baidu.com`。由 multipart 库生成 boundary，不能手设裸 Content-Type。

`ondup` 可选 fail（默认）、overwrite、newcopy；账本只用 fail。成功字段 `path,size,ctime,mtime,md5,fs_id,request_id`，errno 可以缺失。业务失败 `31061` 表示同路径存在，`31024` 未开上传权限，`31064` 路径错误。响应可能 HTTP 200；不能把 31061 当作无条件上传成功，必须读取已存在对象校验。

```json
{"fs_id":123456789012345,"path":"/apps/Fixture/objects/a.bin","size":42,"ctime":1800000000,"mtime":1800000000,"md5":"fixture-cloud-hash","request_id":"fixture"}
```

文档上限 2 GB，QuoDex 必须另设远小于此的批次/解压大小上限。完整单步流程的 uploadid 矛盾见开头，local fake 不能证明空 uploadid 在百度可用。

## 5. 完整上传链候选

来源：[预上传](https://pan.baidu.com/union/doc/基础网盘服务/上传/预上传/)、[分片上传](https://pan.baidu.com/union/doc/基础网盘服务/上传/分片上传/)、[创建文件](https://pan.baidu.com/union/doc/基础网盘服务/上传/创建文件/)，均 2026-09-09。

1. `POST https://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=...`，form：`path,size,isdir=0,autoinit=1,block_list='["32位小写MD5"]'`，可选 `rtype`。小于等于 4 MB 的批次为一个分片。成功 `{errno:0,uploadid,path,return_type,block_list:[0]}`；响应 block_list 是**需要上传的序号**，不是 MD5。当前官方页面明确写 **响应 block_list=[] 等价于 [0]**，所以小批次仍上传第 0 分片，不能跳过或当作秒传已完成。非空仅上传返回索引，拒绝越界/重复非法索引。
2. 用该 uploadid 调 locateupload。
3. `POST <origin>/rest/2.0/pcs/superfile2`，query：`method=upload,access_token,type=tmpfile,path,uploadid,partseq=0`，multipart `file` 为该分片。成功 `{md5,request_id}`，errno 可缺失，返回 md5 与分片本地 MD5 对比。
4. `POST https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=...`，form：`path,size,isdir=0,uploadid,block_list='["上传结果MD5"]',rtype=0`。成功需 errno=0、path/size/fs_id 等符合预期。`-8` 为目标已存在，必须下载并校验后才视为幂等成功；`-7` 路径/权限，`-10` 空间满，`10` 创建失败，`31190/31363` 分片/大小不一致等不能变成“已同步”。

**另一个文档空白**：create 文档明确 rtype=0 冲突失败且与 precreate 保持一致；precreate 表仅列 1/2/3，没列 0 的语义/默认值。不能用 rtype=3 绕过“不覆盖不可变文件”的合同。建议请求 `rtype=0` 保持预期并标记未真实验证，若服务拒绝则报明确不兼容诊断，不自动改成覆盖/重命名。随机批次名+内容验证减少冲突，但不消除协议契约空白。

## 6. filemetas + 下载

来源：[查询文件信息](https://pan.baidu.com/union/doc/基础网盘服务/获取文件信息/查询文件信息/)与[下载](https://pan.baidu.com/union/doc/基础网盘服务/下载/)，2026-09-02。

推荐已持有 list fs_id 的确定链：

`GET https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&access_token=...&fsids=[123456789012345]&dlink=1`

`fsids` 是 URL 编码 JSON uint64 数组，最多 100；无需设置 thumb/extra/needmedia/from_apaas。`from_apaas=1` 是付费极速流量权益，本实现不要擅自发送。

```json
{"errno":0,"errmsg":"succ","request_id":"fixture","list":[{"fs_id":123456789012345,"path":"/apps/Fixture/objects/a.bin","filename":"a.bin","isdir":0,"size":42,"dlink":"https://d.pcs.baidu.com/fixture-download?sign=fixture"}]}
```

顶层 errno 与条目可选 errno 都检查；根据 fs_id 匹配，不假设 list 顺序或第一项必是所求。`dlink` 只有请求 dlink=1 才返回；缺项、目录或缺 dlink 不是空文件。

文档另外支持 `GET /rest/2.0/xpan/file?method=meta&path=...&dlink=1` 和 POST 路径批量 filemetas，这两者不要与 multimedia/fsids 参数混搭；首期只选一套。

下载 `GET <dlink>` 并用 URL query API 加/替换 `access_token`，header **User-Agent: pan.baidu.com**。dlink 有效约 8 小时；失效重新取 filemetas。可能 HTTP 302，官方要求跟随；没有完整官方域名清单，文档写“以 dlink 实际域名为准”。不能因为是官方返回链接就无限制带 token 跟随任意 host。建议按明确可信 HTTPS host 策略逐跳检查（含 IPv4/IPv6 loopback、userinfo、端口），每跳有数量上限；新增可信 CDN host 后续真实验证时再确认。若仅白名单 pcs.baidu.com，必须记录可能拒绝合法 CDN 的兼容性限制。

不要将 OneDrive 预授权 URL 的“不加 token”规则套到百度：这里官方明确要加 access_token。同样不可把下载返回的 JSON 错误体当作加密对象；先检查状态/预期大小/应用内容校验，限制总读取字节。`Range` 可选，首期小对象可以不做断点下载。

## 7. mkdir

来源：[创建文件夹](https://pan.baidu.com/union/doc/基础网盘服务/创建文件夹/)，2026-09-09。

`POST https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=...`

Content-Type `application/x-www-form-urlencoded`；form：`path=/apps/Fixture/objects`、`isdir=1`、`rtype=0`。**不要传 size/block_list/uploadid**。可选本地秒级时间戳/mode 不需要。

```json
{"errno":0,"status":0,"fs_id":123456789012346,"path":"/apps/Fixture/objects","isdir":1,"category":6,"request_id":"fixture"}
```

`-8` 已存在可进一步查询确认是目标目录，再视为幂等成功；不能吞掉“同名文件已存在”。`-7` 路径/权限错误，`-10` 空间满。文档没有明确递归创建父目录的保证；按应用根到子目录逐级建，不能假设 mkdir -p。

## local fake HTTP 必测边界

- OAuth pending/slow_down/declined、code 过期、JSON error vs HTTP error；token 刷新单次使用和响应丢失。
- list 顶层/data包装、1000满页→下一空页、uint64精度、未知非零 errno、缺 list。
- locateupload error_code、HTTPS带协议server、过期、恶意host、空servers。
- 上传无 errno 成功/有 errno 失败、31061后内容相同与不同、multipart file字段与query/form位置；precreate上传序号不等于MD5列表。
- filemetas部分条目错误/返回次序变化/缺dlink、302 host变化、URL过期、下载JSON错误体、超过上限。
- mkdir已存在目录与已存在同名文件两种结果。

验证边界：fake 只能证明客户端遵循当前文档与自己的故障处理，不证明百度实际准入、权限、域名全集、延迟或上述文档冲突已解决。
