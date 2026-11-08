# PacketSniffer on Linux

## Install

Download `packetsniffer_<version>_amd64.deb` from the repository's **Releases** page
(or from the **Actions** run's `packetsniffer-deb` artifact) and install it:

```bash
sudo apt install ./packetsniffer_0.2.0_amd64.deb
```

Supported: Ubuntu 22.04+, Debian 12+ and derivatives (x86-64).
Start it from the application menu or with `packetsniffer`.
Uninstall with `sudo apt remove packetsniffer`.

## Where things are stored

| What | Location |
|---|---|
| Traffic database | `~/.local/share/PacketSniffer/data/` |
| Root CA + host certificates | `~/.local/share/PacketSniffer/certificates/` (mode 0700) |
| Backend log (recreated every launch) | `~/.local/share/PacketSniffer/backend.log` |
| Selected Gemini model | `~/.config/PacketSniffer/ai.json` |
| Gemini API key | system keyring (GNOME Keyring, KDE Wallet, KeePassXC...) |

`XDG_DATA_HOME` / `XDG_CONFIG_HOME` are respected.

### API key storage

The key is stored in the Secret Service keyring, the Linux equivalent of the
Windows Credential Manager. If no keyring is available (minimal window managers,
containers) or it cannot be unlocked, PacketSniffer stores the key in
`~/.config/PacketSniffer/gemini_api_key.secret` instead (file mode 0600, folder
mode 0700). The AI settings panel tells you which one is in use. When a keyring
becomes available again, the next time you save the key it moves there and the
file is deleted.

## Certificate for HTTPS inspection

"Download certificate" saves `packetsniff-ca.crt` into your Downloads folder
and shows the exact path. Import it in your browser (Firefox: *Settings > Privacy
& Security > View Certificates > Authorities > Import*). PacketSniffer never
changes system-wide trust.

## Build it yourself

```bash
# system packages (Ubuntu / Debian)
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
     libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf xdg-utils

# 1. backend (PyInstaller)
python3 -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements-build.txt
bash backend/build_backend.sh

# 2. desktop app + .deb  (needs Node 22 and Rust >= 1.90)
cd webkeeper
npm ci
npx tauri build --bundles deb
# -> webkeeper/src-tauri/target/release/bundle/deb/*.deb
```

On GitHub, `.github/workflows/build-deb.yml` does this automatically on every push.
Pushing a tag such as `v0.2.0` also attaches the `.deb` to a GitHub Release.

## Troubleshooting

* **Blank window**: the app already disables WebKitGTK's DMA-BUF renderer, the
  usual cause. If you still see one, try `WEBKIT_DISABLE_COMPOSITING_MODE=1 packetsniffer`.
* **"Backend failed to start"**: read `~/.local/share/PacketSniffer/backend.log`.
  Check that nothing else is using port 8765 (API) or 8080 (proxy).
* **A password prompt appears when the app starts**: your keyring is locked.
  Unlock it; the app keeps starting meanwhile and loads the key as soon as it is available.
