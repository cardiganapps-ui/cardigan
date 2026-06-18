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

# Export compliance — ITSAppUsesNonExemptEncryption = NO bypasses the
# per-upload compliance questionnaire in App Store Connect. Without
# this key, every new TestFlight build lands in "Missing Compliance"
# status until a human clicks Manage and re-answers the export
# regulations questions. With it, App Store Connect trusts our
# declaration: Cardigan only uses HTTPS + standard NIST cryptographic
# algorithms (AES-GCM, RSA-OAEP, PBKDF2 via WebCrypto), all of which
# qualify for the §740.17(b) mass-market exemption from US export
# documentation requirements. No proprietary or non-standard
# encryption is implemented anywhere in the codebase.
if /usr/libexec/PlistBuddy -c "Print :ITSAppUsesNonExemptEncryption" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Set :ITSAppUsesNonExemptEncryption false" "$PLIST"
else
  /usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST"
fi

# Marketing version (CFBundleShortVersionString) is set via the
# pbxproj patch below — Capacitor's Info.plist uses the
# `$(MARKETING_VERSION)` variable for CFBundleShortVersionString, so
# setting MARKETING_VERSION on the App target's Release config flows
# through correctly at build time. Setting CFBundleShortVersionString
# directly here with PlistBuddy works too but breaks Capacitor's
# variable-substitution model.

# Camera + photo library usage strings — required by iOS the FIRST time
# the app touches AVCaptureDevice or PHPhotoLibrary (receipt OCR in
# gastos, plus avatar capture). Without these the system kills the
# process with an unhandled exception instead of prompting the user.
# Copy is short on purpose — Apple's reviewer wants the *purpose*, not
# the feature list.
if /usr/libexec/PlistBuddy -c "Print :NSCameraUsageDescription" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Set :NSCameraUsageDescription 'Cardigan usa la cámara para escanear recibos y tomar fotos de perfil.'" "$PLIST"
else
  /usr/libexec/PlistBuddy -c "Add :NSCameraUsageDescription string 'Cardigan usa la cámara para escanear recibos y tomar fotos de perfil.'" "$PLIST"
fi
if /usr/libexec/PlistBuddy -c "Print :NSPhotoLibraryUsageDescription" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Set :NSPhotoLibraryUsageDescription 'Cardigan accede a tus fotos para adjuntar recibos y documentos.'" "$PLIST"
else
  /usr/libexec/PlistBuddy -c "Add :NSPhotoLibraryUsageDescription string 'Cardigan accede a tus fotos para adjuntar recibos y documentos.'" "$PLIST"
fi

# ── Google Sign-In: register the reversed-client-ID URL scheme ──
# Native Google sign-in (@capgo/capacitor-social-login → GoogleSignIn SDK)
# hands control back to the app on a custom URL scheme = the reversed iOS
# OAuth client ID. Without it in CFBundleURLTypes the system can't return
# from the account picker and login silently fails. Idempotent — uses
# plistlib so we don't fight PlistBuddy's array-of-dicts ergonomics.
python3 - "$PLIST" <<'PY'
import plistlib, sys
p = sys.argv[1]
scheme = "com.googleusercontent.apps.17610829726-9vvfcimk2cbm9eupkaet7k04qlsr33c6"
with open(p, "rb") as f:
    pl = plistlib.load(f)
types = pl.setdefault("CFBundleURLTypes", [])
present = any(scheme in (t.get("CFBundleURLSchemes") or []) for t in types)
if present:
    print("Google URL scheme already present — skipping")
else:
    types.append({"CFBundleURLSchemes": [scheme]})
    with open(p, "wb") as f:
        plistlib.dump(pl, f)
    print("✓ Info.plist patched with Google Sign-In URL scheme")
PY

# ── Push: forward APNs registration callbacks to Capacitor ──
# Capacitor 6+ DROPPED the remote-notification handlers from the default
# AppDelegate template. Without them, UIApplication delivers the APNs device
# token to the AppDelegate but nothing forwards it to the
# @capacitor/push-notifications plugin, so PushNotifications.register()
# silently times out with no 'registration' event (and no error). That was
# the root cause of "no iOS push token ever registers". Inject the two
# handlers that re-post the system callbacks as the Capacitor notifications
# the plugin observes. Idempotent (skips if already present). The
# Notification.Name constants live in `import Capacitor`, already imported
# by the template AppDelegate.
APPDELEGATE="ios/App/App/AppDelegate.swift"
if [ -f "$APPDELEGATE" ] && ! grep -q "didRegisterForRemoteNotificationsWithDeviceToken" "$APPDELEGATE"; then
  python3 - "$APPDELEGATE" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
