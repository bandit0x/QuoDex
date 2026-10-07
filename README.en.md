# QuoDex

<p align="center">
  <img src="src-tauri/icons/icon.png" width="80" alt="QuoDex icon">
</p>

Keep an eye on your **Codex / ZCode** remaining quota, reset times and task status in one liquid-glass floating window.

**v0.4.0** · Windows 11 x64 / macOS · [Download](https://github.com/bandit0x/QuoDex/releases/tag/v0.4.0)

<div align="center">

**English** · [简体中文](README.md)

</div>

## Key Features

- **Quota & resets**: view 5-hour, weekly or single-pool plans, with Codex / ZCode switching and auto-rotation, plus available reset counts.
- **Two task groups**: Codex and ZCode stay visible at the same time, each listing 5 items distinguished as running, waiting, succeeded or errored; completion alerts can be dismissed with one click.
- **Liquid glass**: the fluid level follows your remaining balance and sloshes naturally while dragging; compact, expanded and narrow-strip views with adjustable opacity.
- **Token usage**: one click in Settings opens a local web page showing Codex / ZCode token usage for every project on this machine — six ranges from 7 days to 1 year, combined or split views, monthly heat walls and trend charts; the local ledger is kept long-term, so clearing history in the source apps never affects recorded data.

## Screenshots

<table>
  <tr>
    <th>Codex</th>
    <th>ZCode</th>
    <th>Codex Pro</th>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/v0.3.0/main.png" width="300" alt="Codex">
    </td>
    <td align="center">
      <img src="docs/screenshots/v0.3.0/zcode.png" width="300" alt="ZCode">
    </td>
    <td align="center">
      <img src="docs/screenshots/v0.3.0/codex-pro.png" width="300" alt="Codex Pro single reservoir">
    </td>
  </tr>
</table>

<table>
  <tr>
    <th>Settings</th>
    <th>Narrow strip</th>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/v0.3.0/settings.png" width="300" alt="Settings">
    </td>
    <td align="center">
      <img src="docs/screenshots/v0.3.0/narrow.png" width="260" alt="Narrow strip">
    </td>
  </tr>
</table>

<table>
  <tr>
    <th>Token usage · local web page</th>
    <th>Narrow screen</th>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/verification/usage-liquid-glass/page-desktop-3m-hover.png" width="300" alt="Token usage heat wall">
    </td>
    <td align="center">
      <img src="docs/verification/usage-liquid-glass/page-390-full.png" width="200" alt="Token usage on a narrow screen">
    </td>
  </tr>
</table>

Floating-window screenshots come from the v0.3.0 native macOS app with anonymous demo data for quota and tasks; usage-page screenshots come from anonymous fixture data. [Screenshot sources](docs/verification/v0.3.0/README.md) · [Usage-page verification](docs/verification/usage-liquid-glass/)

## Getting Started

1. Download the installer for your platform from [Releases](https://github.com/bandit0x/QuoDex/releases/tag/v0.4.0): use the `.exe` on Windows, or the `.dmg` on macOS and drag the app into Applications.
2. Make sure the Codex / ZCode you need is signed in, then launch QuoDex and pick the quota source.
3. Drag the window to reposition it, click the arrow in the bottom-right corner to expand, and right-click the main reservoir to open Settings.

Closing the window hides it to the tray or menu bar; use **Quit** to exit completely.

macOS release builds are ad-hoc signed and not notarized yet. Automated releases currently ship an Apple Silicon build; Intel users can [build from source](docs/DEVELOPMENT.md#macos-构建).

## More

- [Usage guide & data privacy](docs/USAGE.md)
- [Development, build & configuration](docs/DEVELOPMENT.md)
- [Changelog](CHANGELOG.md)
- [Issue tracker](https://github.com/bandit0x/QuoDex/issues)

QuoDex is an unofficial community project, not affiliated with or endorsed by OpenAI or Bigmodel.

The source code is released under the [MIT License](LICENSE); third-party components are covered by [their own licenses](THIRD_PARTY_NOTICES.md).
