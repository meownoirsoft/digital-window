#!/usr/bin/env bash
# Turns the display on or off. Must run inside the desktop session (it needs
# WAYLAND_DISPLAY or DISPLAY), so the kiosk launcher starts it in "follow" mode.
#
#   screen-power.sh on|off               switch the display now
#   screen-power.sh follow URL [PID]     poll URL (the server's /api/screen/power,
#                                        which answers "on" or "off") and switch
#                                        whenever it changes; stops when PID exits
#
# KIOSK_SCREEN_POWER in the app's .env picks how:
#   both  (default) HDMI-CEC standby for TVs, and stop the video signal (DPMS)
#   cec   only HDMI-CEC: the TV goes to standby and wakes again
#   dpms  only stop the video signal: monitors sleep, many TVs show "no signal"
#   none  leave the display alone; the player just shows black
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
setting() { sed -n "s/^$1=//p" "$HERE/../.env" 2>/dev/null | tail -1; }
MODE=${KIOSK_SCREEN_POWER:-$(setting KIOSK_SCREEN_POWER)}; MODE=${MODE:-both}

log() { echo "screen-power: $*" >&2; }

# HDMI-CEC, through the kernel's CEC devices (one per HDMI port on a Pi).
cec() {
  command -v cec-ctl >/dev/null || return 0
  for dev in /dev/cec*; do
    [ -e "$dev" ] || continue
    # Register as a playback device so the TV accepts our messages.
    cec-ctl -d "$dev" --playback --osd-name Lumi >/dev/null 2>&1 || continue
    if [ "$1" = off ]; then
      cec-ctl -d "$dev" --to 0 --standby >/dev/null 2>&1 || log "$dev: standby failed"
    else
      cec-ctl -d "$dev" --to 0 --image-view-on >/dev/null 2>&1 || log "$dev: wake failed"
      # Ask the TV to switch to our input.
      pa=$(cec-ctl -d "$dev" 2>/dev/null | sed -n 's/.*Physical Address *: *\([0-9a-f.]*\).*/\1/p' | head -1)
      [ -n "$pa" ] && [ "$pa" != f.f.f.f ] && cec-ctl -d "$dev" --to 15 --active-source "phys-addr=$pa" >/dev/null 2>&1
    fi
  done
}

# Display power management: the output stops sending a picture but keeps its
# mode and layout, so the fullscreen player comes back exactly as it was.
dpms() {
  if [ -n "${WAYLAND_DISPLAY:-}" ]; then
    if command -v wlopm >/dev/null; then
      wlopm "--$1" '*' || log "wlopm --$1 failed"
    else
      log "wlopm isn't installed; can't switch the display $1 (sudo apt install wlopm)"
    fi
  elif [ -n "${DISPLAY:-}" ] && command -v xset >/dev/null; then
    xset +dpms && xset dpms 0 0 0 && xset dpms force "$1" || log "xset dpms force $1 failed"
  fi
}

switch() {
  case "$MODE" in
    none) return ;;
    cec) cec "$1" ;;
    dpms) dpms "$1" ;;
    *) # Wake the signal before the TV so it has a picture to show, and tell
       # the TV to sleep before the signal disappears.
       if [ "$1" = on ]; then dpms on; cec on; else cec off; dpms off; fi ;;
  esac
}

case "${1:-}" in
  on|off) switch "$1" ;;
  follow)
    url=${2:?usage: screen-power.sh follow URL [PID]}
    pid=${3:-}
    # The screen is on when the kiosk starts; only act on changes from there,
    # so a reboot during working hours doesn't fight a TV switched off by hand.
    state=on
    while [ -z "$pid" ] || kill -0 "$pid" 2>/dev/null; do
      want=$(curl -fsS --max-time 5 "$url" 2>/dev/null)
      if { [ "$want" = on ] || [ "$want" = off ]; } && [ "$want" != "$state" ]; then
        log "turning the display $want"
        switch "$want"
        state=$want
      fi
      sleep 15
    done
    # If the kiosk exits while the display is asleep, don't leave it dark.
    [ "$state" = off ] && switch on
    ;;
  *) echo "usage: screen-power.sh on|off|follow URL [PID]" >&2; exit 2 ;;
esac
