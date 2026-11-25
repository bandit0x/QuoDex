# 额度轮播 A 方案 · Windows 验收

2026-11-25，Windows 11、96 DPI。源码 `a7cd48c`，QuoDex 0.4.12 发布 EXE 的 SHA-256 为 `B0896883D0E19E98EA81CA44D8F5E86890D378E2DE240C9EF0EA159D4B46C0EC`。前端和 Windows 发布构建通过，209 项前端测试、178 项 Rust 测试通过，5 项 Rust 原有用例标记为忽略。

正式程序使用独立配置启动，Codex 读数使用仓库的匿名夹具。300 px 标准浮窗和 260 px 窄条都把「轮播来源」放在顶行来源入口下方，三个完整名称与勾选状态可见。[批准稿](../../design/quota-carousel/compact.png)

| 步骤 | 观察项 |
| --- | --- |
| 首次打开设置 | 进入轮播时 Codex、ZCode、Gemini 全选。[初始状态](enabled.png) |
| 取消 ZCode | 原生设置页显示已保存，本地偏好记录 Codex 与 Gemini。[保存成功](standard.png) |
| 退出后再次启动 | 打开设置，可见 ZCode 仍是未选中状态。[重启后](restarted.png) |
| 切换窄条并打开设置 | 260 px 宽度下，三个选项仍同排，退出和关闭操作可见。[窄条](narrow.png) |

前端集成测试用虚拟时钟验证 Codex → Gemini → Codex、两项下限提示、临时固定查看 ZCode 后恢复名单。现有保存失败和重试用例继续覆盖共用写入流程。Rust 测试覆盖偏好文件往返保存。原生截图所用额度为测试数据。
