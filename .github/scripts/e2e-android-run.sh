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

# The runner has no GPU, so the emulator draws in software (SwiftShader), and at full resolution this app's glass, glow
# and motion starve it: Maestro's on-device driver timed out reading the screen ("Device server died during
# 'viewHierarchy'") on 3 of 4 device runs. Halve the pixels and the density together: the size in dp, and so the
# phone/tablet layout, stays the same, while the drawing work drops about four times.
size=$(adb shell wm size | tr -d '\r' | awk '/Physical size/ {print $3}')
density=$(adb shell wm density | tr -d '\r' | awk '/Physical density/ {print $3}')
w=${size%x*}; h=${size#*x}
adb shell wm size "$((w / 2))x$((h / 2))"
adb shell wm density "$((density / 2))"
echo "display for the flows: $((w / 2))x$((h / 2)) at density $((density / 2)) (same dp size as ${size} at ${density})" | tee -a "$E2E_OUT/device.txt"

# a throwaway emulator: no autofill service, so no "save password?" dialog can cover the app after the sign-in flow
adb shell settings put secure autofill_service null || true

# a CI emulator's system apps (the launcher above all) sometimes stop answering under load, and Android then covers the
# app with an "isn't responding" dialog that hides it from Maestro: hide those dialogs and close any already open
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put global anr_show_background 0 || true
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true

adb install -r -g "${apks[0]}"

if ! curl -fsS --max-time 5 http://127.0.0.1:3000/api/health > /dev/null; then
  echo "::error::the demo API on http://127.0.0.1:3000 no longer answers (see api.log in the artifact)"
  exit 1
fi

"$E2E_MAESTRO" --version
status=0
# One flow per Maestro run, each with one retry: when the on-device driver dies, the flows after it no longer fail
# with it ("Unknown error" in 20 ms), and a flow that hit a slow moment on the emulator gets a second chance. Each run
# has a hard limit (on the first CI run Maestro never exited after the emulator died, and the job hung for 75 minutes).
shopt -s nullglob
flows=(apps/mobile/.maestro/*.yaml)
: > "$E2E_OUT/attempts.txt"
for flow in "${flows[@]}"; do
  name=$(basename "$flow" .yaml)
  passed=0
  for attempt in 1 2; do
    if timeout --signal=TERM --kill-after=60 10m "$E2E_MAESTRO" test "$flow" \
        --format junit \
        --output "$E2E_OUT/junit-$name.xml" \
        --test-output-dir "$E2E_OUT/maestro/$name-try$attempt"; then
      passed=1
      echo "$name: passed on try $attempt" | tee -a "$E2E_OUT/attempts.txt"
      break
    fi
    echo "$name: failed on try $attempt" | tee -a "$E2E_OUT/attempts.txt"
    # let the emulator settle; if it is gone (offline or frozen), stop here instead of waiting for it forever
    sleep 15
    if ! timeout 120 adb wait-for-device || ! timeout 30 adb shell true > /dev/null 2>&1; then
      echo "::error::the emulator stopped answering after '$name' failed; the remaining flows were not run"
      echo "$name: emulator gone after try $attempt; later flows not run" | tee -a "$E2E_OUT/attempts.txt"
      status=1
      break 2
    fi
  done
  [ "$passed" = 1 ] || status=1
done

# one JUnit report for the summary step: the last try of each flow
python3 - "$E2E_OUT" <<'PY'
import glob, os, sys
import xml.etree.ElementTree as ET
out = sys.argv[1]
suite = ET.Element("testsuite", name="Bioptime e2e")
for path in sorted(glob.glob(os.path.join(out, "junit-*.xml"))):
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError:
        continue
    for case in root.iter("testcase"):
        suite.append(case)
cases = suite.findall("testcase")
suite.set("tests", str(len(cases)))
suite.set("failures", str(sum(1 for c in cases if c.find("failure") is not None)))
tree = ET.ElementTree(ET.Element("testsuites"))
tree.getroot().append(suite)
tree.write(os.path.join(out, "junit.xml"), encoding="utf-8", xml_declaration=True)
PY

# the app's JavaScript log and crashes, for a failed run (a demo app against a scratch server: nothing private)
timeout 60 adb logcat -d -v time 'ReactNativeJS:V' 'ReactNative:V' 'AndroidRuntime:E' '*:S' > "$E2E_OUT/logcat.txt" 2>&1 || true

exit "$status"
