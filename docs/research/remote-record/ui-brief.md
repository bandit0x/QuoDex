# 跨设备用量页与连接窗口 · Surface sidecar

本文件记录方向 A 的实际表面与交互边界，扩展现有 QuoDex 视觉世界。用户已授权按此方向开发；构建、检查、限制与最终验收进度只维护在 [remote-record 当前状态](README.md)。根 [DESIGN.md](../../../DESIGN.md) 保持既有材质契约，本页局部布局不升级为全局规范。

## Operate

用户的主任务是在原用量页查看已记录 token 用量，按日期、来源视图和设备范围定位数字；连接管理是二级操作。首屏保留合计、来源明细、月度热力图与趋势，不增加设备运维首页或改变紧凑浮窗。

实际入口为 `src-tauri/usage-page/` 和独立 Tauri 窗口 `src/SyncSettings.tsx` / `src/SyncSettings.css`。普通统计网页不承接 SecretKey 或百度授权链接；“同步详情 → 管理连接”打开原生设置窗口。

## 方向依据

- A（采用）：当前 `src-tauri/usage-page/` 的统计主任务；参考 [CodexBar](https://github.com/steipete/CodexBar) 的统计与状态层级，不照搬菜单栏或 CloudKit。
- B（未选）：参考 [Syncthing](https://github.com/syncthing/syncthing) 的设备可见性，设备贡献常驻主屏；拒绝运维面板密度。
- C（未选）：参考 [Actual](https://github.com/actualbudget/actual) 的账本导航，独立个人账本页；拒绝引入预算和交易编辑。

## 实际布局与行为

“全部设备 / 本机”是新增范围选择，与 Codex / ZCode 合并或分开正交。未连接时默认本机；首次读取已有成功同步时间时选中全部设备。全部设备明确标为“已收到记录”，用户无需重新输入系统已知的来源、日期与本机身份。

统计页继承海蓝玻璃、来源色与胶囊控件；设备选中态用浅青绿填充及 `aria-pressed`，同步状态以文字配合状态点表达。状态条位于筛选下方，异常、冲突、待补齐和身份不明的排除原因可直接看到，不依赖打开详情。同步失败保留已收到的账目，不用空白统计替代错误。

同步详情使用模态对话框，展示匿名设备标识、最后上传时间、排除原因及待上传量；“立即同步”和“管理连接”在底部。未连接、待授权、需重授权或同步中禁用立即同步，动作结束后按业务状态恢复；禁用外观弱化且不应用启用态 hover/active。

连接窗口采用系统字体、海蓝背景和单张柔圆玻璃卡片；AppKey、掩码 SecretKey 与应用文件夹按顺序输入，主操作为“连接并同步”。密钥用途在字段旁持续显示并关联辅助说明：“仅保存在本机系统凭据库，不随账本同步，仅用于百度授权。”首次连接准备事项折叠在下方，状态与外链图形使用统一 SVG。

授权中展示设备码、有效时间、打开官方授权页及取消；已连接展示最近同步、设备数与待上传数，重新配置和断开放在次级。失败展示可行动原因和稳定诊断码；本地非法文件夹为 `QDS-102`，不再沿用效果图中的示例编号。错误通过文字和浅琥珀底表达，无左侧装饰色条。

统计页在 760px 以下改为单列：日期按钮三列、来源及设备切换各两列，保留至少 44px 控件高度；精确日用量由选中日详情承载。同步详情在 600px 以下缩小内边距，设备行允许换行；连接窗口在 500px 以下收紧卡片边距并隐藏重复品牌标签。减少动效沿用统计页已有设置。

成功只表示本轮可见对象已同步，离线设备未上传的新记录仍未知。统计日期及已同步时间统一 Asia/Shanghai；自动周期按用户最新要求改为 6 小时，启动和首次授权同步一次，保留立即同步；不能作为历史补齐时限或百度 SLA。

## 实际截图与效果图差异

以下为隔离合成数据下运行真实产物的截图，来源、复现方式和图片复核范围见 [原生产物复核](../../verification/remote-record/ui-review.md)。这里引用既有复核，不新增独立视觉验收结论。

| 表面 | 实际证据与对照 |
| --- | --- |
| 桌面统计 | [usage-desktop.png](../../verification/remote-record/usage-desktop.png)：保留原统计构图与玻璃语言，新增范围切换和状态条，详情不常驻主屏。 |
| 窄屏统计 | [usage-narrow.png](../../verification/remote-record/usage-narrow.png)：390px 实际页面按控件组重排，不复制生成图的重复按钮、下缘截取或不严谨示例标签。 |
| 二级详情 | [sync-details.png](../../verification/remote-record/sync-details.png)：未连接时立即同步明确禁用，连接入口保留为次级动作。 |
| 原生连接 | [connection-native.png](../../verification/remote-record/connection-native.png)：采用真实系统窗口和表单，不复刻效果图装饰窗按钮；持久说明密钥用途。 |
| 本地失败 | [connection-validation-native.png](../../verification/remote-record/connection-validation-native.png)：呈现实际校验原因与 QDS-102，失败不靠装饰色条表达。 |

上述截图覆盖本地未连接及校验失败，尚未连接真实网盘；授权等待、同步中与成功界面已有实现，但不能用组件状态检查或生成图充当真实授权后的原生截图。实网与双 PC 的剩余验证边界只见 [当前状态](README.md)。

## 生成来源

使用内置 imagegen，参考既有截图 `docs/verification/usage-liquid-glass/page-desktop-3m-hover.png`。统计页经历一次定向修订，最终为 `ui-review.png`，对应 `ui-prompt-v2.txt`；初稿提示 `ui-prompt.txt` 留作参考来源。连接流程为 `connection-review.png`，对应 `connection-prompt.txt`。最终图片内嵌各自生成提示。

两张生成图只保留为方向与信息层级来源，不是运行产物、逐像素实现合同或同步能力证据。图稿审核不等于产品视觉验收。
