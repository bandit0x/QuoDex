# 0.4.10 任务环对照

[静止材质修改前后](static-compare.png) · [旧版五态](old.png) · [三 Agent 透明环心](overview.png) · [三 Agent 暗芯](dark-core.png) · [动效](motion.webp) · [交互预览](index.html)

本地标签 `v0.4.10` 指向 `5f2e732`。该版按聊天绘制任务环，Codex 和 ZCode 各自占用一个来源胶囊。[标签内的 Windows 截图](../../../verification/task-source-capsules/native-capsules.png) · [标签保存的早期水纹实录](../../../../.impeccable/review/task-water-v6/native-water-motion.gif)

| 聊天状态 | 0.4.10 的画法 |
| --- | --- |
| 运行 | 深色圆心外有两道青色水纹，波峰前缘短、拖尾长。两道波的基础周期分别为 2.6 秒和 3.9 秒，相遇时环缘增厚。 |
| 等待 | 琥珀色实线环，中间为两条圆头竖线。 |
| 完成 | 薄荷绿小勾在上，距完成的整分钟数在下。到 30 分钟时退出近期完成列表。 |
| 报错 | 珊瑚色实线环，中间为分开的竖笔与短点。 |
| 未知 | 银灰虚线环，中间为问号。 |

顶部每个 Agent 只占一环。对照稿把颜色用于识别 Agent，沿用旧版的笔画、分钟布局和水纹运动，并让圆心透出桌面。同一 Agent 的不同聊天可以同时运行和报错，样稿用外围水纹与中心叹号一起表达。在正式版 `b47c86b` 中，顶部运行环仍是旋转缺口。[当前版 Windows 实录](../../../verification/gemini-taskbar/rings/motion.webp)

原版笔画在标签的 `src/TaskStatusStrip.tsx`，材质计算在 `src/TaskWaterFlow.tsx`。后者在标签和 `b47c86b` 中指向相同的 Git blob `a877aa534d8bf5671b52f7ec46a55af4acaab3a5`。可用 `git show v0.4.10:src/TaskWaterFlow.tsx` 查看原算法。

运行和「运行＋报错」使用沿圆周移动的双波峰。静态环具有圆润截面，左上方的宽面光源在外肩和内缘留下方向相反的明暗变化。光源固定，环宽沿圆周保持一致。等待用中等厚度的闭环和双竖线。完成收细环边，突出勾和分钟数。报错用较厚的环边和加重的叹号。未知用低反差的十二段虚线和问号。动画循环只重绘有任务运行的环。
