#!/bin/bash
# The client app on an Android emulator (BUILD_PLAN §8.5, AMENDED_PLAN_NOTES §8): install the APK, point it at a scratch
# API through its own Server (testers) screen, open the open preview with its one tap ("Continue without signing in": no
# password ever goes through adb), then visit the nine tabs by their accessibility labels and screenshot each, open the
# first session on Train in the player, open Home's inbox sheet, and scan logcat for crashes. A second pass runs at
# font_scale 1.3 (the system font size a person may choose). Exits non-zero on a crash, a missing tab or a missing step.
#
#   tools/emulator_smoke.sh path/to/app.apk 3991
#
# - The APK must be a tester build (EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=1), so its Server screen takes an address.
# - The port is a scratch API on this Mac, started with BIOPTIME_MODE=demo and OPEN_PREVIEW=1. It is never the live demo:
#   ports 3000, 3100, 3101, 4860 and 8081 are refused. `adb reverse` makes the emulator's 127.0.0.1:<port> this Mac's.
# - The app never reaches the live shared link: the emulator must not resolve public names (a build may carry the
#   shared link and the link relay's topic). With no emulator attached the script boots one itself (AVD, default
#   bioptime_api36) headless on console port EMU_PORT (default 5590) with -dns-server 127.0.0.1, and stops exactly that
#   one at the end. An emulator already running (SERIAL=emulator-NNNN, or the only one attached) is used only when
#   ntfy.sh and trycloudflare.com do not resolve on it.
# - Elements are found by their accessibility labels in `uiautomator dump`, which needs the screen to be idle: the
#   app's decorative loops rest 5 s after the last touch, so a dump that is refused is retried. When a label is not in
#   the dump (a tab scrolled out of the pill), the pill is swiped, and as a last resort the tab's position is computed
#   from the tabs that are in the dump.
# - Screenshots, UI dumps and logcat extracts go to OUT (default .local/emulator/<time>). FONT_PASS=0 skips the 1.3 pass.
set -u
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB_BIN="$ANDROID_HOME/platform-tools/adb"
EMULATOR_BIN="$ANDROID_HOME/emulator/emulator"
HERE="$(cd "$(dirname "$0")" && pwd)"
APK="${1:-${APK:-}}"
PORT="${2:-${API_PORT:-}}"
AVD="${AVD:-bioptime_api36}"
EMU_PORT="${EMU_PORT:-5590}"
FONT_PASS="${FONT_PASS:-1}"
OUT="${OUT:-$HERE/../.local/emulator/$(date +%Y%m%d-%H%M%S)}"
PKG=com.bioptime.app
PY=/Library/Developer/CommandLineTools/usr/bin/python3
[ -x "$PY" ] || PY=python3
TABS="Home Train Bio Life Fuel Coach Tests Store Profile"
BOOTED_PID=""
SERIAL="${SERIAL:-}"

die() { echo "FAIL: $*"; exit "${2:-1}"; }
[ -n "$APK" ] && [ -n "$PORT" ] || die "usage: $0 <apk> <scratch-api-port>"
[ -f "$APK" ] || die "no APK at $APK"
case "$PORT" in ''|*[!0-9]*) die "the port must be a number, not $PORT";; esac
case "$PORT" in 3000|3100|3101|4860|8081) die "refusing port $PORT: it belongs to the live demo";; esac
API="http://127.0.0.1:$PORT"
mkdir -p "$OUT"
curl -fsS --max-time 10 "$API/api/public/config" -o "$OUT/config.json" || die "the scratch API at $API does not answer"
grep -q '"openPreview":true' "$OUT/config.json" || die "the scratch API at $API is not in the open preview: start it with OPEN_PREVIEW=1 (no password goes through adb)" 3

# ---- the emulator
cleanup() {
  [ -n "$SERIAL" ] && { "$ADB_BIN" -s "$SERIAL" shell settings put system font_scale 1.0 >/dev/null 2>&1; "$ADB_BIN" -s "$SERIAL" reverse --remove "tcp:$PORT" >/dev/null 2>&1; }
  if [ -n "$BOOTED_PID" ]; then
    echo "stopping the emulator this script started (pid $BOOTED_PID)"
    "$ADB_BIN" -s "$SERIAL" emu kill >/dev/null 2>&1
    i=0; while kill -0 "$BOOTED_PID" 2>/dev/null && [ $i -lt 30 ]; do sleep 1; i=$((i + 1)); done
    kill -0 "$BOOTED_PID" 2>/dev/null && kill "$BOOTED_PID" 2>/dev/null
  fi
}
trap cleanup EXIT

