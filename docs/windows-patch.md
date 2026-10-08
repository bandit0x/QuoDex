# Windows 0.4.1 patch

The version remains 0.4.1. This patch does not move the existing tag or publish a Release.

## Failure boundaries

- Applying native blur to the entire Windows window made transparent gaps black. Windows now preserves WebView alpha; macOS retains its region material implementation.
- ZCode can relocate its desktop index through `.zcode/v2/setting.json` (`dataBaseDir`) while the CLI journal remains in the default profile. Task discovery must resolve each source separately. Invalid settings produce QDT-626 rather than silently reading stale data.
- Windows popover polling used a macOS-only cursor query, which returned no position and closed task details. Windows now compares physical desktop cursor and window coordinates.

CI previously tested source without installing or opening the Windows artifact on ordinary pushes. Passing unit tests therefore did not exercise these boundaries.

## Reproduction and checks

Use PowerShell 7, Node 24.18.0 and Rust 1.97.1 from the repository root:

```powershell
npm ci
npm run typecheck
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
./scripts/fetch-webview2-fixed-runtime.ps1
npm run package:installer
# Quit the installed QuoDex first. This installs into the current user's QuoDex directory.
./scripts/windows-release-smoke.ps1 -Installer release/QuoDex-0.4.1-win-x64-setup.exe
```

The native smoke uses anonymous SQLite data, a read-only Desktop-shaped named pipe and an owned ZCode process fixture. It opens the installed executable with a fresh profile, checks two cold starts without a new message, joins a relocated ZCode index with the default CLI journal, holds the task list open, verifies pointer-leave closure, checks waiting/cancellation and quits through the real UI. A separate native screenshot probe compares nine backdrop RGB samples before, during and after settings.

Every Windows CI build runs these checks before uploading a candidate installer. Evidence is uploaded on failures too; `manifest.json` records the source, dirty state, hashes, toolchain and fixed runtime. CI creates artifacts only; Releases remain maintainer-owned.

The smoke requires an interactive Windows desktop. Fixtures do not prove authenticated live tasks, and ordinary pending tools cannot distinguish approval from queuing. Four environment-dependent Rust tests remain ignored in the ordinary suite. Separate acceptance is needed for 125%/150% DPI and multiple monitors.
