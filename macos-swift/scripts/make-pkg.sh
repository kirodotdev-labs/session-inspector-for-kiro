#!/usr/bin/env bash
# Build a distributable macOS installer package (.pkg) that installs
# KiroSessionsInspector.app into /Applications. Output:
#   .build/dist/KiroSessionsInspector-<version>-arm64.pkg
#
# Signing (optional): set PKG_SIGN_IDENTITY to a "Developer ID Installer"
# identity to produce a signed installer, e.g.
#   PKG_SIGN_IDENTITY="Developer ID Installer: Your Name (TEAMID)" scripts/make-pkg.sh
# Without it, the package is unsigned and recipients must right-click → Open
# (or run: xattr -dr com.apple.quarantine <downloaded.pkg>).
#
# Usage:
#   scripts/make-pkg.sh [version]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Version + bundle identifier come from Info.plist (source of truth).
PLIST="$PKG_DIR/Resources/Info.plist"
DEFAULT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST" 2>/dev/null || echo "0.0.0")"
VERSION="${1:-$DEFAULT_VERSION}"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST" 2>/dev/null || echo "com.kiro.sessionsinspector")"

APP_NAME="KiroSessionsInspector"
DIST_DIR="$PKG_DIR/.build/dist"
BUNDLE_DIR="$PKG_DIR/.build/bundle"
APP_BUNDLE="$BUNDLE_DIR/$APP_NAME.app"
PKG_ROOT="$PKG_DIR/.build/pkg-root"
PKG_PATH="$DIST_DIR/${APP_NAME}-${VERSION}-arm64.pkg"

echo "==> Building app bundle"
"$SCRIPT_DIR/make-app-bundle.sh" "$BUNDLE_DIR"

# Stage a payload root whose layout mirrors the install location: the .app
# sits at the top of PKG_ROOT and --install-location drops it in /Applications.
echo "==> Staging package payload at $PKG_ROOT"
rm -rf "$PKG_ROOT"
mkdir -p "$PKG_ROOT"
cp -R "$APP_BUNDLE" "$PKG_ROOT/"

echo "==> Creating $PKG_PATH"
mkdir -p "$DIST_DIR"
rm -f "$PKG_PATH"

PKGBUILD_ARGS=(
    --root "$PKG_ROOT"
    --identifier "$BUNDLE_ID"
    --version "$VERSION"
    --install-location "/Applications"
)
if [[ -n "${PKG_SIGN_IDENTITY:-}" ]]; then
    echo "==> Signing installer as: $PKG_SIGN_IDENTITY"
    PKGBUILD_ARGS+=(--sign "$PKG_SIGN_IDENTITY")
fi

pkgbuild "${PKGBUILD_ARGS[@]}" "$PKG_PATH" >/dev/null

echo "==> Done: $PKG_PATH"
ls -lh "$PKG_PATH"
