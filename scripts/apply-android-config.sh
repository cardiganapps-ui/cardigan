#!/usr/bin/env bash
# Re-apply Cardigan-specific Android resource customizations that
# `npx @capacitor/assets generate --android` clobbers on every CI run.
# Mirrors the role of apply-ios-config.sh for the iOS build.
#
# Currently one job: the assets generator rewrites
# mipmap-anydpi-v26/ic_launcher{,_round}.xml from a hardcoded template
# that has no <monochrome> slot, which silently drops the Android 13+
# themed icon (drawable/ic_launcher_monochrome.xml). Re-insert it.
#
# Idempotent — safe to run repeatedly and locally after a manual
# `npx @capacitor/assets generate --android`.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RES_DIR="$REPO_DIR/android/app/src/main/res"

for f in "$RES_DIR/mipmap-anydpi-v26/ic_launcher.xml" \
         "$RES_DIR/mipmap-anydpi-v26/ic_launcher_round.xml"; do
  if [ ! -f "$f" ]; then
    echo "apply-android-config: MISSING $f" >&2
    exit 1
  fi
  if grep -q "<monochrome" "$f"; then
    echo "apply-android-config: <monochrome> already present in ${f##*/}"
  else
    sed -i.bak 's|</adaptive-icon>|    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n</adaptive-icon>|' "$f"
    rm -f "$f.bak"
    echo "apply-android-config: inserted <monochrome> into ${f##*/}"
  fi
done
