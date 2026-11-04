#!/bin/bash
# 小工具：确认前台是寻迹，再执行 tap / 截图，避免盲点落到浏览器或桌面。
export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator"
PKG=com.trovia.app

focused() {
  adb shell dumpsys window 2>/dev/null | grep -m1 "mCurrentFocus" | grep -q "$PKG"
}

ensure_app() {
  if ! focused; then
    adb shell am force-stop com.android.chrome >/dev/null 2>&1
    adb shell am force-stop $PKG >/dev/null 2>&1
    adb shell am start -n $PKG/.MainActivity >/dev/null 2>&1
    for i in $(seq 1 15); do sleep 1; focused && return 0; done
    echo "app not focused" >&2
    return 1
  fi
}

tap() {
  ensure_app || return 1
  adb shell input tap "$1" "$2"
  sleep "${3:-2}"
}

shot() {
  adb exec-out screencap -p > "/tmp/shots/$1"
  echo "shot $1"
}

dump() {
  adb shell uiautomator dump /sdcard/ui-dump.xml >/dev/null 2>&1
  adb pull /sdcard/ui-dump.xml /tmp/ui-dump.xml >/dev/null 2>&1
  python3 - <<'PY'
import re
x = open('/tmp/ui-dump.xml').read()
for m in re.finditer(r'(?:text|content-desc)="([^"]+)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', x):
    label = m.group(1).strip()
    if not label:
        continue
    x1, y1, x2, y2 = map(int, m.groups()[1:])
    print(f'{label[:30]}\t({(x1+x2)//2},{(y1+y2)//2})')
PY
}

"$@"
