# Gemini 双舷窗的 Windows 验收

**Blocked。** 两轮正式 Windows 验收都比较了 12 张完整额度窗口，每轮 308,880 个 RGB 像素全部与定稿一致。另有两项严格检查记录到差异。两轮中，从诊断 QGM-203 的详情页返回，各有 1 个像素与打开详情前不同，坐标为 (83, 83)。三次额外冷启动由正常读数刷新至 5 小时 0% 与 100%，第三次标准窗有 2 个像素的蓝通道各少 1，坐标为 (83, 83) 和 (228, 83)。另外两次标准窗与全部三次窄条均为 0 差异。[第一轮](report.json) · [第二轮](repeat/report.json) · [三次空满](extremes-repeat/report.json)

两轮都从真实 Windows 面板读取流程取得六项匿名样例。「详情」显示五条实际来源重置文案和一条「面板未披露」。两类详情都恢复了窗口位置、尺寸和六项读数，正常详情返回的整窗像素也相同。真实鼠标悬停打开任务列表，点击聚焦原按钮，Esc 关闭列表，Tab 可以移到下一个按钮，空白区右键可以打开设置。[正常标准窗实机](ready-standard-actual.png) · [标准窗定稿](ready-standard-approved.png) · [标准窗差图](ready-standard-diff.png) · [窄条实机](ready-narrow-actual.png)

发布源码为 `87e995cd2fb9751dfcbba6ceedd68bd1cee6741f`，QuoDex.exe SHA-256 为 `b0de650f5210aaa4d5c21ea4e15c783f98ce8519613fb02023077676d83c7bd0`。原生 Windows 11 使用包内 WebView2 151.0.4129.78。Edge 158 软件栅格化的独立对照加载同一发布版的前端资源，两轮六组受控状态均为 0 RGBA 像素差。[受控状态报告](controlled/states-verified.json)

原生验收比较 Windows 实际绘制的整块额度浮窗，包括舷窗、刻度、文字、玻璃外框和标准窗页脚。标准尺寸为 300 × 130，窄条为 260 × 48。逐像素比较在 96 DPI、设备像素比 1、默认背景不透明度 0.92、黑色底板合成条件下执行。原生窗口顶部另有 204 像素的任务区域，报告保存其尺寸和裁切坐标。

[完整标准窗 HWND](ready-standard-hwnd.png) · [完整窄条 HWND](ready-narrow-hwnd.png) · [批准的交互定稿](../../design/gemini-quota-windows/liquid/twin/index.html)

## 差异定位

Windows UI Automation 从匿名面板读取六项额度，QuoDex 将读数绘制到浮窗，WebView2 把外框与底板合成到原生窗口。第三次空满刷新时，六项读数与定稿相同。解码两张原图后，左框边缘的 RGB 从定稿的 `(64,74,89)` 变为 `(64,74,88)`，右框对称位置从 `(64,75,89)` 变为 `(64,75,88)`。[实机原图](extremes-repeat/extremes-3-standard-actual.png) · [定稿原图](extremes-repeat/extremes-3-standard-approved.png)

在原尺寸定稿上隐藏左舷窗的子元素后，差异点所在位置的颜色没有变化。单独去掉外框阴影时，该处颜色发生变化。这将位置缩小到金属框与底板的合成边缘。渐变、阴影和最终合成各自对波动的影响尚待验证。[定稿外框样式](../../design/gemini-quota-windows/liquid/a.css) · [正式外框样式](../../../src/GeminiTwinChambers.css)

## 原生场景

