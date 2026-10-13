# Digital Window

A self-hosted "window" for a TV or monitor. It plays a playlist of **YouTube videos** and **NASA imagery** (APOD, the NASA Image & Video Library, EPIC Earth photos and NASA live streams) in order, on a loop. Everything streams; nothing is downloaded.

- **`/admin`**: paste a YouTube URL or ID, search NASA's library, add feeds, drag to reorder, set durations, toggle items on and off.
- **`/player`**: open this fullscreen on the display (for example a Raspberry Pi in Chromium kiosk mode). Changes made in the admin page reach it within a second, with no reload needed.

## Quick start (any computer)

```bash
npm install
cp .env.example .env      # optional: add a free NASA_API_KEY from https://api.nasa.gov
npm start                 # http://localhost:3000/admin
```

Requires Node 22.13+. Data lives in `data/window.db` (SQLite, via Node's built-in `node:sqlite`, so there are no native modules to compile).

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

Works on a Pi 4 or 5 running **64-bit Raspberry Pi OS (Bookworm or newer) with the desktop**. Run the installer as your normal user, over SSH or in a terminal on the Pi:

```bash
curl -fsSL https://raw.githubusercontent.com/<you>/digital-window/main/install.sh \
  | REPO_URL=https://github.com/<you>/digital-window.git bash
sudo reboot
```

Or, without GitHub, build a bundle on your computer and copy it over:

```bash
npm run pack                                  # → dist/digital-window-<version>.tar.gz
scp dist/digital-window-*.tar.gz pi@<pi-ip>:~
ssh pi@<pi-ip> 'tar xzf digital-window-*.tar.gz && ./digital-window/install.sh'
```

The installer:
1. installs Node 22 LTS if needed
2. installs the app's dependencies, or uses the bundled ones
3. asks for your NASA API key and writes `.env`
4. sets up a systemd service (`digital-window`)
5. adds the fullscreen Chromium player to the desktop's autostart (labwc, Wayfire or X11)
6. turns off screen blanking and switches on desktop autologin

**Updating:** re-run the same command. It pulls or uses the new files, keeps `.env` and `data/`, and restarts the service.

Options: `--no-kiosk` sets up the server only, `--uninstall` removes the service and autostart entries, and `SKIP_AUTOLOGIN=1` leaves the boot settings alone.

Tips:
- Manage the playlist from your phone or laptop at `http://<pi-ip>:3000/admin`.
- Set the display to 1920×1080 rather than 4K (Screen Configuration). It's smoother, and YouTube picks a suitable quality.
- Logs: `journalctl -u digital-window -f`.
- The player reloads itself once a day to keep long-running Chromium healthy.
- On a desktop, press → in the player to skip and `r` to reload.

## Security note

There's no login. Anyone on your network who can reach port 3000 can edit the playlist. Keep it on a trusted LAN, or put it behind a reverse proxy with auth.

## Development

```bash
npm run dev     # restarts on file changes
npm test        # parser + database tests
npm run pack    # build a release tarball in dist/
```
