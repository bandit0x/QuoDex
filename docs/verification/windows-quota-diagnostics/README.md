# Windows 额度诊断修复验证 · 2026-10-08

整体状态：**Blocked**。后端、fixture 与最小错误文案修复已实现并完成 macOS 验证；当前机器不能运行 Windows 安装产物，用户的间歇性 `answer error` 上游触发原因尚未复现。

## 来源与改动

- 来源提交：`2bd46a8e267c38f220645856cf084cb19fb47478`（用户最新 Windows 修复）。本地修复分支 `codex/fix-windows-quota`，版本仍为 `0.4.1`。
- quota 协议保持 initialize → initialized → account/rateLimits/read。代理认证不再误判为 Codex 未登录；登录、网络、权限、限流、服务故障使用不同的稳定诊断编号。
- RPC detail 保留有限长度的原因，处理常见凭据、Cookie、email 与本机 home 路径脱敏；不导出原始 stderr。stderr 仅在初始化失败时识别配置错误，初始化后的可选组件告警不会覆盖退出原因。
- Windows 原生 smoke 的匿名 SQLite 写入改用 WAL、3 秒 busy timeout，以及每个数据库的事务替换；异常回滚。两个数据库分别提交，不宣称跨数据库原子性。所有 Codex/ZCode fixture 替换入口均使用该边界；CI 增加 Node SQLite 回归。
- 未修改产品数据库写入、代理配置或刷新策略。失败卡片在原位置显示后端具体原因；空白或与标题重复的消息使用原提示兜底。CSS、布局、按钮与重试逻辑保持原样。

| 编号 | 原因与恢复建议 |
| --- | --- |
| CRV-202 | Codex 登录不可用；在 Codex 中重新登录 |
| CRV-203 | 代理认证失败；检查代理登录或切换线路 |
| CRV-204 | 额度连接失败；检查网络或代理 |
| CRV-205 | 被服务限流；稍后重试 |
| CRV-206 | 额度服务暂时不可用；稍后重试 |
| CRV-207 | 服务拒绝访问；检查权限或线路 |
| CRV-108 | 未识别的 RPC 异常；保留脱敏原因 |
| CRV-115 | 初始化前配置加载失败；检查 Codex 配置 |

## 验证环境、步骤与实际结果

macOS 27.0.1 arm64、Node 24.19.0、Rust 1.98.1、项目固定 Codex runtime 0.147.0。Node 路径来自 Codex 内置 runtime。Windows CI 配置仍使用 Node 24.18.0 / Rust 1.97.1；本轮未发布代码或触发新的远程运行。

日志目录：`/private/tmp/quodex-answer-error-20261008/`（本机可读，未加入源码）。

