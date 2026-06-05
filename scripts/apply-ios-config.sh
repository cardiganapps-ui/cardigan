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

# Remove the hardcoded CODE_SIGN_IDENTITY from the project-level Release
# config so Xcode's automatic signing picks the right identity itself.
# Capacitor's iOS template hardcodes
#   CODE_SIGN_IDENTITY = "iPhone Developer";
# at the project-level Release config (id 504EC315*). The App target's
# Release config has CODE_SIGN_STYLE = Automatic with no explicit
# identity, so it inherits "iPhone Developer" from the project — and
# Xcode then either (a) requests a Development provisioning profile
# from Apple (which fails when the team has no registered devices) or
# (b) refuses to honor a command-line "Apple Distribution" override
# because Automatic signing treats any explicit identity as a manual
# conflict.
#
# Solution: delete the line entirely. With CODE_SIGN_STYLE = Automatic
# and no inherited identity, Xcode picks Apple Distribution for the
# archive action and Apple Development for build/run — exactly what
# the App Store + TestFlight flow needs.
#
# We only touch the project-level Release block (id 504EC315*); the
# Debug block, target-level configs, and Pods stay untouched.
python3 - "ios/App/App.xcodeproj/project.pbxproj" <<'PY'
import re, sys
p = sys.argv[1]
src = open(p).read()
pattern = re.compile(
    r'(504EC3151FED79650016851F /\* Release \*/ = \{[\s\S]*?)\n\s*CODE_SIGN_IDENTITY = "iPhone Developer";'
)
new, count = pattern.subn(r'\1', src)
if count != 1:
    sys.exit(f"expected 1 substitution in pbxproj Release config, got {count}")
open(p, 'w').write(new)
print("✓ pbxproj Release config CODE_SIGN_IDENTITY removed (auto-sign picks Distribution)")
PY

echo "✓ iOS config applied to ios/App/App/"
