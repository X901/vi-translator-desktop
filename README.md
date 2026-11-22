<p align="center">
  <img src="src-tauri/icons/icon.png" alt="VI Translator logo" width="160" />
</p>

<h1 align="center">VI Translator - Desktop</h1>

<p align="center">Live subtitles in your language for Grand Theft Auto VI, read straight from the screen.</p>

---

## What it does

- Reads the game's **subtitles and instructions** and shows them translated, in an overlay or in OBS.
- Translates **game screens** too (menus, mission results, captions), as support for each one arrives
  through automatic updates.
- Works with a **game window**, a **capture card**, or an **OBS source**. It never touches the game.
- Plays **Xbox remote play inside the app** (Windows and macOS): Microsoft's own web player in a window of
  VI Translator, signed in on Microsoft's page, with a controller on the PC. It keeps playing while the app is in front.
- Reads just the **game's part of another app's window** (a streaming or upscaling app with its own panels),
  and draws the translations over **the window you watch**, even when the picture is read elsewhere.
- Sends the game with its translations as a **webcam** to other apps (Discord, Zoom, a streaming app), through
  the *OBS Virtual Camera* that OBS Studio installs (Windows).
- Keeps highlighted words in their **colours** and button **icons** in place.
- With a capture card, plays the **card's sound** on the PC, and shows its picture full screen at the card's frame rate.
- **Snapshot** translates the whole picture at once, from a button or your own **keyboard shortcut** pressed in the game.
- Shows the live translations on a **phone or tablet** on your home network (Show on tab, off by default).
- **Updates itself**: when a new version is out it asks first, then checks its signature and restarts.

## Languages

- **Translation:** Arabic, Hindi, Bengali, Urdu, Indonesian, Turkish, Vietnamese, Persian, Thai,
  Tamil, Telugu, Marathi, Ukrainian, Dutch, Filipino, Malay, Swahili, Romanian, Greek, Czech.
- **Translators:** free offline model (some languages), DeepL, Azure, Google, LibreTranslate, Claude or ChatGPT.
- **App interface:** 33 languages, including right-to-left layouts.

## Download

Get the executable for your system from the [latest release](https://github.com/vi-translator/vi-translator-desktop/releases/latest).
It's portable, so there's nothing to install:

| System | File |
|---|---|
| Windows 10/11 (x64, ARM) | `vi-translator-windows-x64.exe`, `vi-translator-windows-arm64.exe` |
| Linux (x64, ARM) | `vi-translator-linux-x64`, `vi-translator-linux-arm64` |
| macOS 11+ (Apple silicon, Intel) | `vi-translator-macos-universal.dmg` (the app, to drag into Applications), or the bare `vi-translator-macos-arm64`, `vi-translator-macos-x64` |

- **Linux** needs WebKitGTK 4.1 and Tesseract with English, e.g. on Ubuntu/Debian
  `sudo apt install libwebkit2gtk-4.1-0 tesseract-ocr tesseract-ocr-eng`. Window capture works on X11
  (on Wayland, use a capture card or OBS).
- **macOS**: run `chmod +x` on the file and allow it in *System Settings > Privacy & Security*. Window
  capture needs the *Screen Recording* permission. The macOS version hasn't been tested on a Mac yet.

## Getting started

1. Run the app.
2. **Source** tab: pick the game window, capture card or OBS source, or *Xbox (in VI Translator)*.
3. **Translator** tab: pick your language and a translation service.
4. **Game profile** tab: choose *Grand Theft Auto VI*.

## Privacy

The app sends nothing about you or what you play. It only downloads: translations from the project
server, and new versions from GitHub (checked every hour). The text it reads stays on your PC,
except what goes to the translation service you pick in the Translator tab (the free offline one
sends nothing at all), and a snapshot's picture when you choose a service that reads pictures.

The phone page is only served on your home network, and only while you have it turned on; open it
by the address the app shows (the PC's IP address), not a name.

## Build

- **Windows:** Rust (MSVC) and the Visual Studio C++ build tools.
- **Linux:** Rust and the packages listed in [`.github/workflows/release.yml`](.github/workflows/release.yml)
  (WebKitGTK, Tesseract, PipeWire, V4L2 …).
- **macOS:** Rust and the Xcode command-line tools.

```sh
cargo run                  # run (debug)
cargo build --release      # target/release/vi-translator(.exe)
cargo test                 # the app and its core
```

On macOS, a `.dmg` with `VI Translator.app` for Apple silicon and Intel (needs Node.js for the Tauri CLI):

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
cd src-tauri && npx @tauri-apps/cli@2 build --target universal-apple-darwin
```

The reading and translating live in [`core/`](core/README.md) (`vi-translator-core`), shared with
the phone apps through its UniFFI layer (`core/ffi`); `src-tauri` is the desktop app around it.

Releases are built by GitHub Actions when a `vX.Y.Z` tag is pushed (the version must be newer than
the latest release). Each executable is signed for the auto-update with the `UPDATE_SIGNING_KEY_PEM`
secret.

## Credits

- Included fonts (Lalezar, Changa, Cairo, Tajawal, Noto Sans Arabic) are under the SIL Open Font License.
- The offline translator uses OPUS-MT models by Helsinki-NLP (ONNX exports by Xenova).

---

<sub>VI Translator is an unofficial fan project, not affiliated with or endorsed by Rockstar Games
or Take-Two Interactive. "Grand Theft Auto" and "GTA" are trademarks of Take-Two Interactive Software, Inc.</sub>
