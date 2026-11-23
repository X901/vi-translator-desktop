# vi-translator-core

VI Translator's reading and translating, taken out of the desktop app so the phone apps (Android,
iOS) and, later, the Android TV app's own streaming mode run the same code. The desktop app
(`src-tauri`) is built on it too: what it reads, translates and shows is exactly what the core does.

Two crates:

| crate | what | used by |
|---|---|---|
| `core/` — `vi-translator-core` | the logic, a plain Rust library: no Tauri, no OCR engine, no capture | the desktop app, `core/ffi` |
| `core/ffi/` — `vi-translator-ffi` | the phone API through [UniFFI](https://mozilla.github.io/uniffi-rs) 0.32 (Kotlin, Swift); builds `libvi_translator_ffi.so` / `.a` | the phone apps |

The host supplies the picture and a text recognizer (ML Kit, Apple Vision; on the desktop the
system's OCR). The core does the rest: reading each area a few ways and keeping the best reading,
steadying lines, speaker names, button icons and coloured words, the translation memory and the
reviewed translations downloaded from https://vitranslator.app, the chosen translation service, the
game's pages (the pause menu, Mission Failed …, from the game's signed pages script, QuickJS), when
each line is shown and hidden, and what the TV page draws.

A phone running this is a "PC" to the existing TV apps (Android TV, LG webOS, Samsung Tizen): it
finds and pairs TVs, and serves them `/tv`, `/tv.json` and `/tv/forget` as the desktop does. The TV
apps need no change.

## The phone API (`core/ffi`)

Generated bindings are checked in: `core/bindings/kotlin/app/vitranslator/core/vi_translator_ffi.kt`
(package `app.vitranslator.core`; needs JNA 5.x on Android: `net.java.dev.jna:jna:<version>@aar`) and
`core/bindings/swift/` (module `ViTranslatorCore`). Names below are Kotlin's; Swift's are the same.
Every call can block (files, network, the reading): call them off the main thread.

### Starting

```kotlin
val engine = Engine(
    dataDir = filesDir.resolve("vit").path,   // settings (config.json), downloads, tvs.json
    dbDir = filesDir.resolve("vit-db").path,  // the translation memory (may be the same folder)
    recognizer = myRecognizer,                // TextRecognizer: the app's OCR
    listener = myListener,                    // EngineListener: what to show
)
engine.prepare("gta6", "ar")                  // game (games()) and language (languages()); starts the downloads
```

`games()`, `languages()` (top-level function; code, English name, own name, right-to-left),
`coreVersion()`.

### Text recognition: `TextRecognizer` (the app implements it)

```kotlin
fun recognize(bgra: ByteArray, width: UInt, height: UInt): List<OcrWord>   // OcrWord(line, text, x, y, w, h)
fun maxDimension(): UInt                                                   // e.g. 4000 (0 = 2600)
```

The picture is grey, dark text on a light background, 4 bytes per pixel (BGRA; the channel order
doesn't matter). Return each word with the number of the text line it's on (0, 1 … in reading
order) and its box in that picture's pixels; no words when it fails. It is called from the
engine's reading thread, two or three times per area and frame (the core reads each crop a few
ways, as the desktop does), so it must be synchronous (ML Kit: `Tasks.await(recognizer.process(…))`).

### Reading: two ways

1. **`processFrame(rgba, width, height): ULong`** — the whole frame (RGBA, rows `width*4` bytes).
   The core crops the areas, calls the recognizer, and also looks for the game's pages. This is
   what the desktop does, and gives the same results. Returns how many ms to wait before the next
   frame (it paces itself: the read interval, faster while a game page is up).
2. **`processAreas(frameWidth, frameHeight, areas: List<AreaWords>): ULong`** — the app crops and
   reads each area itself: `AreaWords(areaId, cropRgba, cropWidth, cropHeight, words: List<CropWord>, sure)`,
   `CropWord(text, line, x, y, w, h)` in crop pixels. No game pages (they need the whole frame
   and read their own regions), and one reading per area instead of the core's several, so some
   lines read less well than with `processFrame`. `sure = false` makes a line wait longer before
   it's translated (text still fading in). An enabled area left out reads as empty.

`noPicture()` when there's no picture (the stream stopped): what's shown goes once that lasts.

`readAreas(): List<ReadArea>` — the areas to read (the profile in use): `id`, `name`, `enabled`,
`x, y, w, h` as fractions of the frame, `centeredOnly`. Crop as the core does:
`x0 = floor(x * width)`, `x1 = floor((x + w) * width)` (clamped to 0..1), the same for y; crops
under 8 px are skipped.

### What to show: `EngineListener` (the app implements it)

Called on the engine's threads; hop to the UI thread.

- `onTranslation(line: TranslatedLine)` — at the moment the desktop's overlays would show it:
  `area`, `en`, `text` (plain, 🎮 for button icons; **empty = clear that area**), `error` (couldn't
  translate: don't draw it), `cached` (from the memory), `atMs` (when the English appeared, Unix
  ms), `json` (the whole desktop event: `segments` with colours and `icon:<png data url>`,
  `en_segments`, `line_h`, `text_box`, `game_box`, `stats`).
- `onScreen(layoutJson: String?)` — a game page to draw (the desktop's `screens::ScreenLayout`),
  null when it's gone. While one is up the areas aren't read.
- `onStatus(message)` — a status line (a translator downloading, OCR or translator problems).
- `onEvent(name, json)` — `"config"` (settings changed by a layout update), `"pages"` (the game's
  pages script changed), `"tv-paired"` (`{"name"}` or `{"error"}`).

Polling instead: `recentLines(max): List<RecentLine>` (`id`, `area`, `en`, `text`, `atMs`; newest
last, the last 200 kept), `overlayStateJson()` (exactly what the TV page draws: areas, style,
`shown` lines, the game page), `memoryStatsJson()`, `perfJson()`.

### Settings

`configJson()` — the desktop's `config.json` (with keys and passwords).
`updateConfig(patch)` — a JSON object of the settings to change, saved:
`{"engine": "deepl", "deepl_key": "…"}`, `{"target_lang": "fr"}`, `{"overlays_enabled": false}` …
`setTargetLang(code)`, `game()`.

Translation services (`engine`): `deepl`, `azure`, `google`, `libre`, `claude`, `openai` with their
keys, as on the desktop. The default, `local` (the free offline model), **is not in the phone
build** (ONNX Runtime is left out: feature `offline`); with it, only lines the translation memory
and the downloaded reviewed translations know are shown, the others come back with an `error`.

### Downloads

`startSync()` (`prepare` calls it) — keeps the reviewed translations and layout updates for the
game and language up to date in the background (what was downloaded before is used at once;
checks hourly; an unchanged download is a 304).

### TVs

| call | what |
|---|---|
| `startTvServer(port): UShort` | serve the TV page on the home network (port 8791 as the desktop; 0 = any). Needed before pairing: the TV loads its page from here. |
| `stopTvServer()` | |
| `homeAddress(): String?` | this phone's IP on the home network |
| `findTvs(): List<FoundTv>` | TV apps waiting to be connected (`GET http://<ip>:8792/vit-tv` across the /24, ~2 s), and Samsung TVs that offered their code (`address = "offered:<id>"`); `connected` |
| `pairTv(address, code, deviceName): String` | connect with the 6-digit code the TV shows (`POST /vit-tv/pair` `{code, pc, pc_name, token}`); `address` from `findTvs` or an IP alone. The TV's name, or `PairException`: `WrongCode`, `TooMany` (the TV shows a new code), `NoAnswer`, `NotSharing` (server not running / no network). Also the `"tv-paired"` event. |
| `listTvs(): List<TvInfo>` | connected TVs (kept in `tvs.json` in `dataDir`); `online`: its page asked for the overlays in the last few seconds |
| `removeTv(id): Boolean` | disconnect: its key stops working, the TV shows a new code |

The server answers connected TVs only (their key in `t=`): `/tv` (the page: `ui/tv.html`,
`common.js`, `fonts.css` and the fonts, bundled in the library), `/tv.json?t=&h=` (long-polled:
the overlay state with its version in `X-State`, 204 when nothing changed for a second),
`/tv/forget`, and `POST /vit-tv/offer` (a Samsung TV offering its code, with `X-VIT`). Requests
must be addressed to an IP (DNS rebinding).

`localViewerUrl(): String?` — `http://127.0.0.1:<port>/tv?t=<key>` for the phone's own preview: a
WebView on it draws the translations over the picture exactly as the TVs do. The key is made once
per run, never saved, and isn't among the connected TVs. None while the server isn't running.

### The live page (other devices on the home network)

The desktop's "Live translations on other devices" page (`ui/live.html`, with its interface
languages), served by the same server while the settings' `lan_page` is on (`updateConfig`):
`/` and `/live.json` (the recent lines), and — when the settings allow it — `POST /control`
(`lan_control`: "Allow changes from that page": overlays, live translations, the language, the
profile's areas, the game's page switches) and `POST /snapshot` (`snap_lan`: a snapshot of the last
frame given to `processFrame`). A change from the page is saved and told as the `"lan-control"` and
`"config"` events; a snapshot from it as `"snapshot"` (its JSON). `lanInfo()`: `{"enabled",
"running", "url", "qr" (SVG), "error"}`.

### Snapshots, game pages, memory, fonts

| call | what |
|---|---|
| `takeSnapshot(rgba, width, height): String` | the desktop's Snapshot button for this picture: the snapshot service (`snap_service`, else `engine`; also `azure-image` / `gemini-image`, which translate the picture itself), the reviewed translations first, a game page's private text covered. JSON: `id`, `w`, `h`, `image` (JPEG data URL), `translated_image`, `blocks` (`rect` fractions, `en`, `segs`, `lines`, `align`, `fg`, `bg` …), `service`, `lang`, `rtl`, `ms`. One at a time. The app saves or shares it itself (the desktop's `save_snapshot_render` only writes the window's drawing to its Pictures folder). |
| `pageOptions(game): String` | the game's pages and the switches its script declares: `{"pages": [{"id", "option"}], "options": [{"id", "name", "about", "on"}]}` |
| `screenJson(): String` | the game page on show now, `{"layout", "reason"}` (as `onScreen` and the desktop's `get_screen`), for a view opened after it appeared |
| `memoryClear()` | forget what the translation memory learned (the downloaded reviewed translations stay) |
| `fontList(): List<String>` | the font families bundled with the pages (Lalezar, Changa, Cairo, Tajawal, Noto Sans Arabic …): what an area's `font_family` can be |

## The Rust API (`core`)

For the desktop and any Rust host:

- `engine::start(Context { cfg, live, memory, sink, paths }) -> Reader`: starts the translator
  and presenter threads; `Reader::step(Input) -> Duration` is one pass (`Input::Frame(&frame,
  &ocr)`, `Input::Areas { w, h, reads }`, `Input::Nothing`). `Reader` isn't `Send` (the pages
  script lives in it): make it on the thread that steps it.
- `ocr::Ocr::with_engine(Box<dyn TextEngine>)`: the core's OCR around the host's recognizer.
- `Sink::emit(event, json)`: "translation", "screen", "status-msg", "config", "pages" — the
  desktop forwards them as Tauri events of the same name.
- `live::Live`: what the overlays show now (shared with the host's own pages), `live::overlay_state`.
- `sync::run(sink, cfg, memory, paths)`: the downloads.
- `tv` (find, pair, `Tvs`), `tv_server::{TvServer, route}` (the desktop serves the TV routes on
  its own home-network page server with `route`), `lan_page::LivePage` (the live page's routes;
  `info`), `net` (HTTP helpers, `lan_ip`).
- `snapshot::{now, make}`: snapshots (`Tools` takes the host's OCR as a function).
- `config`, `langs`, `memory`, `translate`, `pagescript`, `screens`, `speaker`, `phrasebook`,
  `game_icons`: as they were in the desktop app.

The version is the workspace's (the app's): pages scripts' `// requires-app:` compare with it.

## Building

The workspace (top `Cargo.toml`) has `src-tauri`, `core` and `core/ffi`; `cargo build` / `cargo
test` at the top build and test the desktop app and the core. `cargo test -p vi-translator-ffi`
runs the phone API's end-to-end test (a stand-in recognizer).

### Android (`.so` for `arm64-v8a`, `armeabi-v7a`, `x86_64`)

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cargo install cargo-ndk
export ANDROID_NDK_HOME=<sdk>/ndk/28.2.13676358   # NDK 30 fails (the QuickJS bindings)
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o <app>/src/main/jniLibs build -p vi-translator-ffi --release
```

QuickJS (the pages scripts) has no ready-made bindings for Android and iOS, so they're made at
build time with libclang. On Linux and macOS that just works. **On Windows** point it at a
libclang and at the NDK's clang headers (cargo-ndk sets bindgen's sysroot itself):

```powershell
$env:ANDROID_NDK_HOME = "E:\Android\Sdk\ndk\28.2.13676358"
$env:LIBCLANG_PATH = "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\Llvm\x64\bin"
$env:C_INCLUDE_PATH = "$env:ANDROID_NDK_HOME\toolchains\llvm\prebuilt\windows-x86_64\lib\clang\19\include"
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 -o out\jniLibs build -p vi-translator-ffi --release
```

The libraries need only `libc`, `libm`, `libdl` (no `libc++_shared.so`). HTTPS on Android checks
certificates against Mozilla's roots (bundled), not the system's store.

### iOS (XCFramework)

On a Mac: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`, set
`IPHONEOS_DEPLOYMENT_TARGET=15.0` (so Rust and the C parts are built for the same iOS), then as
`.github/workflows/core-mobile.yml` does (job `ios`): build both targets with the SDK as bindgen's
sysroot, generate the Swift bindings, `xcodebuild -create-xcframework` with the header and
`module.modulemap`. The workflow uploads `ViTranslatorCore.xcframework` + `ViTranslatorCore.swift`
(and, job `android`, the `.so` files with the Kotlin bindings) as build artifacts.

### Bindings

```sh
cargo build -p vi-translator-ffi
cargo run -p vi-translator-ffi --features bindgen --bin uniffi-bindgen -- generate \
  --library target/debug/vi_translator_ffi.dll --language kotlin --out-dir core/bindings/kotlin --no-format
# --language swift --out-dir core/bindings/swift; the library is libvi_translator_ffi.so / .dylib elsewhere
```

Package and module names: `core/ffi/uniffi.toml`.

## Licence

AGPL-3.0, like the desktop app and the phone apps (all of them embed chiaki-ng). Up to 1.3.9 it was MIT.
UniFFI is MPL-2.0.