methods = (
    "\n"
    "    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {\n"
    "        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)\n"
    "    }\n"
    "\n"
    "    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {\n"
    "        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)\n"
    "    }\n"
)
idx = s.rstrip().rfind("}")  # final brace = AppDelegate class close
if idx == -1:
    sys.exit("AppDelegate.swift: no closing brace found")
open(p, "w").write(s[:idx] + methods + s[idx:])
print("✓ AppDelegate patched with APNs registration forwarding")
PY
else
  echo "AppDelegate push handlers already present (or file missing) — skipping"
fi

# ── Push: clear the app-icon badge whenever the app opens ──
# A delivered push can leave a badge on the icon, and there's no in-app
# notification center to clear it. Reset the badge on every activate so it
# never sticks. Injects into the existing applicationDidBecomeActive if the
# template has it, otherwise adds the method. Idempotent.
if [ -f "$APPDELEGATE" ] && ! grep -q "applicationIconBadgeNumber" "$APPDELEGATE"; then
  python3 - "$APPDELEGATE" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
needle = "func applicationDidBecomeActive(_ application: UIApplication) {"
i = s.find(needle)
if i != -1:
    j = i + len(needle)
    s = s[:j] + "\n        application.applicationIconBadgeNumber = 0" + s[j:]
else:
    method = (
        "\n"
        "    func applicationDidBecomeActive(_ application: UIApplication) {\n"
        "        application.applicationIconBadgeNumber = 0\n"
        "    }\n"
    )
    idx = s.rstrip().rfind("}")  # final brace = AppDelegate class close
    if idx == -1:
        sys.exit("AppDelegate.swift: no closing brace found")
    s = s[:idx] + method + s[idx:]
open(p, "w").write(s)
print("✓ AppDelegate patched to clear icon badge on activate")
PY
else
  echo "AppDelegate badge-clear already present (or file missing) — skipping"
fi

# CFBundleURLTypes for custom-scheme deep links isn't needed —
# Universal Links via the associated-domains entitlement cover the
# tap-from-email flow, and we don't expose a cardigan:// scheme.

# Two surgical edits to project.pbxproj so manual signing scopes to
# the App target only — NOT to the SPM dependency targets.
#
# Why this matters:
#   xcodebuild CLI build settings (DEVELOPMENT_TEAM, CODE_SIGN_STYLE,
#   CODE_SIGN_IDENTITY, PROVISIONING_PROFILE_SPECIFIER, etc.) apply
#   to EVERY target in the project graph. For SPM dependencies like
#   ion-ios-camera, this surfaces two distinct failures:
#     1. CODE_SIGN_ENTITLEMENTS=App/App.entitlements resolves against
#        each target's SRCROOT → SPM checkout has no such file →
#        archive fails with "The file could not be opened".
#     2. PROVISIONING_PROFILE_SPECIFIER="Cardigan App Store" on a
#        static library target → "X does not support provisioning
#        profiles, but provisioning profile Y has been manually
#        specified".
#
#   Both errors are about CLI overrides leaking into SPM targets.
#   Fix: don't pass signing settings via CLI at all. Set them
#   directly on the App target's Release config in pbxproj, where
#   they stay scoped to that one target. SPM targets fall back to
#   their package-defined config (no signing — they're embedded).
#
# Edit 1 — project-level Release config (id 504EC3151FED79650016851F):
#   Strip the hardcoded `CODE_SIGN_IDENTITY = "iPhone Developer"`
#   that Capacitor templates inherit. Without this, SPM targets
#   inherit the dev identity even when our App target overrides it.
#
# Edit 2 — App target Release config (identified by it being the only
# Release block that already contains CODE_SIGN_ENTITLEMENTS = App/...):
#   Inject the four manual-signing settings. APPLE_TEAM_ID flows in
#   from the workflow env. Idempotent — if the settings are already
#   present (re-run from a half-applied state), leave them alone.
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"
if [ -z "$APPLE_TEAM_ID" ]; then
  echo "APPLE_TEAM_ID env var required for pbxproj signing patch"
  exit 1
