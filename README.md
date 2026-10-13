# Digital Window

Turn a Raspberry Pi and any TV or monitor into a "window" that plays a playlist of **YouTube videos** and **NASA space imagery** in order, on a loop. Everything streams; nothing is downloaded.

- **Admin page**, from your phone or laptop: paste a YouTube link, search NASA's image and video library, add feeds (Astronomy Picture of the Day, live Earth photos, NASA live streams), and drag to reorder.
- **Player**: runs fullscreen on the Pi. Your edits show up within a second.

---

## Install on a Raspberry Pi

**You need:** a Raspberry Pi 4 or 5, a microSD card (16 GB or more), a TV or monitor on HDMI, and an internet connection (Wi-Fi or Ethernet).

Pick one option:

| | Best for |
|---|---|
| [**A. Set it up while flashing the SD card**](#a-set-it-up-while-flashing-the-sd-card) | A new SD card. No keyboard, mouse or SSH needed. |
| [**B. One command on a Pi that's already running**](#b-one-command-on-a-pi-thats-already-running) | A Pi that already has Raspberry Pi OS with the desktop. |
| [**C. Offline bundle**](#c-offline-bundle) | Installing without the Pi cloning from GitHub. |

### A. Set it up while flashing the SD card

Needs **Raspberry Pi Imager 2.0 or newer** and **Raspberry Pi OS (64-bit) with desktop, Trixie (Nov 2025) or newer**. Those versions use *cloud-init* for first-boot setup.

1. **Flash the card.** In [Raspberry Pi Imager](https://www.raspberrypi.com/software/), choose your Pi model and **Raspberry Pi OS (64-bit)**, which is the version with the desktop. In the customisation step, set a **username and password**, your **Wi-Fi** (plus its country) and, optionally, **SSH**. Write the card.
2. **Add the installer.** When Imager finishes, take the card out and put it back in. Open the drive called **`bootfs`** and open the file **`user-data`** in a plain text editor (Notepad, TextEdit in plain-text mode, VS Code…).
3. **Paste** the contents of [`firstboot/user-data-snippet.yaml`](firstboot/user-data-snippet.yaml) at the **end** of `user-data`:
   - Leave the first line, `#cloud-config`, and everything Imager wrote.
   - If `user-data` already has a `runcmd:` or `power_state:` section, add the new lines to that section instead of creating a second one.
   - Optionally, put your free [NASA API key](https://api.nasa.gov) on the `NASA_KEY="DEMO_KEY"` line, keeping the quotes.
   - Save, then eject the card safely.
4. **Boot the Pi** with the card, the screen and the network connected. The first boot takes **5–10 minutes**. It waits for the network, installs everything, then reboots into the fullscreen player.
5. **Open the admin page** from another device on the same network: `http://<hostname>.local:3000/admin`, using the hostname you set in Imager, or `http://<pi-ip>:3000/admin`.

If the player doesn't appear, the install log is at `/var/log/digital-window-install.log` on the Pi (see [Troubleshooting](#troubleshooting)).

### B. One command on a Pi that's already running

Works on 64-bit Raspberry Pi OS **with the desktop**, Bookworm or newer. Open a terminal on the Pi, or SSH in, as your normal user (not root), and run:

```bash
curl -fsSL https://raw.githubusercontent.com/meownoirsoft/digital-window/main/install.sh | bash
sudo reboot
```

It asks for a NASA API key; press Enter to use the rate-limited demo key. After the reboot the player starts fullscreen. The command prints the admin address.

### C. Offline bundle

On any computer with Node 22.13+ and git:

```bash
git clone https://github.com/meownoirsoft/digital-window.git && cd digital-window
npm install && npm run pack                   # → dist/digital-window-<version>.tar.gz
scp dist/digital-window-*.tar.gz <user>@<pi-ip>:~
ssh <user>@<pi-ip> 'tar xzf digital-window-*.tar.gz && ./digital-window/install.sh && sudo reboot'
```

The bundle already contains its dependencies. The Pi still needs internet access to install Node.js (if it doesn't have it) and to stream content.

### What the installer does

1. Installs Node.js 22 LTS if the Pi doesn't already have 22.13 or newer.
2. Downloads the app to `~/digital-window` and writes `.env` with your NASA key and port.
3. Creates a `digital-window` system service that starts on boot and restarts if it crashes.
4. Adds the fullscreen Chromium player to the desktop's autostart (labwc, Wayfire or X11).
5. Turns off screen blanking and sets the Pi to boot to the desktop logged in. Set `SKIP_AUTOLOGIN=1` to leave boot settings alone.

### Updating and removing

- **Update:** run the option B command again. It keeps your playlist (`data/`) and `.env`.
- **Server only, no fullscreen player** (for example a headless Pi that another screen points at): add `--no-kiosk`, as in `... | bash -s -- --no-kiosk`.
- **Remove:** `~/digital-window/install.sh --uninstall`, then delete `~/digital-window` if you don't want the files or playlist.

### Troubleshooting

| Problem | Try |
|---|---|
| Option A: nothing happened after 10+ minutes | SSH in (or plug in a keyboard) and run `cat /var/log/digital-window-install.log`. The most common cause is no network: check the Wi-Fi name, password and country in Imager. |
| Can't open the admin page | `systemctl status digital-window` and `journalctl -u digital-window -n 50` on the Pi. Make sure your phone or laptop is on the same network. |
| Desktop shows but no player | Check the autostart entry: `grep digital ~/.config/labwc/autostart`. You can start the player by hand with `~/digital-window/kiosk/chromium-kiosk.sh`. |
| A video is skipped with ⚠ in the admin page | The owner disabled embedding, or the video is private, removed or region-blocked. This can't be worked around; pick another video. |
| APOD or EPIC fails sometimes | NASA rate-limits `DEMO_KEY`. Put your own key in `~/digital-window/.env` (`NASA_API_KEY=…`), then `sudo systemctl restart digital-window`. |
| Screen goes black after a while | Run `sudo raspi-config` → Display Options → Screen Blanking → No. |

---

## What it plays

| Type | Plays for |
|---|---|
| YouTube video | its full length (or the per-item seconds, if set) |
| YouTube live / NASA live preset | *Live stream duration* setting (default 30 min) |
| NASA image, APOD still | *Still image duration* (default 30 s), with a slow Ken Burns pan |
| NASA video, APOD video | its full length |
| EPIC | slideshow of the latest day's Earth images over *EPIC duration* (default 60 s; at least 2 s per image) |

APOD (Astronomy Picture of the Day) is re-checked each time it comes round, so it changes daily. The "NASA — whatever is live now" preset plays whatever is currently live on NASA's YouTube channel and is skipped when nothing is. To add other channels, edit `presets.json` (any `UC…` channel ID).

Tips:
- Set the display to 1920×1080 rather than 4K (in the desktop's display settings). It's smoother, and YouTube picks a matching quality.
- The player reloads itself once a day to keep a long-running browser healthy.
- On a computer, press → in the player to skip and `r` to reload.

## Why YouTube works here when Anthias/Yodeck often fail

YouTube now refuses embeds that arrive without a proper origin or `Referer`. Players that load the iframe from `file://` or from a bare webview see "Video unavailable" or "Error 153". This app:

- serves the player over real `http://`, with `referrerpolicy="strict-origin-when-cross-origin"`
- drives the official **IFrame Player API**, so it knows when a video ends (and advances at that moment) or errors
- skips anything it can't play (embedding disabled, removed, stalled, offline). The reason appears as a ⚠ on that item in the admin page.

Embedding-disabled videos are also caught when you add them, through YouTube's oEmbed check.

## Run it on any computer

```bash
git clone https://github.com/meownoirsoft/digital-window.git && cd digital-window
npm install
cp .env.example .env      # optional: add a free NASA_API_KEY from https://api.nasa.gov
npm start                 # admin: http://localhost:3000/admin  · player: http://localhost:3000/player
```

Requires Node 22.13+. Data is stored in `data/window.db`, using Node's built-in SQLite, so there's nothing native to compile.

## Security note

There's no login. Anyone on your network who can reach port 3000 can edit the playlist. Keep it on a trusted home or office network, or put it behind a reverse proxy with authentication.

## Development

```bash
npm run dev     # restarts on file changes
npm test        # parser + database tests
npm run pack    # build a release bundle in dist/
```
