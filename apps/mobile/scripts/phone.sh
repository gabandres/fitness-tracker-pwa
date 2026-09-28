#!/bin/zsh
#
# Ported verbatim from ~/Repos/poolflow/apps/mobile/scripts/phone.sh on 2026-09-28. The
# phone, its serial and the Tailscale route are the same physical OnePlus 8T; only the
# app it tests differs (fit.ignia.app). Keep the two copies in step.
#
# Put the OnePlus test phone on adb over the network, from whatever state it was left in,
# and print the adb id to hand Maestro (`maestro --device <id>`).
#
#   apps/mobile/scripts/phone.sh (Ignia copy of PoolFlow's, 2026-09-28)
#
# The phone has no cable to this Mac (both ports are taken: Ethernet and the charger), so
# adb reaches it over the network, by its Tailscale address first. Tailscale is what makes
# the route independent of the Wi-Fi: on 2026-09-25 one of the home networks isolated its
# clients (ARP for the phone never completed from the Mac or the Surface, while its mDNS
# announcements still arrived), and the 5 GHz one did not.
#
# adb also re-attaches a paired phone by itself when it sees its mDNS announcement, so the
# same phone can be listed twice. Always name the device (`-s <id>`, `--device <id>`).
#
# What it heals by itself:
#   - the adb server restarted, or the connection dropped  → reconnects
#   - wireless debugging chose a new port                   → finds it by mDNS, then pins 5555
#   - the screen asleep or locked                          → wakes it, dismisses the keyguard
# What it cannot heal, and says so:
#   - the phone rebooted: Android always turns wireless debugging off. One tap on the
#     «Depuración inalámbrica» quick-settings tile turns it back on. Tailscale comes back
#     by itself (always-on VPN, set 2026-09-25).
#   - a screen lock with a PIN or pattern: only a person gets past it. The phone is set to
#     none, and it has to stay that way.
#   - the phone was never paired with this Mac: `adb pair <ip>:<port> <code>` once, from
#     Developer options › Wireless debugging › Pair device with pairing code.
#
# Nothing here is secret. Pairing lives in ~/.android/adbkey — never delete it.

SERIAL=49bae1ea          # the phone's own serial (`getprop ro.serialno`)
FIXED_PORT=5555          # `adb tcpip` port: survives reconnects, not reboots

say() { print -r -- "phone: $*" >&2; }

# The adb id of a connected device that is this phone, or nothing.
# `adb devices` separates id and state with a tab, and an id can hold a space: after the
# phone drops off and comes back, adb names the rediscovered service
# «adb-49bae1ea-j8rU1o (2)._adb-tls-connect._tcp». Split on whitespace, that was two
# words and the phone was never found (2026-09-26).
connected_id() {
  local id
  while IFS= read -r id; do
    [[ "$(adb -s "$id" shell getprop ro.serialno 2>/dev/null | tr -d '\r')" == "$SERIAL" ]] && { print -r -- "$id"; return 0; }
  done < <(adb devices | awk -F'\t' 'NR>1 && $2=="device" {print $1}')
  return 1
}

# Every address the phone might answer on: its Tailscale IP first, then the LAN one.
addresses() {
  command -v tailscale >/dev/null && tailscale status 2>/dev/null | awk '$4=="android" && $0 !~ /offline/ {print $1}'
  # `Android.local` is what the OnePlus announces. The LAN route works on the 5 GHz network
  # and not on the isolated one, so it is only the fallback.
  (dns-sd -G v4 Android.local & local p=$!; sleep 3; kill $p) 2>/dev/null | awk '/Android.local/ && / Add / {print $(NF-1)}'
}

# The ports wireless debugging has announced, newest first. Each time it is switched back
# on, Android announces a new instance — «adb-49bae1ea-j8rU1o (2)», «… (3)» — and the old
# ones linger in the Mac's mDNS cache pointing at ports nothing listens on any more. Taking
# the first name found tried the stale port and gave up (2026-09-26), so every instance is
# resolved and tried, the highest suffix first.
tls_ports() {
  local instance
  (dns-sd -B _adb-tls-connect._tcp local. & local p=$!; sleep 3; kill $p) 2>/dev/null \
    | grep -o "adb-${SERIAL}-[A-Za-z0-9]*\( ([0-9]*)\)\{0,1\}" | awk '!seen[$0]++' \
    | awk '{ n = match($0, /\(([0-9]+)\)/) ? substr($0, RSTART + 1, RLENGTH - 2) : 1; print n "\t" $0 }' \
    | sort -rn | cut -f2- \
    | while IFS= read -r instance; do
        (dns-sd -L "$instance" _adb-tls-connect._tcp local. & local p=$!; sleep 3; kill $p) 2>/dev/null \
          | sed -nE 's/.* can be reached at .*:([0-9]+) .*/\1/p' | head -1
      done | awk '!seen[$0]++'
}

