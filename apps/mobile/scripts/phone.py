#!/usr/bin/env python
"""Drive the Android test phone over adb by testID or visible text.

    python apps/mobile/scripts/phone.py shot <name>          screenshot → <out>/<name>.png, downscaled
    python apps/mobile/scripts/phone.py ids [filter]         what is on screen: testIDs, texts, centres
    python apps/mobile/scripts/phone.py tap <testID|text>    tap the first match (exact id, then text)
    python apps/mobile/scripts/phone.py has <testID|text>    exit 0 when it is on screen
    python apps/mobile/scripts/phone.py wait <testID|text> [seconds]
    python apps/mobile/scripts/phone.py type <text>          into the focused field
    python apps/mobile/scripts/phone.py key <back|home|enter|...>
    python apps/mobile/scripts/phone.py swipe <up|down>      scroll a screen's worth
    python apps/mobile/scripts/phone.py scrollto <testID|text>
    python apps/mobile/scripts/phone.py launch | stop        fit.ignia.app

The app's `testID`s arrive as Android resource-ids, so a flow is written in the
same names the jest tests use. There is no simulator on `winbox`; this is how
a change is looked at on a real phone (the OnePlus 8T, serial 49bae1ea).
Environment: PHONE_SERIAL, PHONE_OUT (default: %TEMP%/ignia-phone), ADB.
"""
import os
import re
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

SERIAL = os.environ.get("PHONE_SERIAL", "49bae1ea")
ADB = os.environ.get("ADB", r"Z:\packages\android-sdk\platform-tools\adb.exe")
OUT = os.environ.get("PHONE_OUT", os.path.join(tempfile.gettempdir(), "ignia-phone"))
PKG = "fit.ignia.app"


def adb(*args, binary=False, timeout=60):
    r = subprocess.run([ADB, "-s", SERIAL, *args], capture_output=True, timeout=timeout)
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def dump():
    """Every node on screen as dicts: id (testID), text, desc, centre, bounds."""
    # The old file is removed first: on a screen that never goes idle (a
    # running workout clock) `uiautomator dump` fails and LEAVES the previous
    # dump in place, which then reads as the current screen (2026-11-20).
    root = None
    for _ in range(2):  # a failed dump already waited ~10 s for idle
        adb("shell", "rm", "-f", "/sdcard/window_dump.xml")
        said = adb("shell", "uiautomator", "dump", "/sdcard/window_dump.xml")
        if "ERROR" not in said:
            xml = adb("exec-out", "cat", "/sdcard/window_dump.xml", binary=True)
            try:
                root = ET.fromstring(xml)
                break
            except ET.ParseError:
                pass
        time.sleep(0.35)
    if root is None:
        print("phone.py: the screen never went idle; no element list (use a screenshot)", file=sys.stderr)
        return []
    nodes = []
    for n in root.iter("node"):
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
        if not m:
            continue
        x1, y1, x2, y2 = map(int, m.groups())
        rid = n.get("resource-id", "")
        nodes.append({
            "id": rid.split(":id/")[-1] if ":id/" in rid else rid,
            "text": n.get("text", ""),
            "desc": n.get("content-desc", ""),
            "x": (x1 + x2) // 2,
            "y": (y1 + y2) // 2,
            "h": y2 - y1,
            "w": x2 - x1,
            "pkg": n.get("package", ""),
        })
    return nodes


def find(target, nodes=None):
    nodes = dump() if nodes is None else nodes
    live = [n for n in nodes if n["w"] > 0 and n["h"] > 0]
    for key in ("id", "text", "desc"):
        hit = [n for n in live if n[key] == target]
        if hit:
            return hit[0]
    low = target.lower()
    for key in ("text", "desc"):
        hit = [n for n in live if low in n[key].lower()]
        if hit:
            return hit[0]
    return None


def tap(target):
    n = find(target)
    if not n:
        print(f"NOT FOUND: {target}")
        return False
    adb("shell", "input", "tap", str(n["x"]), str(n["y"]))
    print(f"tapped {target} @ {n['x']},{n['y']}")
    return True


def wait(target, seconds=20):
    end = time.time() + seconds
    while time.time() < end:
        if find(target):
            print(f"found {target}")
            return True
        time.sleep(1)
    print(f"TIMEOUT waiting for {target}")
    return False


def size():
    m = re.search(r"(\d+)x(\d+)", adb("shell", "wm", "size"))
    return (int(m.group(1)), int(m.group(2))) if m else (1080, 2400)


def swipe(direction):
    w, h = size()
    a, b = (int(h * 0.72), int(h * 0.30)) if direction == "up" else (int(h * 0.30), int(h * 0.72))
    adb("shell", "input", "swipe", str(w // 2), str(a), str(w // 2), str(b), "350")
    time.sleep(0.6)


def shot(name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.png")
    png = adb("exec-out", "screencap", "-p", binary=True)
    with open(path, "wb") as f:
        f.write(png)
    try:
        from PIL import Image

        img = Image.open(path)
        img.thumbnail((540, 1200))
        img.save(path)
    except Exception:
        pass
    print(path)


def main():
    # A Windows console is cp1252; icon glyphs and bullets are not.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) < 2:
        print(__doc__)
        return 64
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "shot":
        shot(args[0] if args else "screen")
    elif cmd == "ids":
        flt = args[0].lower() if args else ""
        for n in dump():
            label = n["id"] or ""
            words = n["text"] or n["desc"]
            if not (label or words) or n["pkg"] == "com.android.systemui":
                continue
            line = f"{label:<34} {words[:70]!r:<74} @{n['x']},{n['y']}"
            if flt in line.lower():
                print(line)
    elif cmd == "tap":
        return 0 if tap(args[0]) else 1
    elif cmd == "has":
        return 0 if find(args[0]) else 1
    elif cmd == "wait":
        return 0 if wait(args[0], float(args[1]) if len(args) > 1 else 20) else 1
    elif cmd == "type":
        adb("shell", "input", "text", args[0].replace(" ", "%s"))
    elif cmd == "key":
        codes = {"back": "4", "home": "3", "enter": "66", "tab": "61", "del": "67", "app_switch": "187"}
        adb("shell", "input", "keyevent", codes.get(args[0], args[0]))
    elif cmd == "swipe":
        swipe(args[0] if args else "up")
    elif cmd == "scrollto":
        for _ in range(12):
            if find(args[0]):
                print(f"found {args[0]}")
                return 0
            swipe("up")
        print(f"NOT FOUND after scrolling: {args[0]}")
        return 1
    elif cmd == "launch":
        adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    elif cmd == "stop":
        adb("shell", "am", "force-stop", PKG)
    else:
        print(__doc__)
        return 64
    return 0


if __name__ == "__main__":
    sys.exit(main())
