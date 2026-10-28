# QuoDex v0.4.8 流光水膜补丁（Windows x64）

适用于已安装或已解压的 Windows x64 QuoDex v0.4.8。不是完整安装器；首次使用请先安装发布页原有 v0.4.8 Windows 安装包。

1. 在 QuoDex 右键面板点击“退出”，等待窗口关闭。
2. 右键桌面 QuoDex 快捷方式，选择“打开文件所在的位置”。确认这是现有 v0.4.8 程序目录。
3. 将该目录中的主程序复制备份到另外的备份文件夹。安装版通常名为 `codex-credits-view.exe`，便携版可能名为 `QuoDex.exe`；以快捷方式实际指向的文件名为准。
4. 将补丁中的 `codex-credits-view.exe` 复制到程序目录，使用原主程序的文件名并替换原文件。如果原文件叫 `QuoDex.exe`，将补丁主程序重命名为 `QuoDex.exe` 后替换。
5. 保留 `webview2-runtime`、`codex-runtime` 及其他文件。通过原快捷方式启动，右键检查透亮水膜面板。版本号继续显示 v0.4.8。

回退：退出 QuoDex，用步骤 3 的主程序备份替换补丁主程序即可。补丁不修改配置格式、账本或运行时。

主程序 SHA256：`4B7A93308B0BE3409910782EA3D8EA992FC699AB418DE619260DF528FD184BB0`。

补丁来源与 ZIP 校验值见发布页同名清单。本补丁只提供 Windows x64 二进制；原 macOS DMG 不包含这次补丁。
