#!/usr/bin/env bash
# Bump the app version in Resources/Info.plist (the source of truth used by
# make-dmg / make-pkg / make-zip). Updates both CFBundleShortVersionString
# and CFBundleVersion.
#
# Usage:
#   scripts/bump-version.sh <version>   # set an explicit version, e.g. 0.2.0
#   scripts/bump-version.sh major       # 1.4.2 -> 2.0.0
#   scripts/bump-version.sh minor       # 1.4.2 -> 1.5.0
#   scripts/bump-version.sh patch       # 1.4.2 -> 1.4.3
#   scripts/bump-version.sh             # print the current version and exit
#
# Options (env):
#   DRY_RUN=1   show the change without writing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST="$PKG_DIR/Resources/Info.plist"

if [[ ! -f "$PLIST" ]]; then
    echo "error: Info.plist not found at $PLIST" >&2
    exit 1
fi

plist_get() {
    /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST" 2>/dev/null || echo ""
}

CURRENT="$(plist_get CFBundleShortVersionString)"
CURRENT="${CURRENT:-0.0.0}"

# No argument: report the current version and exit.
if [[ $# -eq 0 ]]; then
    echo "$CURRENT"
    exit 0
fi

ARG="$1"

# Parse the current version into components (defaulting missing parts to 0).
if [[ "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    MAJOR="${BASH_REMATCH[1]}"
    MINOR="${BASH_REMATCH[2]}"
    PATCH="${BASH_REMATCH[3]}"
else
    echo "warning: current version '$CURRENT' is not semver; treating as 0.0.0" >&2
    MAJOR=0; MINOR=0; PATCH=0
fi

case "$ARG" in
    major) NEW="$((MAJOR + 1)).0.0" ;;
    minor) NEW="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) NEW="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    *)
        if [[ "$ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            NEW="$ARG"
        else
            echo "error: '$ARG' is not a valid semver (X.Y.Z) or one of: major, minor, patch" >&2
            exit 1
        fi
        ;;
esac

echo "==> Version: $CURRENT -> $NEW"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "==> DRY_RUN set; no changes written."
    exit 0
fi

/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $NEW" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEW" "$PLIST"

echo "==> Updated $PLIST"
echo "    CFBundleShortVersionString = $(plist_get CFBundleShortVersionString)"
echo "    CFBundleVersion            = $(plist_get CFBundleVersion)"
