#!/usr/bin/env bash
# Opens the player fullscreen. Launched at login by the autostart entry (see README).
URL="${1:-http://localhost:3000/player}"

# A profile used only by the kiosk: no saved tabs, sessions or sign-in from the
# desktop browser, so Chromium has nothing to restore, sync or nag about.
PROFILE="$HOME/.config/digital-window-chromium"
mkdir -p "$PROFILE"

# Wait for the server to come up.
until curl -fsS -o /dev/null "$URL"; do sleep 2; done

# Hide the mouse pointer if unclutter is installed (X11) — Wayland/labwc hides it via CSS.
command -v unclutter >/dev/null && unclutter -idle 0.5 -root &

# Stop Chromium showing "restore pages?" after a power cut.
PREFS="$PROFILE/Default/Preferences"
[ -f "$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"

# --disable-features (Chromium only honours one such switch, so keep them together):
#   WebRtcPipeWireCamera  stops "An app wants to access camera devices" dialogs;
#                         Chromium asks the desktop's camera portal whenever a page
#                         lists media devices, and a display has no camera.
#   ChromeWhatsNewUI      no "What's new" tab after Chromium updates.
#   Translate             no "translate this page?" bar.
# Promotions and feature tours are also turned off by the Chromium policy the
# installer writes to /etc/chromium/policies/managed/digital-window.json.
BROWSER=$(command -v chromium-browser || command -v chromium)
exec "$BROWSER" \
  --kiosk "$URL" \
  --user-data-dir="$PROFILE" \
  --noerrdialogs --disable-infobars --no-first-run --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-features=Translate,WebRtcPipeWireCamera,ChromeWhatsNewUI \
  --autoplay-policy=no-user-gesture-required \
  --deny-permission-prompts \
  --check-for-update-interval=31536000 \
  --password-store=basic