fi
MARKETING_VERSION="${MARKETING_VERSION:-20.3}"
APPLE_TEAM_ID="$APPLE_TEAM_ID" MARKETING_VERSION="$MARKETING_VERSION" python3 - "ios/App/App.xcodeproj/project.pbxproj" <<'PY'
import re, sys, os
p = sys.argv[1]
team_id = os.environ["APPLE_TEAM_ID"]
marketing_version = os.environ["MARKETING_VERSION"]
src = open(p).read()

# Capacitor 8's iOS template uses stable IDs in its pbxproj. These two
# are the well-known constants for, respectively, the project-level
# Release config and the App-target Release config:
#   504EC3151FED79650016851F = project-level Release
#   504EC3181FED79650016851F = App-target Release
# Same IDs in every fresh `npx cap add ios` run (verified via probe).
# If a future Capacitor version randomizes these, the patch fails
# loudly with the specific id it couldn't find — which is preferable
# to a silent half-applied patch.

# Edit 1: project-level Release — strip "iPhone Developer" identity.
# Capacitor's template hardcodes this at the project level, which
# SPM dependency targets would otherwise inherit and try to sign with.
proj_pattern = re.compile(
    r'(504EC3151FED79650016851F /\* Release \*/ = \{[\s\S]*?)\n\s*CODE_SIGN_IDENTITY = "iPhone Developer";'
)
src, n = proj_pattern.subn(r'\1', src)
# n=0 acceptable: re-running against a pbxproj that's already been
# stripped (local dev, manual re-apply). n>1 would mean Capacitor
# duplicated the line, which we'd want to know about.
if n > 1:
    sys.exit(f"expected ≤1 strip of project-level CODE_SIGN_IDENTITY, got {n}")

# Edit 2: App target Release config — inject manual signing +
# entitlements + marketing version.
#
# Strategy: match the App target Release block by its stable Capacitor
# ID, then strip any pre-existing copies of the keys we're about to
# set (so the patch is idempotent and survives Capacitor template
# changes), then inject our version of those keys at the top of the
# buildSettings block.
#
# Why we set all of these at the target level rather than the project
# level: anything we set on the project leaks to SPM dependency
# targets (ion-ios-camera et al.), which either fail outright
# (PROVISIONING_PROFILE_SPECIFIER) or resolve paths against the wrong
# SRCROOT (CODE_SIGN_ENTITLEMENTS). Target-level settings stay scoped.
app_pattern = re.compile(
    r'(504EC3181FED79650016851F /\* Release \*/ = \{\s*'
    r'isa = XCBuildConfiguration;\s*'
    r'buildSettings = \{)'
    r'([\s\S]*?)'
    r'(\s*\};\s*name = Release;)',
)
def patch_app_release(m):
    head, body, tail = m.group(1), m.group(2), m.group(3)
    # Strip pre-existing entries we're about to set.
    for key in ("CODE_SIGN_STYLE", "CODE_SIGN_IDENTITY",
                "CODE_SIGN_ENTITLEMENTS", "DEVELOPMENT_TEAM",
                "PROVISIONING_PROFILE_SPECIFIER", "MARKETING_VERSION"):
        body = re.sub(rf'\n\s*{key} = [^;]+;', '', body)
    injection = (
        "\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;"
        "\n\t\t\t\tCODE_SIGN_IDENTITY = \"Apple Distribution\";"
        "\n\t\t\t\tCODE_SIGN_STYLE = Manual;"
        f"\n\t\t\t\tDEVELOPMENT_TEAM = {team_id};"
        f"\n\t\t\t\tMARKETING_VERSION = {marketing_version};"
        "\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = \"Cardigan App Store\";"
    )
    return head + injection + body + tail

src, n = app_pattern.subn(patch_app_release, src, count=1)
if n != 1:
    sys.exit(f"expected 1 match for App-target Release config (id 504EC3181FED79650016851F), got {n}")

open(p, 'w').write(src)
print(f"✓ pbxproj patched: project-level identity stripped + App target Release manual signing + entitlements + MARKETING_VERSION={marketing_version} (team {team_id})")
PY

echo "✓ iOS config applied to ios/App/App/"
