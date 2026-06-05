#!/usr/bin/env bash
# Generate the Cardigan Android release upload keystore + companion
# keystore.properties. Run ONCE per machine, on the Mac where you'll
# be producing Play Store uploads.
#
# Result:
#   android/cardigan-upload.keystore   — RSA-2048, 100-year validity.
#                                        BACK THIS UP. Losing it triggers
#                                        Google's key-reset appeal flow
#                                        (1–2 day turnaround).
#   android/keystore.properties        — passwords for the gradle build.
#                                        Both files are gitignored.
#
# Once generated, build a signed AAB with:
#   npm run cap:bundle:android
#
# After the first AAB is uploaded to Play Console and enrolled in Play
# App Signing, paste the resulting App Signing key SHA-256 (from
# Play Console → Setup → App integrity → App signing) into
# public/.well-known/assetlinks.json's sha256_cert_fingerprints array
# to flip Android App Links auto-verify to ✓.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYSTORE="$REPO_ROOT/android/cardigan-upload.keystore"
PROPS="$REPO_ROOT/android/keystore.properties"

if [ -f "$KEYSTORE" ]; then
  echo "Keystore already exists at $KEYSTORE — refusing to overwrite."
  echo "If you really mean to regenerate, delete the file first and rerun."
  exit 1
fi

if ! command -v keytool >/dev/null 2>&1; then
  echo "keytool not found. Install a JDK (e.g. 'brew install --cask temurin') and retry."
  exit 1
fi

read -r -s -p "Store password (≥6 chars, REMEMBER THIS — losing it bricks Play uploads): " STORE_PW
echo
read -r -s -p "Confirm store password: " STORE_PW2
echo
[ "$STORE_PW" = "$STORE_PW2" ] || { echo "Passwords don't match."; exit 1; }
[ "${#STORE_PW}" -ge 6 ] || { echo "Password must be at least 6 characters."; exit 1; }

# Reuse the store password as the key password — Play Console accepts
# it and one fewer secret to track is one fewer to leak.
KEY_PW="$STORE_PW"

keytool -genkeypair -v \
  -keystore "$KEYSTORE" \
  -storepass "$STORE_PW" \
  -keypass "$KEY_PW" \
  -keyalg RSA -keysize 2048 -validity 36500 \
  -alias cardigan-upload \
  -dname "CN=Cardigan, OU=Apps, O=Cardigan, L=Ciudad de Mexico, ST=CDMX, C=MX"

cat > "$PROPS" <<EOF
storeFile=cardigan-upload.keystore
storePassword=$STORE_PW
keyAlias=cardigan-upload
keyPassword=$KEY_PW
EOF
chmod 600 "$PROPS"

echo
echo "✔ Keystore generated at $KEYSTORE"
echo "✔ keystore.properties written"
echo
echo "Upload-key SHA-256 fingerprint (for assetlinks.json — note this is"
echo "your UPLOAD key, NOT the App Signing key Google generates. Use the"
echo "App Signing key SHA from Play Console once you've uploaded the first"
echo "AAB):"
echo
keytool -list -v -keystore "$KEYSTORE" -storepass "$STORE_PW" -alias cardigan-upload 2>/dev/null | grep 'SHA256:'
echo
echo "Next:"
echo "  1. Back up android/cardigan-upload.keystore + the store password."
echo "     Recommended: 1Password vault + a second offline copy (encrypted USB)."
echo "  2. npm run cap:bundle:android  → produces app-release.aab"
echo "  3. Upload the AAB to Play Console (Internal Testing track first)."
echo "  4. Enroll in Play App Signing during the upload flow."
echo "  5. Copy the App Signing SHA-256 from Play Console → App integrity"
echo "     and paste it into public/.well-known/assetlinks.json."
