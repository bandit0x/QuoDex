#!/usr/bin/env bash
# Package the macOS app bundle and DMG into release/macos, mirroring the
# role of package-portable.ps1 on Windows.
set -euo pipefail

cd "$(dirname "$0")/.."

app_name="QuoDex"
version=$(node -p "require('./package.json').version")
bundle_dir="src-tauri/target/release/bundle"
out_dir="release/macos"

npm run tauri:build

mkdir -p "$out_dir"
rm -rf "$out_dir/$app_name.app"
cp -R "$bundle_dir/macos/$app_name.app" "$out_dir/"
dmg=$(find "$bundle_dir/dmg" -name "${app_name}_${version}_"*.dmg -print -quit 2>/dev/null || true)
if [ -n "${dmg:-}" ]; then
  cp "$dmg" "$out_dir/"
fi

echo "Packaged: $out_dir/$app_name.app"
[ -n "${dmg:-}" ] && echo "Packaged: $out_dir/$(basename "$dmg")"
