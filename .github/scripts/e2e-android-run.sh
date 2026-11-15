#!/usr/bin/env bash
# The script reactivecircus/android-emulator-runner runs once the emulator has booted (.github/workflows/e2e-android.yml;
# see .github/CI.md). It installs the x86_64 APK, checks that the demo API the job started still answers, and runs every
# flow in apps/mobile/.maestro. The emulator reaches that API at http://10.0.2.2:3000 (the runner's 127.0.0.1:3000).
# Everything it writes goes to $E2E_OUT, which the workflow uploads whatever the result.
# The action runs each line of its `script` input on its own, so the steps live here and the input is one line.
set -euo pipefail

: "${E2E_APK_DIR:?set E2E_APK_DIR to the folder holding the downloaded APK}"
: "${E2E_OUT:?set E2E_OUT to the output folder}"
: "${E2E_MAESTRO:?set E2E_MAESTRO to the maestro executable}"
mkdir -p "$E2E_OUT/maestro"

shopt -s nullglob
apks=("$E2E_APK_DIR"/*.apk)
if [ "${#apks[@]}" -ne 1 ]; then
  echo "::error::expected one APK in $E2E_APK_DIR, found ${#apks[@]}"
  exit 1
fi

adb wait-for-device
{
  echo "sdk $(adb shell getprop ro.build.version.sdk | tr -d '\r')"
  adb shell wm size | tr -d '\r'
  adb shell wm density | tr -d '\r'
} | tee "$E2E_OUT/device.txt"

# a throwaway emulator: no autofill service, so no "save password?" dialog can cover the app after the sign-in flow
adb shell settings put secure autofill_service null || true

adb install -r -g "${apks[0]}"

if ! curl -fsS --max-time 5 http://127.0.0.1:3000/api/health > /dev/null; then
  echo "::error::the demo API on http://127.0.0.1:3000 no longer answers (see api.log in the artifact)"
  exit 1
fi

"$E2E_MAESTRO" --version
status=0
"$E2E_MAESTRO" test apps/mobile/.maestro \
  --format junit \
  --output "$E2E_OUT/junit.xml" \
  --test-output-dir "$E2E_OUT/maestro" || status=$?

# the app's JavaScript log and crashes, for a failed run (a demo app against a scratch server: nothing private)
adb logcat -d -v time 'ReactNativeJS:V' 'ReactNative:V' 'AndroidRuntime:E' '*:S' > "$E2E_OUT/logcat.txt" 2>&1 || true

exit "$status"
