#!/usr/bin/env bash
# Verifies the captioned video CapFlow wrote to the camera roll of a QA target.
# Usage: .maestro/verify-burn.sh <simulator-udid|android>
#
# The burn is AVVideoCompositionCoreAnimationTool on iOS and a MediaCodec GL
# pass on Android -- separate implementations, so one passing says nothing
# about the other.
set -euo pipefail
TARGET="${1:?usage: verify-burn.sh <udid|android>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/verify-burn"
swiftc -O "$HERE/verify-burn.swift" -o "$BIN"

# The source the app captioned, regenerated rather than kept as a binary.
( cd "$WORK" && swiftc -O "$HERE/fixtures/make-speech-clip.swift" -o gen >/dev/null && ./gen >/dev/null )
SOURCE="$WORK/capflow-speech.mov"

if [ "$TARGET" = android ]; then
  ADB="$HOME/Library/Android/sdk/platform-tools/adb"
  "$ADB" shell content call --uri content://media/ --method scan_volume --arg external_primary >/dev/null 2>&1 || true
  REMOTE="$("$ADB" shell "ls -t /sdcard/DCIM/*.mp4 /sdcard/Movies/*.mp4" 2>/dev/null | tr -d '\r' | head -1)"
  [ -n "$REMOTE" ] || { echo "FAIL: no exported video on the device"; exit 1; }
  "$ADB" pull "$REMOTE" "$WORK/export.mp4" >/dev/null
  EXPORT="$WORK/export.mp4"
else
  DCIM="$HOME/Library/Developer/CoreSimulator/Devices/$TARGET/data/Media/DCIM/100APPLE"
  EXPORT="$(ls -t "$DCIM"/*.MP4 2>/dev/null | head -1)"
  [ -n "$EXPORT" ] || { echo "FAIL: no exported video in the camera roll"; exit 1; }
fi

"$BIN" "$SOURCE" "$EXPORT"
