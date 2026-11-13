#!/usr/bin/env bash
# Run an in-app debugger command on a USB-connected debug build, without
# touching the phone. The app shows a toast; the output is printed here.
#
#   scripts/usb-debug.sh settings font
#   scripts/usb-debug.sh settings.set fontSizeBody 20
#   scripts/usb-debug.sh help
#
# Needs the debug build running (release builds have no bridge). Long-running
# commands time out after 45s here; their output still lands in
# `adb logcat -s BucketUsb`.
set -euo pipefail

if [ $# -eq 0 ]; then
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

# Gradle installs restart the adb server, which silently drops the Metro port
# reverse and breaks Fast Refresh; re-assert it on every call (cheap, no-op if
# already set).
adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true

cmd="$*"
# Single-quote for the device shell: ' -> '\''
quoted="'${cmd//\'/\'\\\'\'}'"

out="$(adb shell "am broadcast -a com.bucket.DEBUG -p com.bucket --es cmd $quoted")"

if ! grep -q 'Broadcast completed' <<<"$out"; then
  echo "$out" >&2
  exit 1
fi

result="$(sed -n 's/.*Broadcast completed: result=\(-\{0,1\}[0-9]*\).*/\1/p' <<<"$out" | head -1)"
if ! grep -q 'data="' <<<"$out"; then
  echo "No reply from the app: is the debug build running and past startup?" >&2
  exit 1
fi
# Everything after data=" up to the final quote (output may span lines).
awk 'BEGIN{p=0} { if (!p) { i=index($0, "data=\""); if (i) { p=1; $0=substr($0, i+6) } else next } print }' <<<"$out" |
  sed '$ s/"$//'

[ "$result" = "-1" ]