try_connect() {  # <host:port> → 0 when the phone is on adb afterwards
  adb connect "$1" >/dev/null 2>&1
  sleep 1
  if [[ "$(adb devices | awk -v t="$1" '$1==t {print $2}')" == "unauthorized" ]]; then
    # The fixed port uses USB-debugging authorization, not the wireless pairing: the first
    # time from this Mac the phone asks. Give a human time to answer, then check again.
    say "the phone is asking «¿Permitir depuración?» for this Mac — tick «Permitir siempre» and tap Permitir."
    local i; for i in {1..24}; do
      sleep 5
      [[ "$(adb devices | awk -v t="$1" '$1==t {print $2}')" == "device" ]] && break
    done
  fi
  connected_id >/dev/null
}

# Drop connections left `offline` — the wireless-debugging port goes dead the moment the
# phone switches to the fixed one, and a stale entry makes `adb` ask which device.
prune() { adb devices | awk -F'\t' 'NR>1 && $2=="offline" {print $1}' | while IFS= read -r id; do adb disconnect "$id" >/dev/null 2>&1; done; }

# A dozing phone behind its lock screen shows Maestro nothing at all (2026-09-25: every
# assertion failed on a black screen). Wake it and dismiss the keyguard before handing
# over the id. This only works with the screen lock set to «Ninguno»: with a PIN, only a
# person can get past it, and the script says so.
ready() {  # <id>
  adb -s "$1" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
  adb -s "$1" shell wm dismiss-keyguard >/dev/null 2>&1
  sleep 1
  if adb -s "$1" shell dumpsys window 2>/dev/null | grep -q "isKeyguardShowing=true"; then
    say "the lock screen is still up — it has a PIN or pattern. Set Screen lock to «Ninguno» on the"
    say "phone (Contraseña y seguridad › Bloqueo de pantalla); nothing on this side can get past it."
    return 1
  fi
  print -r -- "$1"
}

prune
if id=$(connected_id); then ready "$id"; exit $?; fi

addrs=($(addresses | awk '!seen[$0]++'))
if (( ${#addrs} == 0 )); then
  say "can't see the phone on Tailscale or the LAN. Is it on Wi-Fi, with Tailscale connected?"
  exit 1
fi

# The fixed port first: it answers whenever the phone has not rebooted since it was set.
for a in $addrs; do
  if try_connect "$a:$FIXED_PORT"; then prune; ready "$(connected_id)"; exit $?; fi
done

# Otherwise wireless debugging's own port, then pin the fixed one for next time.
ports=($(tls_ports))
if (( ${#ports} == 0 )); then
  say "wireless debugging is off — the phone has probably rebooted. Pull down Quick Settings"
  say "and tap «Depuración inalámbrica» (or Developer options › Wireless debugging), then run this again."
  exit 1
fi
for port in $ports; do for a in $addrs; do
  if try_connect "$a:$port"; then
    id=$(connected_id)
    if adb -s "$id" tcpip "$FIXED_PORT" >/dev/null 2>&1; then
      sleep 3; prune
      try_connect "$a:$FIXED_PORT" || { say "switched the phone to port $FIXED_PORT but could not reattach"; exit 1; }
    fi
    prune; ready "$(connected_id)"; exit $?
  fi
done; done

say "the phone is announcing port(s) ${ports[*]} but each refused or dropped the connection on: ${addrs[*]}."
say "If that is right after airplane mode or a Wi-Fi change, wireless debugging switched itself off:"
say "turn it on again once Wi-Fi shows connected."
say "If it was never paired with this Mac: Developer options › Wireless debugging › Pair device"
say "with pairing code, then: adb pair <address shown> <code>. Otherwise the route is blocked —"
say "the LAN isolates Wi-Fi clients, so Tailscale must be connected on the phone."
exit 1
