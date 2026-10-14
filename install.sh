#!/usr/bin/env bash
# Digital Window installer / updater for Raspberry Pi OS (Bookworm or newer).
# Safe to re-run: it updates the app and leaves .env and data/ alone.
#
#   From GitHub:       curl -fsSL https://raw.githubusercontent.com/meownoirsoft/lumi/main/install.sh | bash
#   From a release:    tar xzf digital-window-*.tar.gz && ./digital-window/install.sh
#   From a checkout:   ./install.sh
#
# Options (env vars or flags):
#   --no-kiosk          server only; don't touch the desktop / browser autostart
#   --uninstall         stop the service and remove autostart entries (keeps files)
#   REPO_URL=...        git URL to clone (default: the meownoirsoft/lumi repo)
#   INSTALL_DIR=...     where to clone (default ~/digital-window)
#   NASA_API_KEY=...    written to .env on first install (otherwise you're asked)
#   PORT=3000           written to .env on first install
#   SKIP_AUTOLOGIN=1    don't switch the Pi to boot into an auto-logged-in desktop
set -euo pipefail

NODE_MAJOR=22
SERVICE=digital-window
MARK="# digital-window kiosk"

KIOSK=1
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --no-kiosk) KIOSK=0 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) echo "Usage: install.sh [--no-kiosk] [--uninstall]  (see the comments at the top of the script)"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
has()  { command -v "$1" >/dev/null 2>&1; }
pkg()  { sudo DEBIAN_FRONTEND=noninteractive apt-get -o Dpkg::Use-Pty=0 "$@"; }

[ "$(id -u)" -ne 0 ] || die "Run this as your normal desktop user (it uses sudo where needed), not as root."
has sudo || die "sudo is required."

# Get sudo working up front rather than failing halfway through. With a terminal
# we ask for the password once and keep it fresh; without one (cloud-init,
# piped from a script) we can't ask, so stop with a clear message.
if ! sudo -n true 2>/dev/null; then
  if { : </dev/tty; } 2>/dev/null; then
    say "Some steps need administrator rights. Enter your password if asked."
    sudo -v </dev/tty || die "sudo failed."
    while kill -0 $$ 2>/dev/null; do sudo -n true 2>/dev/null; sleep 50; done &
  else
    die "sudo needs a password and there's no terminal to type it into.
       Run the installer from a terminal on the Pi (or over SSH), or for a first-boot
       install use the latest firstboot/user-data-snippet.yaml from the repo."
  fi
fi

RUN_USER=$(id -un)
HOME_DIR=$HOME
LABWC_AUTOSTART="$HOME_DIR/.config/labwc/autostart"
WAYFIRE_INI="$HOME_DIR/.config/wayfire.ini"
XDG_AUTOSTART="$HOME_DIR/.config/autostart/digital-window-kiosk.desktop"
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
CHROMIUM_POLICY=/etc/chromium/policies/managed/digital-window.json

remove_autostart() {
  [ -f "$LABWC_AUTOSTART" ] && sed -i "/$MARK/d" "$LABWC_AUTOSTART"
  [ -f "$WAYFIRE_INI" ] && sed -i "/^digital_window *=/d" "$WAYFIRE_INI"
  rm -f "$XDG_AUTOSTART"
}

if [ "$UNINSTALL" = 1 ]; then
  say "Stopping and removing the $SERVICE service"
  sudo systemctl disable --now "$SERVICE" 2>/dev/null || true
  sudo rm -f "$UNIT_FILE"
  sudo systemctl daemon-reload
  remove_autostart
  sudo rm -f "$CHROMIUM_POLICY"
  say "Done. App files and data were left in place; delete the folder to remove them."
  exit 0
fi

# --- 1. Locate or fetch the app ----------------------------------------------
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
fi

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/server.js" ]; then
  APP_DIR=$SCRIPT_DIR
  say "Installing from $APP_DIR"
  if [ -d "$APP_DIR/.git" ] && has git; then
    git -C "$APP_DIR" pull --ff-only || warn "git pull failed; continuing with the current checkout"
  fi
else
  APP_DIR=${INSTALL_DIR:-$HOME_DIR/digital-window}
  if [ -d "$APP_DIR/.git" ]; then
    say "Updating $APP_DIR"
    git -C "$APP_DIR" pull --ff-only
  else
    REPO_URL=${REPO_URL:-https://github.com/meownoirsoft/lumi.git}
    has git || { pkg update -qq && pkg install -y -qq git; }
    say "Cloning $REPO_URL into $APP_DIR"
    git clone --depth 1 "$REPO_URL" "$APP_DIR"
  fi
fi
cd "$APP_DIR"

# --- 2. Node.js ---------------------------------------------------------------
node_ok() {
  has node || return 1
  # node:sqlite needs 22.13+ (or any 23+).
  node -e 'const [M,m]=process.versions.node.split(".").map(Number); process.exit(M>22||(M===22&&m>=13)?0:1)'
}
if node_ok; then
  say "Node $(node -v) is fine"
else
  say "Installing Node.js $NODE_MAJOR LTS from NodeSource"
  case "$(uname -m)" in
    aarch64|x86_64) ;;
    *) warn "$(uname -m) detected. 64-bit Raspberry Pi OS is recommended; NodeSource may not support this CPU." ;;
  esac
  pkg update -qq
  pkg install -y -qq ca-certificates curl gnupg
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
  pkg install -y -qq nodejs
  node_ok || die "Node $(node -v 2>/dev/null || echo '(missing)') is still too old; install Node 22.13+ and re-run."
