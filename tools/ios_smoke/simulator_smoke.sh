#!/bin/sh
# Sign in to the Bioptime app on a booted iOS Simulator by driving the real UI, and save screenshots of Home, Plan,
# Coach, Tests and Me. The iOS counterpart of tools/emulator_smoke.sh. It builds a small XCUITest bundle
# (DriverUITests) that targets the installed app by bundle id, so it needs no Accessibility permission and no
# Simulator window.
#
# Needs: Xcode with its licence accepted; a booted simulator with the app installed (`npx expo run:ios
# --configuration Release --no-bundler` in apps/mobile); the API on :3000 in demo mode; the xcodeproj gem, which
# CocoaPods brings in (see apps/mobile/README.md for the CocoaPods install on the system Ruby).
#
#   sh tools/ios_smoke/simulator_smoke.sh [simulator udid] [email] [password]
#
# Output: platform/.local/simulator/*.png plus the accessibility dumps (ui-*.txt) and driver.log.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
PLATFORM="$(cd "$HERE/../.." && pwd)"
UDID="${1:-$(xcrun simctl list devices booted | grep -o '[0-9A-F-]\{36\}' | head -1)}"
EMAIL="${2:-priya.nair@demo.bioptime.test}"
PASSWORD="${3:-Demo-Member-2026!}"
[ -n "$UDID" ] || { echo "no booted simulator (xcrun simctl boot <udid>)"; exit 1; }
WORK="$PLATFORM/.local/ios-driver"
OUT="$PLATFORM/.local/simulator"
export PATH="$HOME/.gem/ruby/2.6.0/bin:$PATH" LANG=en_US.UTF-8
mkdir -p "$WORK" "$OUT"
ruby "$HERE/gen_driver.rb" "$WORK" "$HERE"
echo "building the driver"
xcodebuild build-for-testing -project "$WORK/Driver.xcodeproj" -scheme Driver \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$WORK/DerivedData" -quiet
XCTESTRUN="$(ls "$WORK"/DerivedData/Build/Products/Driver_iphonesimulator*.xctestrun | head -1)"
# The test runner is a simulator process: macOS may silently refuse it access to Desktop/Documents folders, so it
# writes to a temporary folder and the results are copied afterwards.
TMPOUT="$(mktemp -d /tmp/bioptime-sim.XXXXXX)"
PB=/usr/libexec/PlistBuddy
for kv in "BP_OUT=$TMPOUT" "BP_EMAIL=$EMAIL" "BP_PASSWORD=$PASSWORD"; do
  k="${kv%%=*}"; v="${kv#*=}"
  $PB -c "Delete :DriverUITests:EnvironmentVariables:$k" "$XCTESTRUN" 2>/dev/null || true
  $PB -c "Add :DriverUITests:EnvironmentVariables:$k string '$v'" "$XCTESTRUN"
done
# screenshots, not a screen recording: the recording is processed after the test and can hang xcodebuild for minutes
$PB -c "Set :DriverUITests:PreferredScreenCaptureFormat screenshots" "$XCTESTRUN"
# Start signed out: the app keeps its session in the simulator keychain, so reset it (this is a test device).
xcrun simctl terminate "$UDID" com.bioptime.app 2>/dev/null || true
xcrun simctl keychain "$UDID" reset
echo "driving the app on $UDID as $EMAIL"
RESULT="$WORK/result-$(date +%Y%m%d-%H%M%S).xcresult"
TESTLOG="$WORK/last-test.log"
# xcodebuild has stalled on this Mac after a UI-test failure, so a watchdog ends the run; the evidence is on disk by then.
xcodebuild test-without-building -xctestrun "$XCTESTRUN" -destination "platform=iOS Simulator,id=$UDID" \
  -resultBundlePath "$RESULT" > "$TESTLOG" 2>&1 &
XB=$!
WAITED=0
while kill -0 "$XB" 2>/dev/null; do
  if [ "$WAITED" -ge "${SMOKE_TIMEOUT:-360}" ]; then echo "xcodebuild did not finish in ${WAITED}s; stopping it"; kill "$XB" 2>/dev/null || true; break; fi
  sleep 5; WAITED=$((WAITED + 5))
done
wait "$XB" 2>/dev/null || true
grep -E "Test Case|error:|\*\* TEST" "$TESTLOG" || true
cp "$TMPOUT"/* "$OUT"/ 2>/dev/null || true
echo "--- driver.log"; cat "$OUT/driver.log" 2>/dev/null || echo "(no driver.log)"
echo "--- $OUT"; ls "$OUT"
grep -q "done: signed in" "$OUT/driver.log" 2>/dev/null || { echo "smoke test did not complete; see $RESULT"; exit 2; }
