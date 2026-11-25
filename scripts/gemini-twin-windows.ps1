param(
  [Parameter(Mandatory)][ValidateSet('reference','inspect')][string]$Mode,
  [long]$Hwnd,
  [string]$Runtime,
  [string]$Profile,
  [string]$Sdk,
  [string]$Loader,
  [int]$TopInset = 0,
  [int]$SettingsHeight = 0,
  [int]$DesktopX = 120,
  [int]$DesktopY = 120,
  [ValidateSet('reduced','normal')][string]$Motion = 'reduced',
  [ValidateSet('standard','narrow')][string]$Layout = 'standard',
  [ValidateSet('ready','zero','missing','stale','extremes')][string]$Scenario = 'ready'
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 7) { throw 'QGT-101: PowerShell 7 required' }
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
if ($Mode -eq 'inspect') {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $window = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Hwnd)
  $all = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $items = foreach ($element in $all) {
    $name = $element.Current.Name
    if (-not $name) { continue }
    $r = $element.Current.BoundingRectangle
    [pscustomobject]@{name = $name; type = $element.Current.ControlType.ProgrammaticName
      focused = $element.Current.HasKeyboardFocus; x=$r.X; y=$r.Y; w=$r.Width; h=$r.Height}
  }
  ConvertTo-Json -InputObject @($items) -Compress
  return
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[void][Reflection.Assembly]::LoadFrom($Sdk)
[Microsoft.Web.WebView2.Core.CoreWebView2Environment]::SetLoaderDllFolderPath($Loader)
function Wait-UiTask($Task) {
  $limit = [DateTime]::UtcNow.AddSeconds(15)
  while (-not $Task.IsCompleted) {
    if ([DateTime]::UtcNow -gt $limit) { throw 'QGT-102: WebView2 API timed out' }
    [Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 8
  }
  $Task.GetAwaiter().GetResult()
}
[void][Windows.Forms.Application]::SetHighDpiMode([Windows.Forms.HighDpiMode]::PerMonitorV2)
$form = [Windows.Forms.Form]::new()
$form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [Windows.Forms.FormStartPosition]::Manual
$form.Location = [Drawing.Point]::new($DesktopX,$DesktopY)
$form.ClientSize = [Drawing.Size]::new(300,($TopInset + 130))
$form.BackColor = [Drawing.Color]::Black
$form.Text = 'QuoDex QA independent reference'
$form.Show()
$controller = $null
try {
  $options = [Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions]::new()
  $options.AdditionalBrowserArguments = if ($Motion -eq 'reduced') { '--force-prefers-reduced-motion --disable-background-networking' } else { '--disable-background-networking' }
  $environment = Wait-UiTask ([Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($Runtime,$Profile,$options))
  $controller = Wait-UiTask ($environment.CreateCoreWebView2ControllerAsync($form.Handle))
  $controller.Bounds = $form.ClientRectangle
  $controller.DefaultBackgroundColor = [Drawing.Color]::Transparent
  $controller.IsVisible = $true
  $view = $controller.CoreWebView2
  $entry = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../docs/design/gemini-quota-windows/liquid/twin/index.html')).Path
  # Leave the approved render functions and styles intact. Prepare a single
  # actual-size specimen before the shared texture can be sampled by the gallery.
  $hostSetup = @"
<script>
  const host = document.querySelector('[data-host="standard"]');
  for (const other of document.querySelectorAll('[data-host]')) {
    if (other !== host) other.removeAttribute('data-host');
  }
  host.classList.remove('enlarged-standard');
  document.body.prepend(host);
  document.querySelector('main').hidden = true;
  document.documentElement.style.background = 'transparent';
  document.body.style.cssText = 'padding:${TopInset}px 0 0;margin:0;background:transparent;overflow:hidden';
</script>
"@
  $entryUri = [Uri]::new($entry)
  $baseUri = [Uri]::new($entryUri,'../').AbsoluteUri
  $html = [IO.File]::ReadAllText($entry).Replace('<base href="../">',"<base href='$baseUri'>")
  $html = $html.Replace('<script src="twin/final.js">', $hostSetup + '<script src="twin/final.js">')
  $staged = Join-Path $Profile 'original-size-reference.html'
  [IO.File]::WriteAllText($staged,$html)
  $view.Navigate([Uri]::new($staged).AbsoluteUri)
  $limit = [DateTime]::UtcNow.AddSeconds(12)
  do {
    [Windows.Forms.Application]::DoEvents()
    if ([DateTime]::UtcNow -gt $limit) { throw 'QGT-103: Approved design did not load' }
    $ready = Wait-UiTask ($view.ExecuteScriptAsync("document.readyState === 'complete' && document.querySelector('[data-host] canvas')?.width > 0 && document.querySelector('[data-host] canvas')?.width < 300"))
  } while ($ready -ne 'true')
  if ($Scenario -eq 'extremes') {
    $edit = @'
(() => {
  const source = document.getElementById('source'), slider = document.getElementById('five');
  for (const [group, percent] of [['gemini', 0], ['partner', 100]]) {
    source.value = group; source.dispatchEvent(new Event('change'));
    slider.value = percent; slider.dispatchEvent(new Event('input'));
  }
  document.querySelector('[data-action="refresh"]').click();
})()
'@
    [void](Wait-UiTask ($view.ExecuteScriptAsync($edit)))
    do {
      [Windows.Forms.Application]::DoEvents()
      if ([DateTime]::UtcNow -gt $limit) { throw 'QGT-115: sample sliders did not settle' }
      $updated = Wait-UiTask ($view.ExecuteScriptAsync("document.querySelector('.feedback')?.textContent === '6/6 已更新'"))
    } while ($updated -ne 'true')
  }
  if ($Layout -eq 'narrow') {
    if ($SettingsHeight -le 0) { throw 'QGT-121: missing native settings geometry' }
    $form.ClientSize = [Drawing.Size]::new(300,$SettingsHeight)
    $controller.Bounds = $form.ClientRectangle
    [Windows.Forms.Application]::DoEvents()
    $form.ClientSize = [Drawing.Size]::new(260,($TopInset + 48))
    $controller.Bounds = $form.ClientRectangle
    [Windows.Forms.Application]::DoEvents()
  }
  $script = @"
(() => {
  const scenario = document.getElementById('scenario');
  if ('$Scenario' !== 'extremes') scenario.value = '$Scenario';
  const host = document.querySelector('[data-host]');
  if ('$Layout' === 'narrow') {
    host.replaceChildren();
    host.dataset.host = 'narrow';
  }
  if ('$Layout' === 'narrow' || '$Scenario' !== 'extremes') scenario.dispatchEvent(new Event('change'));
  const surface = host.querySelector('.surface');
  Q.paint();
  return {width:surface.offsetWidth,height:surface.offsetHeight,values:[...surface.querySelectorAll('.q-value')].map(e=>e.textContent),dpr:devicePixelRatio};
})()
"@
  $metrics = (Wait-UiTask ($view.ExecuteScriptAsync($script))) | ConvertFrom-Json
  $limit = [DateTime]::UtcNow.AddMilliseconds(450)
  while ([DateTime]::UtcNow -lt $limit) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 8 }
  $ready = Join-Path $Profile 'capture-ready.json'
  @{hwnd=$form.Handle.ToInt64();version=$environment.BrowserVersionString;metrics=$metrics} | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath $ready -Encoding utf8
  $stopPath=Join-Path $Profile 'captured'
  $limit=[DateTime]::UtcNow.AddSeconds(15)
  while (-not (Test-Path -LiteralPath $stopPath) -and [DateTime]::UtcNow -lt $limit) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 12 }
} finally {
  if ($controller) { $controller.Close() }
  $form.Close()
}
