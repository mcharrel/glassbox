#!/bin/bash
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || exit 0
router='src-tauri/server/link-router/rev Links.app/Contents'
mkdir -p "$router/MacOS" "$router/Resources"
cp src-tauri/icons/icon.icns "$router/Resources/icon.icns"
arch=arm64
[[ "${1:-}" == x86_64-apple-darwin ]] && arch=x86_64
xcrun swiftc -O -target "${arch}-apple-macosx12.0" assets/macos/rev-links.swift -o "$router/MacOS/rev-links"
cat > "$router/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.mcharrel.rev.links</string>
<key>CFBundleName</key><string>rev Links</string>
<key>CFBundleIconFile</key><string>icon</string>
<key>CFBundleExecutable</key><string>rev-links</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>Web links</string>
<key>CFBundleTypeRole</key><string>Viewer</string>
<key>CFBundleURLSchemes</key><array><string>http</string><string>https</string></array>
</dict></array>
</dict></plist>
PLIST
codesign --force --options runtime --sign "${APPLE_SIGNING_IDENTITY:--}" "$router/.."
