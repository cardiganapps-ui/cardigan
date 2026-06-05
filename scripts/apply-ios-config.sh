#!/usr/bin/env bash
# After `npx cap add ios`, drop our entitlements + Privacy Manifest
# into the generated iOS project. Idempotent — safe to re-run.
#
# Run from repo root.
set -euo pipefail

if [ ! -d "ios/App/App" ]; then
  echo "ios/App/App not found — run 'npx cap add ios && npx cap sync ios' first."
  exit 1
fi

# Entitlements (push, sign in with apple, associated domains).
cp ios-config/App.entitlements ios/App/App/App.entitlements

# iOS 17+ Privacy Manifest. Required for App Store submission.
cp ios-config/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy

# Firebase iOS app config — bundle id, API key, GCM sender id, etc.
# Public by design (ships inside the IPA; any user can extract it);
# safe to commit. Used by the Firebase iOS SDK at runtime for FCM
# token registration. Without it, push tokens never get minted.
cp ios-config/GoogleService-Info.plist ios/App/App/GoogleService-Info.plist

# UIBackgroundModes.remote-notification — needed for background push
# delivery. Capacitor's default Info.plist doesn't include it; we
# splice it in via plutil. The -insert with .0 syntax extends an array.
PLIST="ios/App/App/Info.plist"
if ! /usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes array" "$PLIST"
fi
# Add 'remote-notification' if missing (PlistBuddy doesn't have an
# array-contains check, so we read the array and grep).
if ! /usr/libexec/PlistBuddy -c "Print :UIBackgroundModes" "$PLIST" | grep -q "remote-notification"; then
  /usr/libexec/PlistBuddy -c "Add :UIBackgroundModes: string remote-notification" "$PLIST"
fi

# CFBundleURLTypes for custom-scheme deep links isn't needed —
# Universal Links via the associated-domains entitlement cover the
# tap-from-email flow, and we don't expose a cardigan:// scheme.

echo "✓ iOS config applied to ios/App/App/"
