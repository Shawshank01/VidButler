#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo 'Expected one VidButler release ZIP or DMG to verify' >&2
    exit 1
fi

staging_dir=$(mktemp -d)
trap 'rm -rf "$staging_dir"' EXIT
case "$1" in
    *.zip)
        ditto -x -k "$1" "$staging_dir"
        ;;
    *.dmg)
        hdiutil attach -readonly -nobrowse -mountpoint "$staging_dir" "$1" >/dev/null
        trap 'hdiutil detach "$staging_dir" >/dev/null && rmdir "$staging_dir"' EXIT
        ;;
    *)
        echo "Unsupported macOS archive: $1" >&2
        exit 1
        ;;
esac
codesign --verify --deep --strict --all-architectures \
    -R='identifier "com.vidbutler.app"' "$staging_dir/VidButler.app"
