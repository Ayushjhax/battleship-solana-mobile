#!/bin/bash
# Signs an EAS-built APK (`eas build --platform android --profile dapp-store`)
# for the Solana dApp Store with the app's private release key.
#
#   bash scripts/sign-dapp-store-apk.sh <eas-build.apk> [out.apk]
#
# EAS signs with its own keystore; that signature is replaced here, so the
# release key never leaves this machine. The APK carries an APK Signature
# Scheme v3 rotation lineage from the old public debug key (which signed every
# sideloaded build until 2026-10-10) to the release key: an installed
# debug-signed copy updates in place, keeping its data. The debug key keeps
# only that "installed data" capability in the lineage — no permission, auth
# or shared-UID trust.
#
# v3 only: app.json sets minSdkVersion 28 (Android 9, the first with v3), so no
# v1/v2 signature — which would have to come from the lineage's oldest key,
# the public debug key — is needed or made.
#
# Keys live outside the repo, in $EOB_KEYS_DIR (default ~/secure/empire-of-bits):
#   release.jks             PKCS12, alias empireofbits
#   keystore-password.txt   its password, one line
#   rotation.lineage        debug key -> release key
# Every later dApp Store update must be signed this way, with the same three files.
set -euo pipefail

IN=${1:?usage: sign-dapp-store-apk.sh <eas-build.apk> [out.apk]}
OUT=${2:-dist/empire-of-bits-dapp-store.apk}
KEYS=${EOB_KEYS_DIR:-$HOME/secure/empire-of-bits}
SDK=${ANDROID_HOME:-$HOME/Library/Android/sdk}
TOOLS=$(ls -d "$SDK"/build-tools/*/ | sort -V | tail -1)
APKSIGNER="${TOOLS}apksigner"
RELEASE_SHA256=cc5d0222bcee8e79ee3f0c3968090d2721e14c4645b52ce2ab519a5910b4fa49
DEBUG_SHA256=fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c

for f in release.jks keystore-password.txt rotation.lineage; do
  [ -f "$KEYS/$f" ] || { echo "missing $KEYS/$f" >&2; exit 1; }
done

MIN_SDK=$("${TOOLS}aapt2" dump badging "$IN" | sed -nE "s/^minSdkVersion:'([0-9]+)'.*/\1/p")
if [ "${MIN_SDK:-0}" -lt 28 ]; then
  echo "minSdkVersion is ${MIN_SDK:-unknown}; v3-only signing needs 28 (app.json expo-build-properties)" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
"$APKSIGNER" sign \
  --ks "$KEYS/release.jks" --ks-key-alias empireofbits --ks-pass "file:$KEYS/keystore-password.txt" \
  --lineage "$KEYS/rotation.lineage" \
  --v1-signing-enabled false --v2-signing-enabled false --v3-signing-enabled true \
  --rotation-min-sdk-version 28 --min-sdk-version 28 \
  --out "$OUT" "$IN"
rm -f "$OUT.idsig"

REPORT=$("$APKSIGNER" verify -v --print-certs --min-sdk-version 28 "$OUT")
echo "$REPORT" | grep -E "Verified using|Signer #1 certificate SHA-256" || true
echo "$REPORT" | grep -q "Signer #1 certificate SHA-256 digest: $RELEASE_SHA256" \
  || { echo "FAIL: $OUT is not signed by the release key" >&2; exit 1; }
"$APKSIGNER" lineage --in "$OUT" --print-certs 2>/dev/null | grep -q "$DEBUG_SHA256" \
  || { echo "FAIL: $OUT carries no lineage from the debug key" >&2; exit 1; }
echo "ok    $OUT: release key, with the debug-key lineage (in-place update from sideloaded builds)"