if [ -z "$SERIAL" ]; then
  ATTACHED=$("$ADB_BIN" devices | awk '/^emulator-[0-9]+[[:space:]]+device$/ {print $1}')
  COUNT=$(printf '%s\n' "$ATTACHED" | grep -c . || true)
  if [ "$COUNT" -gt 1 ]; then die "several emulators are attached: choose one with SERIAL=emulator-NNNN"; fi
  SERIAL="$ATTACHED"
fi
if [ -z "$SERIAL" ]; then
  case "$EMU_PORT" in 3000|3100|3101|4860|8081) die "refusing emulator port $EMU_PORT";; esac
  [ -x "$EMULATOR_BIN" ] || die "no emulator at $EMULATOR_BIN"
  SERIAL="emulator-$EMU_PORT"
  echo "booting $AVD headless on $EMU_PORT with no public DNS (-dns-server 127.0.0.1)"
  "$EMULATOR_BIN" -avd "$AVD" -port "$EMU_PORT" -no-window -no-audio -no-boot-anim -no-snapshot-save -dns-server 127.0.0.1 > "$OUT/emulator.log" 2>&1 &
  BOOTED_PID=$!
  echo "$BOOTED_PID" > "$OUT/emulator.pid"
  "$ADB_BIN" -s "$SERIAL" wait-for-device
  i=0; until [ "$("$ADB_BIN" -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do
    sleep 2; i=$((i + 1)); [ $i -lt 120 ] || die "the emulator did not boot in 4 minutes (see $OUT/emulator.log)"
  done
  sleep 5
fi
ADB() { "$ADB_BIN" -s "$SERIAL" "$@"; }
ADB shell getprop sys.boot_completed | grep -q 1 || die "$SERIAL is not booted"
# the live shared link and the link relay must be out of reach
for HOST in ntfy.sh trycloudflare.com; do
  if ADB shell ping -c 1 -W 2 "$HOST" 2>&1 | grep -q "PING $HOST ("; then
    die "$SERIAL resolves $HOST: boot it with -dns-server 127.0.0.1 (or detach it and let this script boot one), so the app cannot reach the live shared link"
  fi
done
ADB reverse "tcp:$PORT" "tcp:$PORT" >/dev/null || die "adb reverse tcp:$PORT failed"
# the screen in pixels, for swipes (the last line is the override size when one is set)
SIZE=$(ADB shell wm size | sed -nE 's/.*: ([0-9]+)x([0-9]+).*/\1 \2/p' | tail -1)
SW=${SIZE% *}; SH=${SIZE#* }
[ -n "$SW" ] && [ -n "$SH" ] || die "could not read the screen size"
scroll_down() { ADB shell input swipe $((SW / 2)) $((SH * 7 / 10)) $((SW / 2)) $((SH * 3 / 10)) 300; sleep 1; }
scroll_up() { ADB shell input swipe $((SW / 2)) $((SH * 3 / 10)) $((SW / 2)) $((SH * 8 / 10)) 300; sleep 1; }
echo "installing $(basename "$APK") ($(du -h "$APK" | cut -f1)) on $SERIAL; the app reaches the scratch API at $API"
ADB install -r -d "$APK" 2>&1 | tail -1 | grep -q Success || {
  echo "replacing the previously installed test build"; ADB uninstall $PKG >/dev/null 2>&1; ADB install "$APK" 2>&1 | tail -1 | grep -q Success || die "install failed"; }

# ---- helpers
shot() { ADB exec-out screencap -p > "$OUT/$1.png"; echo "  shot $1"; }
# dump NAME: the screen's accessibility tree in $OUT/NAME.xml; retried while uiautomator cannot get an idle state
DUMPS=0; DUMP_RETRIES=0; DUMP_FAILS=0
dump() {
  local i=0
  DUMPS=$((DUMPS + 1))
  while [ $i -lt 8 ]; do
    if ADB shell uiautomator dump /sdcard/ui.xml 2>&1 | grep -q "dumped to"; then
      ADB exec-out cat /sdcard/ui.xml > "$OUT/$1.xml" 2>/dev/null && grep -q "<hierarchy" "$OUT/$1.xml" && return 0
    fi
    i=$((i + 1)); DUMP_RETRIES=$((DUMP_RETRIES + 1)); sleep 2
  done
  DUMP_FAILS=$((DUMP_FAILS + 1))
  echo "  (uiautomator could not get an idle screen for $1)"; : > "$OUT/$1.xml"; return 1
}
# q MODE NAME REGEX [MIN_Y]: xy (centre of the first node whose attributes match), bounds, has; tabxy LABEL (a tab's
# centre from its own node, or computed from the tabs in the dump: the pill's pitch and the label's order)
q() {
  "$PY" -I - "$OUT/$2.xml" "$1" "$3" "${4:-0}" "$TABS" <<'EOF'
import re, sys
path, mode, rx, miny, tabs = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5].split()
try:
    xml = open(path, encoding='utf-8').read()
except OSError:
    sys.exit(1)
nodes = []
for n in re.findall(r'<node [^>]*>', xml):
    m = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
    if m:
        nodes.append((n, tuple(map(int, m.groups()))))
def desc(n):
    m = re.search(r'content-desc="([^"]*)"', n)
    return m.group(1) if m else ''
if mode in ('xy', 'bounds', 'has'):
    for n, (x1, y1, x2, y2) in nodes:
        if re.search(rx, n) and y1 >= miny and x2 > x1 and y2 > y1:
            print({'xy': '%d %d' % ((x1 + x2) // 2, (y1 + y2) // 2), 'bounds': '%d %d %d %d' % (x1, y1, x2, y2), 'has': 'yes'}[mode])
            sys.exit(0)
    sys.exit(1)
if mode == 'tabxy':
    seen = {}
    for n, b in nodes:
        name = desc(n).split(', ')[0]
        if name in tabs and b[2] > b[0]:
            seen[name] = b
    if rx in seen:
        x1, y1, x2, y2 = seen[rx]
        print('%d %d own' % ((x1 + x2) // 2, (y1 + y2) // 2)); sys.exit(0)
    known = sorted(((tabs.index(k), (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, b) for k, b in seen.items()))
    if len(known) >= 2:
        (i0, x0, yc, _), (i1, xx1, _, _) = known[0], known[-1]
        pitch = (xx1 - x0) / (i1 - i0)
        x = x0 + (tabs.index(rx) - i0) * pitch
        print('%d %d computed' % (x, yc)); sys.exit(0)
    sys.exit(1)
if mode == 'tabdir':
    shown = [tabs.index(desc(n).split(', ')[0]) for n, b in nodes if desc(n).split(', ')[0] in tabs and b[2] > b[0]]
    print('left' if not shown or tabs.index(rx) > max(shown) else 'right'); sys.exit(0)
EOF
}
tap() { ADB shell input tap "$1" "$2"; }
# the soft keyboard down (BACK only while it is shown: otherwise BACK would leave the screen)
hide_keyboard() { ADB shell dumpsys input_method 2>/dev/null | grep -q "mInputShown=true" && ADB shell input keyevent KEYCODE_BACK; sleep 1; }
crashed() { ADB logcat -d -b crash 2>/dev/null | grep -q "$PKG"; }
# wait_for NAME REGEX SECONDS: dump until a node matches
wait_for() {
  local i=0
  while [ $i -lt "$3" ]; do
    dump "$1" && q has "$1" "$2" >/dev/null && return 0
    sleep 2; i=$((i + 2))
  done
  return 1
}
# pill_swipe NAME [left|right]: swipe the tab pill (left reveals later tabs), on the row of the tabs in the dump
pill_swipe() {
  local B; B=$(q bounds "$1" 'content-desc="(Home|Train|Bio|Life|Fuel|Coach|Tests|Store|Profile)(, [^"]*)?"') || return 1
  set -- $B
  local y=$(( ($2 + $4) / 2 ))
  if [ "${DIRECTION:-left}" = right ]; then ADB shell input swipe $((SW * 3 / 10)) "$y" $((SW * 7 / 10)) "$y" 300
  else ADB shell input swipe $((SW * 7 / 10)) "$y" $((SW * 3 / 10)) "$y" 300; fi
  sleep 1
}
# goto_tab PASS LABEL: tap the tab by its label, swiping the pill toward it while it is out of view; a position computed
# from the visible tabs is the last resort
goto_tab() {
  local P="$1" T="$2" tries=0 XY=""
  while [ $tries -lt 5 ]; do
    dump "$P-tabs"
    XY=$(q tabxy "$P-tabs" "$T") || XY=""
    case "$XY" in *own) set -- $XY; tap "$1" "$2"; return 0;; esac
    DIRECTION=$(q tabdir "$P-tabs" "$T") pill_swipe "$P-tabs"; tries=$((tries + 1))
  done
  [ -n "$XY" ] || return 1
  echo "  $T: not in the dump, tapped at a position computed from the other tabs"
  set -- $XY; tap "$1" "$2"; return 0
}

set_server() { # through the app's own Server (testers) screen, opened by its deep link
  local P="$1" XY i
  ADB shell am start -a android.intent.action.VIEW -d "bioptime://settings/server" $PKG >/dev/null 2>&1
  local ADDRESS='class="android.widget.EditText"[^>]*content-desc="Address"|content-desc="Address"[^>]*class="android.widget.EditText"'
  wait_for "$P-server" "text=\"Server\"|$ADDRESS" 40 \
    || { shot "$P-no-server-screen"; echo "$P: the Server screen did not open"; return 6; }
  # at a larger font size the Address field sits below the fold, and uiautomator lists only what is on screen
  i=0
  until q has "$P-server" "$ADDRESS" >/dev/null; do
    i=$((i + 1)); [ $i -le 6 ] || { shot "$P-no-address"; echo "$P: no Address field on the Server screen"; return 6; }
    scroll_down; dump "$P-server"
  done
  XY=$(q xy "$P-server" 'content-desc="Address"') || { echo "$P: no Address field"; return 6; }
  set -- $XY; tap "$1" "$2"; sleep 1
  ADB shell input keyevent KEYCODE_MOVE_END
  ADB shell input keyevent $(printf 'KEYCODE_DEL %.0s' $(seq 1 80))
  ADB shell input text "$API"
  hide_keyboard
  dump "$P-server-typed"
  q has "$P-server-typed" "text=\"$API\"" >/dev/null || { shot "$P-server-typed"; echo "$P: the Address field does not read $API"; return 6; }
  # "Use this address" sits below the fields: scroll it into view
  i=0; XY=""
  while [ $i -lt 5 ]; do
    XY=$(q xy "$P-server-typed" 'content-desc="Use this address"') && break
    scroll_down; dump "$P-server-typed"; i=$((i + 1))
  done
  [ -n "$XY" ] || { shot "$P-server-no-button"; echo "$P: no Use this address button"; return 6; }
  set -- $XY; tap "$1" "$2"
  i=0
  until dump "$P-server-applied" && q has "$P-server-applied" "Now using $API" >/dev/null; do
    i=$((i + 1)); [ $i -lt 20 ] || { shot "$P-server-not-applied"; echo "$P: the app did not switch to $API"; return 6; }
    [ $((i % 4)) -eq 0 ] && scroll_down
    sleep 2
  done
  shot "$P-00-server"
  # back to the sign-in: the screen's own button (scrolled into view), else the sign-in's deep link
  i=0; XY=""
  while [ $i -lt 4 ]; do
    XY=$(q xy "$P-server-applied" 'content-desc="Back to sign-in"') && break
    scroll_down; dump "$P-server-applied"; i=$((i + 1))
  done
  if [ -n "$XY" ]; then set -- $XY; tap "$1" "$2"; else ADB shell am start -a android.intent.action.VIEW -d "bioptime://sign-in" $PKG >/dev/null 2>&1; fi
  return 0
}

run_pass() { # run_pass <label>: a cold start, the server, the one tap, the nine tabs, the player, a sheet
  local P="$1" XY N TAB NAME tries
  ADB logcat -c >/dev/null 2>&1; ADB logcat -b crash -c >/dev/null 2>&1
  ADB shell am force-stop $PKG >/dev/null 2>&1
  ADB shell pm clear $PKG >/dev/null 2>&1   # a cold start: no session and no server setting on the device
  ADB shell am start -n $PKG/.MainActivity >/dev/null 2>&1
  sleep 8   # the splash sting
  set_server "$P" || return $?
  wait_for "$P-signin" 'content-desc="Continue without signing in"|text="Continue without signing in"' 40 || { shot "$P-01-sign-in"; echo "$P: no \"Continue without signing in\" card after the server change"; return 3; }
  shot "$P-01-sign-in"
  # what the sign-in offers right after the server change (the switch and the providers come from the new server)
  q has "$P-signin" 'content-desc="Phone"' >/dev/null && echo "  sign-in shows the Email | Phone switch" || echo "  sign-in has no Email | Phone switch (phone sign-in off on this server?)"
  scroll_down; dump "$P-signin-lower"
  q has "$P-signin-lower" '(?i)or continue with|content-desc="Continue with (Google|Apple)"' >/dev/null && echo "  sign-in shows \"Or continue with\"" || echo "  sign-in has no \"Or continue with\" row"
  shot "$P-01-sign-in-lower"
  scroll_up; scroll_up; dump "$P-signin"
  XY=$(q xy "$P-signin" 'content-desc="Continue without signing in"|text="Continue without signing in"'); set -- $XY; tap "$1" "$2"
  wait_for "$P-home" 'content-desc="Home(, [^"]*)?"' 60 || { shot "$P-no-home"; echo "$P: Home did not open after the one tap"; return 4; }
  crashed && { echo "$P: the app crashed after the one tap"; return 4; }
  N=2
  for TAB in $TABS; do
    goto_tab "$P" "$TAB" || { shot "$P-missing-$TAB"; echo "$P: no tab labelled $TAB, nor tabs to place it from"; return 5; }
    sleep 3
    NAME=$(printf '%s-%02d-%s' "$P" "$N" "$(printf '%s' "$TAB" | tr 'A-Z' 'a-z')"); shot "$NAME"; N=$((N + 1))
    crashed && { echo "$P: the app crashed on $TAB"; return 4; }
  done
  # the first session on Train in the player
  goto_tab "$P" Train || { echo "$P: no Train tab"; return 5; }
  sleep 3
  if wait_for "$P-train" 'content-desc="Open [^"]* in the player"' 20; then
    XY=$(q xy "$P-train" 'content-desc="Open [^"]* in the player"'); set -- $XY; tap "$1" "$2"; sleep 4; shot "$P-11-player"
    ADB shell input keyevent KEYCODE_BACK; sleep 2
  else echo "$P: no session to open on Train"; fi
  crashed && { echo "$P: the app crashed in the player"; return 4; }
  # a sheet: Home's inbox (the bell)
  goto_tab "$P" Home || { echo "$P: no Home tab"; return 5; }
  sleep 3
  if wait_for "$P-home2" 'content-desc="Notifications[^"]*"' 20; then
    XY=$(q xy "$P-home2" 'content-desc="Notifications[^"]*"'); set -- $XY; tap "$1" "$2"; sleep 3; shot "$P-12-sheet"
    ADB shell input keyevent KEYCODE_BACK; sleep 2
  else echo "$P: no bell on Home"; fi
  crashed && { echo "$P: the app crashed with the sheet open"; return 4; }
  # logcat: crashes, fatal exceptions, JS errors
  ADB logcat -d -b crash > "$OUT/$P-logcat-crash.txt" 2>/dev/null
  ADB logcat -d 2>/dev/null | grep -E "FATAL EXCEPTION|AndroidRuntime|ReactNativeJS|$PKG" > "$OUT/$P-logcat-app.txt"
  local FATAL; FATAL=$(grep -cE "FATAL|Process: $PKG" "$OUT/$P-logcat-crash.txt" "$OUT/$P-logcat-app.txt" | awk -F: '{s+=$2} END {print s+0}')
  local JSERR; JSERR=$(grep -cE "ReactNativeJS.*(Error|Exception)" "$OUT/$P-logcat-app.txt" || true)
  echo "$P: $FATAL fatal/crash lines, $JSERR JS error lines (logcat in $OUT/$P-logcat-*.txt)"
  [ "$FATAL" -eq 0 ] || return 4
  return 0
}

STATUS=0
ADB shell settings put system font_scale 1.0
echo "pass normal (font scale 1.0)"
run_pass normal || STATUS=$?
if [ $STATUS -eq 0 ] && [ "$FONT_PASS" = 1 ]; then
  ADB shell settings put system font_scale 1.3
  echo "pass font130 (font scale 1.3)"
  run_pass font130 || STATUS=$?
fi
echo "uiautomator: $DUMPS dumps, $DUMP_RETRIES retries (screen not idle yet), $DUMP_FAILS never idle"
echo "screenshots, dumps and logcat in $OUT"
[ $STATUS -eq 0 ] && echo "PASS" || echo "FAIL ($STATUS)"
exit $STATUS
