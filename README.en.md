<div align="center">

<img src="src-tauri/icons/icon.png" width="80" alt="QuoDex icon">

# QuoDex

One liquid-glass floating window for **Codex / ZCode** remaining quota, reset times and task status.

**English** · [简体中文](README.md)

[![Release](https://img.shields.io/github/v/release/bandit0x/QuoDex)](https://github.com/bandit0x/QuoDex/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Windows%2011%20%7C%20macOS-blue)]
[![Downloads](https://img.shields.io/github/downloads/bandit0x/QuoDex/total)](https://github.com/bandit0x/QuoDex/releases/latest)
[![License](https://img.shields.io/github/license/bandit0x/QuoDex)](LICENSE)

</div>

QuoDex lives in a corner of your desktop: check how much Codex / ZCode quota remains and where your tasks stand without switching windows. The token-usage ledger is kept locally long-term — clearing history in the source apps never affects recorded data.

## Key Features

- **Quota & resets** — 5-hour, weekly or single-pool plans, Codex / ZCode switching and auto-rotation, available reset counts at a glance.
- **Two task groups** — Codex and ZCode side by side with 5 items each, color-coded as running / waiting / succeeded / errored; completion alerts dismiss in one click.
- **Liquid glass** — the fluid level follows your remaining balance and sloshes naturally while dragging; compact, expanded and narrow-strip views with adjustable opacity.
- **Token usage** — one click in Settings opens a local web page: six ranges from 7 days to 1 year, combined or split views, monthly heat walls and trend charts; the local ledger is kept long-term.

## Screenshots

<table>
  <tr>
    <th>Codex floating window</th>
    <th>Token usage · local web page</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/v0.3.0/main.png" width="420" alt="Codex floating window"></td>
    <td align="center"><img src="docs/verification/usage-liquid-glass/page-desktop-3m-hover.png" width="420" alt="Token usage heat wall"></td>
  </tr>
</table>

<details>
<summary>More screenshots: ZCode · Codex Pro · Settings · Narrow strip · Narrow screen</summary>

<table>
  <tr>
    <th>ZCode</th>
    <th>Codex Pro single reservoir</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/v0.3.0/zcode.png" width="240" alt="ZCode"></td>
    <td align="center"><img src="docs/screenshots/v0.3.0/codex-pro.png" width="240" alt="Codex Pro single reservoir"></td>
  </tr>
  <tr>
    <th>Settings</th>
    <th>Narrow strip</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/v0.3.0/settings.png" width="240" alt="Settings"></td>
    <td align="center"><img src="docs/screenshots/v0.3.0/narrow.png" width="240" alt="Narrow strip"></td>
  </tr>
</table>

<p align="center"><img src="docs/verification/usage-liquid-glass/page-390-full.png" width="180" alt="Token usage on a narrow screen"></p>

Floating-window screenshots come from the v0.3.0 native macOS app with anonymous demo data for quota and tasks; usage-page screenshots come from anonymous fixture data. [Screenshot sources](docs/verification/v0.3.0/README.md) · [Usage-page verification](docs/verification/usage-liquid-glass/)

</details>

## Getting Started

1. Download the installer for your platform from [Releases](https://github.com/bandit0x/QuoDex/releases/latest): use the `.exe` on Windows, or the `.dmg` on macOS and drag the app into Applications.
2. Make sure the Codex / ZCode you need is signed in, then launch QuoDex and pick the quota source.
3. Drag the window to reposition it, click the arrow in the bottom-right corner to expand, and right-click the main reservoir to open Settings.

Closing the window hides it to the tray or menu bar; use **Quit** to exit completely.

> macOS release builds are ad-hoc signed and not notarized yet; automated releases currently ship an Apple Silicon build, and Intel users can [build from source](docs/DEVELOPMENT.md#macos-构建).

## Documentation & Support

- [Usage guide & data privacy](docs/USAGE.md)
- [Development, build & configuration](docs/DEVELOPMENT.md)
- [Changelog](CHANGELOG.md)
- [Issue tracker](https://github.com/bandit0x/QuoDex/issues)

QuoDex is an unofficial community project, not affiliated with or endorsed by OpenAI or Bigmodel. The source code is released under the [MIT License](LICENSE); third-party components are covered by [their own licenses](THIRD_PARTY_NOTICES.md).