| 场景 | 匿名面板中的变化 | 观察项 |
| --- | --- | --- |
| 正常 | AG Gemini 的 5 小时 / 一周为 82% / 16%，AG Claude/GPT 为 24% / 90%，Gemini Web 为 68% / 55% | 两种尺寸的六项数字和正常页脚 |
| 默认动效 | 同一组读数，关闭「减少动效」 | 静置后连续四次捕获，比较整块额度浮窗 |
| 一周耗尽 | AG Gemini 的一周为 0% | 保留 0% 和可用的 5 小时读数 |
| 一周未读 | 初次读取时 AG Gemini 面板省略一周 | 该周期显示未读，其他五项继续显示 |
| 上次读数 | 先读到 16%，移除该周期后点击「刷新」 | 只把该周期标为「上次」 |
| 5 小时空仓与满仓 | 从正常读数刷新为 AG Gemini 0%、AG Claude/GPT 100% | 两仓液面、六个数字以及刷新反馈 |
| 详情与诊断 | 打开页脚「详情」，依次滚动查看全部行，再关闭设置 | 六行四列、五条来源重置文案、一项「面板未披露」。移除 Claude/GPT 的百分比，确认可见诊断 QGM-203，返回后核对六项读数和窗口尺寸 |

`*-actual.png` 为发布程序截图，`*-approved.png` 为定稿，`*-diff.png` 保存 RGB 三通道的绝对差。任何像素有一个通道相差 1 都计为差异。独立的 Edge 检查加载正式编译的 JS、CSS 和材质，使用受控 Tauri IPC 驱动读取中、已更新和首次读取失败等状态。独立报告记录资源散列值和软件栅格化环境。

## 复现

在 Windows 11、PowerShell 7、Python 3.11 环境下运行。Python 依赖为 pywin32、Pillow、psutil 和 Playwright。电脑需要 Edge、随便携包提供的 WebView2 运行时、Microsoft.Web.WebView2.Core.dll 以及同架构的 WebView2Loader.dll。

```powershell
$packageDir = 'E:/QuoDex-builds/gemini-twin-5296/release-87e995c'
$revision = (Get-Content (Join-Path $packageDir 'manifest.json') -Raw | ConvertFrom-Json).sourceCommit
$sdkDll = 'C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/PrivateAssemblies/Microsoft.Web.WebView2.Core.dll'
$loaderDir = (Get-ChildItem '.scratch/gemini-liquid/target/release/build/webview2-com-sys-*/out/x64/WebView2Loader.dll' | Select-Object -First 1).DirectoryName
$env:PYTHONIOENCODING = 'utf-8'
$qa = @('scripts/verify-gemini-twin.py', '--executable', "$packageDir/QuoDex.exe", '--runtime', "$packageDir/webview2-runtime", '--source-revision', $revision, '--sdk', $sdkDll, '--loader', $loaderDir)
python @qa --repeat-extremes 3 --output .scratch/gemini-twin/recheck-extremes
python @qa --states --output .scratch/gemini-twin/recheck-a
python @qa --states --output .scratch/gemini-twin/recheck-b
```

命令中的便携包和 SDK 路径可按本机安装位置替换。若 Cargo 使用了其他 target 目录，在该目录的 `release/build/webview2-com-sys-*/out/x64` 下查找加载器。

脚本在私有 Windows 桌面启动新的 QuoDex、两个空白 Edge 测试配置以及独立的 WebView2 定稿窗口。两个 Edge 测试页面只返回匿名 HTML，正式程序通过 Windows UI Automation 从中读取额度。定稿使用相同的 WebView2，可交互脚本和材质来自批准的设计文件。宿主先挂载单个原尺寸标准窗，再按实际设置窗口大小切到窄条，使两端首次采样材质和改变尺寸的顺序一致。

脚本用 `PrintWindow(PW_RENDERFULLCONTENT)` 抓取实际 HWND，在相同窗口位置和 DPI 下比较合成后的 RGB。报告列出每个案例的坐标、窗口尺寸、最大通道差及差异矩形。所有窗口属于本次私有桌面的作业对象，脚本退出时关闭。验证通过后删除本次的临时浏览器与 GPU 缓存，截图和报告保存在 `--output` 指定的位置。
