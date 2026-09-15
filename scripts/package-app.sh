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

# 捆绑 @openai/codex 的平台原生二进制（对齐 package-portable.ps1 的 codex-runtime），
# 安装后的应用无需用户另装 Codex 也能探测配额；缺失时跳过，运行期回退为探测
# ChatGPT.app / Codex.app 内嵌 CLI 或用户自装的 codex。
case "$(uname -m)" in
  arm64)  codex_pkg="codex-darwin-arm64"; vendor_triple="aarch64-apple-darwin" ;;
  x86_64) codex_pkg="codex-darwin-x64";   vendor_triple="x86_64-apple-darwin" ;;
  *)      codex_pkg="";                   vendor_triple="" ;;
esac
vendored_codex="node_modules/@openai/$codex_pkg/vendor/$vendor_triple/bin/codex"
runtime_bin="$out_dir/$app_name.app/Contents/MacOS/codex-runtime/bin/codex"
if [ -n "$codex_pkg" ] && [ -x "$vendored_codex" ]; then
  mkdir -p "$(dirname "$runtime_bin")"
  cp "$vendored_codex" "$runtime_bin"
  # 注入二进制后重签 ad-hoc，避免包签名失效导致 Gatekeeper 拒绝启动
  codesign --force --deep --sign - "$out_dir/$app_name.app"
  echo "Bundled codex runtime: $runtime_bin"
else
  echo "WARNING: 未找到 @openai/codex 平台二进制（请先 npm install）；应用将依赖用户已安装的 Codex。" >&2
fi

dmg=$(find "$bundle_dir/dmg" -name "${app_name}_${version}_"*.dmg -print -quit 2>/dev/null || true)
if [ -n "${dmg:-}" ]; then
  cp "$dmg" "$out_dir/"
fi

echo "Packaged: $out_dir/$app_name.app"
[ -n "${dmg:-}" ] && echo "Packaged: $out_dir/$(basename "$dmg")"