| 检查 | 步骤 | 结果与证据 |
| --- | --- | --- |
| 错误分类 | `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml fixture_distinguishes_service_failures_from_codex_login` | 原断言代理场景 CRV-202 → CRV-203，先失败后通过；red-classification.log / green-classification.log |
| 启动、隐私与告警 | `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml fixture_` | 真实子进程回归；审查阶段 2 项先失败，修正后相关 13 项通过；red-review.log / green-review.log |
| SQLite 并发与回滚 | `npm run test:native-fixtures`（Node 24） | 2 项通过；真实磁盘双连接持读事务仍可写，回调异常保留旧快照；native-fixture-tests-final.log |
| 前端回归 | `npm test` | 12 文件、170 项通过；ui-frontend-tests.log。具体原因显示回归先失败后通过（ui-red.log / ui-green.log）；原有重试和标题去重测试通过 |
| Rust 全量 | `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml` | 135 项通过、5 项按原配置 ignored；rust-tests-final.log。初次沙箱禁止本机 HTTP/IPC，沙箱外复测通过 |
| strict Clippy | `cargo clippy --locked --offline --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | 通过；clippy-final.log |
| 生产构建 | `npm run tauri:build -- --bundles app` | tsc、Vite、Rust release 和 macOS .app 构建通过；ui-native-build.log |
| 真实只读额度 | 修改后的实际额度模块 + 同仓库固定 runtime，只输出窗口存在性 | 最终源码本机请求成功、5028 ms；live-fixed-module-final.json。此处是独立 harness，不是 Windows 原生应用 |
| 原生启动 | 实际 .app 的隔离副本，匿名 SQLite 与协议 fixture、原生窗口检查 | 窗口启动成功。较长配置原因、CRV-115、重试按钮与底栏完整可见，保持原布局；点击原生重试后恢复 76% / 42%。见 [失败截图](failure.png) / [恢复截图](recovered.png) |

构建产物：`src-tauri/target/release/bundle/macos/QuoDex.app`。验证副本位于 `/private/tmp/quodex-answer-error-20261008/native/QuoDex Quota Text QA.app`，改了 bundle 标识、LSEnvironment 并重新 ad-hoc 签名，只连接匿名 fixture；没有安装到用户 Applications 或读取真实聊天数据库。

原生 fixture 导入项目 Documents 目录时出现 CRV-111；将相同 fixture 文件暂存到 `/private/tmp` 后显示 CRV-115，并可恢复匿名正常额度。CLI 直接调用同一文件原先就返回 CRV-115。这定位了验证环境中的文件加载差异，未证明具体 OS 权限原因，也不是 Windows 间歇故障的复现。

首轮原生重试自动化因旧索引失效，未计作通过；本轮读取即时原生状态并在同一调用中点击对应重试按钮，实际执行成功，随后显示正常额度。只通过真实后端匿名 fixture 切换输入，没有向 React 注入状态。5 个 ignored 测试涉及真实 Codex Desktop 聊天、ZCode 登录/网关及运行实例，按原配置未执行。

## 审查

### Standards

最终后端 diff 未发现需修正的规范违例或基线异味。只读协议边界符合 ADR-0001；诊断编号、首个失败边界与真实子进程/SQLite 回归符合项目规则。后续最小文案 diff 同样未发现规范违例或基线异味；规范违例 0，基线异味 0。

### Spec

原 2 项发现已解决：camelCase/带空格引号凭据脱敏遗漏；初始化成功后的可选 MCP 配置告警误判。两项均有 red → green 证据。后续最小文案 diff 保留具体原因、诊断码、重试与兜底，未发现需求遗漏或范围扩张；当前已实现范围 0 项未解决发现。Windows 验收仍待完成。

## 限制与后续

- 错误文案状态 **Verified**（macOS 原生，默认 300 px 窗口）：按用户已选 A 做文字修复。用户追问为何设计 UI 后，纠正了过重的设计流程；未重新设计外观。本轮构建、原生截图与实际重试对应当前文案源码。Windows 排版与协议仍待实机检查。
- Windows 安装产物验证 **Blocked**：需在 Windows 执行 CI 的安装后原生回归，并在真实错误出现时记录新诊断码及脱敏 RPC 原因。
- 这些修复解决已复现的误分类、证据缺失和 fixture 写入锁竞争；不能据此声称上游服务、代理或用户的间歇性失败已经消失。

## 源码与构建指纹

```json
{
  "src/App.tsx": "9922c2b7e655ef002625182e37e5b4327625ece19312c60eee9c1ed0448b9f5c",
  "src/App.css": "c2875c04ff5e3f6e0618109fe47ce7bb16d8d063b4d8405217a5fb620ed9b1a9",
  "src-tauri/src/capacity.rs": "29fca6fab6361e4326f07df9ba48a6186807b713be948178dc57773ce8add74b",
  "fixtures/app-server-fixture.mjs": "3de50e34d6b4323ae780ffd6886224eca223a4349020ec70833e765cca95457a",
  "src-tauri/target/release/bundle/macos/QuoDex.app/Contents/MacOS/codex-credits-view": "1c6b5abc68a2fcf018c604014e1f41bd695a3257c39648e327e79f22567e3189",
  "/private/tmp/quodex-answer-error-20261008/native/QuoDex Quota Text QA.app/Contents/MacOS/codex-credits-view": "e52c544b24b23261f55d62560593e76996ad63a040688455fa5467426fa0b310"
}
```
