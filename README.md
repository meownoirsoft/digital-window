# Digital Window

A self-hosted "window" for a TV or monitor. It plays a playlist of **YouTube videos** and **NASA imagery** (APOD, the NASA Image & Video Library, EPIC Earth photos and NASA live streams) in order, on a loop. Everything streams; nothing is downloaded.

- **`/admin`**: paste a YouTube URL or ID, search NASA's library, add feeds, drag to reorder, set durations, toggle items on and off.
- **`/player`**: open this fullscreen on the display (for example a Raspberry Pi in Chromium kiosk mode). Changes made in the admin page reach it within a second, with no reload needed.

## Quick start

```bash
npm install
cp .env.example .env      # optional: add a free NASA_API_KEY from https://api.nasa.gov
npm start                 # http://localhost:3000/admin
```

Requires Node 20+. Data lives in `data/window.db` (SQLite).

## Why YouTube works here when Anthias/Yodeck often fail

YouTube now refuses embeds that arrive without a proper origin or `Referer`. Players that load the iframe from `file://` or from a bare webview see "Video unavailable" or "Error 153". This app:

- serves the player over real `http://`, with `referrerpolicy="strict-origin-when-cross-origin"`
- drives the official **IFrame Player API**, so it knows when a video ends (and advances at that moment) or errors
- skips anything it can't play (embedding disabled, removed, stalled, offline). The reason appears as a ⚠ on that item in the admin page.

Embedding-disabled videos are also caught when you add them, through YouTube's oEmbed check.

## Item types

| Type | Plays for |
|---|---|
| YouTube video | its full length (or the per-item seconds, if set) |
| YouTube live / NASA live preset | *Live stream duration* setting (default 30 min) |
| NASA image, APOD still | *Still image duration* (default 30 s), with a slow Ken Burns pan |
| NASA video, APOD video | its full length |
| EPIC | slideshow of the latest day's Earth images over *EPIC duration* (default 60 s; at least 2 s per image) |

APOD is re-resolved each time it comes round, so it updates daily. The "NASA — whatever is live now" preset finds the current live video on NASA's YouTube channel; when nothing is live it's skipped. Edit `presets.json` to add other channels (any `UC…` channel ID).

## Raspberry Pi kiosk

Tested layout: Raspberry Pi 4 or 5 running Raspberry Pi OS Bookworm (desktop) with Node 20+.

```bash
git clone <this repo> ~/digital-window && cd ~/digital-window && npm install
sudo cp kiosk/digital-window.service /etc/systemd/system/
sudo systemctl enable --now digital-window      # edit User/WorkingDirectory first if not "pi"
```

Then start the browser at login. Which file to edit depends on the compositor (`echo $XDG_SESSION_TYPE`, plus `raspi-config` → Advanced → Wayland):

- **labwc** (Bookworm default since late 2024): add `/home/pi/digital-window/kiosk/chromium-kiosk.sh &` to `~/.config/labwc/autostart`
- **Wayfire**: add `window = /home/pi/digital-window/kiosk/chromium-kiosk.sh` under `[autostart]` in `~/.config/wayfire.ini`
- **X11**: `cp kiosk/digital-window-kiosk.desktop ~/.config/autostart/`

Tips:
- Manage the playlist from your phone or laptop at `http://<pi-ip>:3000/admin`.
- A Pi 4 handles 1080p well; set the display to 1920×1080 rather than 4K (Screen Configuration, or `raspi-config`).
- Disable screen blanking: `raspi-config` → Display Options → Screen Blanking → No.
- The player reloads itself once a day to keep long-running Chromium healthy.
- On a desktop, press → in the player to skip and `r` to reload.

## Security note

There's no login. Anyone on your network who can reach port 3000 can edit the playlist. Keep it on a trusted LAN, or put it behind a reverse proxy with auth.

## Development

```bash
npm run dev     # restarts on file changes
npm test        # YouTube URL parser tests
```
