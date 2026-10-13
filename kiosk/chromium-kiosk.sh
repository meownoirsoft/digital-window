#!/usr/bin/env bash
# Opens the player fullscreen. Launched at login by the autostart entry (see README).
URL="${1:-http://localhost:3000/player}"

# Wait for the server to come up.
until curl -fsS -o /dev/null "$URL"; do sleep 2; done

# Hide the mouse pointer if unclutter is installed (X11) — Wayland/labwc hides it via CSS.
command -v unclutter >/dev/null && unclutter -idle 0.5 -root &

# Stop Chromium showing "restore pages?" after a power cut.
PREFS="$HOME/.config/chromium/Default/Preferences"
[ -f "$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"

BROWSER=$(command -v chromium-browser || command -v chromium)
exec "$BROWSER" \
  --kiosk "$URL" \
  --noerrdialogs --disable-infobars --no-first-run \
  --disable-session-crashed-bubble --disable-features=Translate \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --password-store=basic