fi
NODE_BIN=$(command -v node)

# --- 3. Dependencies ----------------------------------------------------------
if [ -f node_modules/.bundled ]; then
  say "Using the dependencies bundled in the release"
else
  say "Installing npm dependencies"
  npm ci --omit=dev --no-audit --no-fund
fi

# --- 4. Config ----------------------------------------------------------------
if [ ! -f .env ]; then
  key=${NASA_API_KEY:-}
  # Only prompt when there's a real terminal. Under cloud-init/systemd /dev/tty
  # exists but can't be opened, and that would abort the script under set -e.
  if [ -z "$key" ] && { : </dev/tty; } 2>/dev/null; then
    printf 'NASA API key (free at https://api.nasa.gov; Enter = DEMO_KEY): ' > /dev/tty
    read -r -t 300 key < /dev/tty || true
  fi
  { printf 'NASA_API_KEY=%s\nPORT=%s\n' "${key:-DEMO_KEY}" "${PORT:-3000}"
    sed -n '/^# Kiosk/,$p' .env.example; } > .env
  say "Wrote .env"
fi
APP_PORT=$(sed -n 's/^PORT=//p' .env | tail -1)
APP_PORT=${APP_PORT:-3000}

# --- 5. systemd service -------------------------------------------------------
say "Installing the $SERVICE service (runs as $RUN_USER)"
sudo tee "$UNIT_FILE" >/dev/null <<EOF
[Unit]
Description=Digital Window server
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null 2>&1
sudo systemctl restart "$SERVICE"

for _ in $(seq 30); do
  curl -fsS -o /dev/null "http://localhost:$APP_PORT/api/items" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://localhost:$APP_PORT/api/items" \
  || die "The server didn't start. See: journalctl -u $SERVICE -n 50"

# --- 6. Kiosk -----------------------------------------------------------------
if [ "$KIOSK" = 1 ]; then
  say "Setting up the fullscreen player"
  if ! has chromium-browser && ! has chromium; then
    pkg install -y -qq chromium-browser 2>/dev/null || pkg install -y -qq chromium
  fi
  has unclutter || pkg install -y -qq unclutter 2>/dev/null || true
  # Used by the kiosk to set the screen to KIOSK_RESOLUTION on Wayland desktops.
  # wlrctl parks the mouse pointer in the corner so it's hidden.
  if has labwc || has wayfire; then
    has wlr-randr || pkg install -y -qq wlr-randr 2>/dev/null || true
    has wlrctl || pkg install -y -qq wlrctl 2>/dev/null || warn "wlrctl isn't available (Bookworm); the mouse pointer hides once the mouse is moved"
  fi

  # Keep pop-ups off the screen: no camera/mic/location/notification prompts, and
  # no promotions, feature tours, sign-in, sync, translate or password nags.
  # (This applies to Chromium on this Pi generally; --uninstall removes it.)
  sudo install -D -o root -g root -m 0644 "$APP_DIR/kiosk/chromium-policy.json" "$CHROMIUM_POLICY"

  LAUNCH="$APP_DIR/kiosk/chromium-kiosk.sh http://localhost:$APP_PORT/player"
  chmod +x "$APP_DIR/kiosk/chromium-kiosk.sh"
  remove_autostart   # start clean so re-runs don't duplicate entries

  # labwc: a user autostart file replaces the system one, so start from a copy
  # of it (keeps the panel/wallpaper) before adding our line.
  if has labwc; then
    mkdir -p "$(dirname "$LABWC_AUTOSTART")"
    [ -f "$LABWC_AUTOSTART" ] || cp /etc/xdg/labwc/autostart "$LABWC_AUTOSTART" 2>/dev/null || touch "$LABWC_AUTOSTART"
    echo "$LAUNCH & $MARK" >> "$LABWC_AUTOSTART"
  fi

  if has wayfire && [ -f "$WAYFIRE_INI" ]; then
    grep -q '^\[autostart\]' "$WAYFIRE_INI" || printf '\n[autostart]\n' >> "$WAYFIRE_INI"
    sed -i "/^\[autostart\]/a digital_window = $LAUNCH" "$WAYFIRE_INI"
  fi

  # X11 sessions (and a harmless fallback elsewhere).
  mkdir -p "$(dirname "$XDG_AUTOSTART")"
  cat > "$XDG_AUTOSTART" <<EOF
[Desktop Entry]
Type=Application
Name=Digital Window kiosk
Exec=$LAUNCH
X-GNOME-Autostart-enabled=true
EOF

  if has raspi-config; then
    sudo raspi-config nonint do_blanking 1 || warn "Couldn't disable screen blanking"
    if [ "${SKIP_AUTOLOGIN:-0}" != 1 ]; then
      sudo raspi-config nonint do_boot_behaviour B4 || warn "Couldn't enable desktop autologin"
    fi
  else
    warn "raspi-config not found: turn off screen blanking and enable desktop autologin yourself."
  fi
fi

# --- Done ---------------------------------------------------------------------
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
say "Digital Window is running."
echo "    Admin:  http://${IP:-<pi-ip>}:$APP_PORT/admin"
echo "    Player: http://localhost:$APP_PORT/player"
echo "    Logs:   journalctl -u $SERVICE -f"
[ "$KIOSK" = 1 ] && echo "    Reboot to start the fullscreen player:  sudo reboot"
echo "    Update: re-run this installer."
