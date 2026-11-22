//! PS5 Remote Play inside VI Translator (chiaki-ng, through the `vi-translator-ps` crate): the
//! player signs in to PSN on Sony's own page (for the account ID registering needs), the app finds
//! the PS5 on the home network and registers with it using the PIN the PS5 shows, and from then on
//! the PS5 is a picture source ("ps5:"): its picture goes straight to the reading and the preview
//! (Play shows it full screen), its sound to the speakers, and this computer's controllers to it.
//!
//! What the app keeps (ps5.json in its data folder): the PSN account ID (a number, no password or
//! token) and the PS5's registration keys.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use vi_translator_ps as ps;

use crate::capture::{Shared, YuvColor, YuvFrame};

/// The source value for the PS5.
pub const PREFIX: &str = "ps5:";
const PSN_LABEL: &str = "psn";

// Sony's Remote Play app for PCs, as chiaki-ng signs in with it (gui/include/psnaccountid.h)
const CLIENT_ID: &str = "ba495a24-818c-472b-b12d-ff231c1b5745";
const CLIENT_SECRET: &str = "mvaiZkRsAsI1IBkY";
const REDIRECT: &str = "https://remoteplay.dl.playstation.net/remoteplay/redirect";
const SCOPE: &str = "psn:clientapp referenceDataService:countryConfig.read pushNotification:webSocket.desktop.connect sessionManager:remotePlaySession.system.update";
const TOKEN_URL: &str = "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token";

/// The registered PS5.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Console {
    pub host: String,
    pub nickname: String,
    /// base64 of the 16-byte keys and the 6-byte MAC address
    pub regist_key: String,
    pub rp_key: String,
    pub mac: String,
}

impl Console {
    fn keys(&self) -> Option<([u8; 16], [u8; 16])> {
        let rk: [u8; 16] = B64.decode(&self.regist_key).ok()?.try_into().ok()?;
        let rp: [u8; 16] = B64.decode(&self.rp_key).ok()?.try_into().ok()?;
        Some((rk, rp))
    }
}

/// ps5.json
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Saved {
    /// the PSN account ID (8 bytes, base64)
    #[serde(default)]
    pub account_id: String,
    /// the PSN account's online name, if Sony said
    #[serde(default)]
    pub account_name: String,
    #[serde(default)]
    pub console: Option<Console>,
}

struct Global {
    app: AppHandle,
    file: PathBuf,
    saved: Mutex<Saved>,
    /// the stream asks for the account's login passcode (Some(wrong))
    pin_wanted: Mutex<Option<bool>>,
    pin: Mutex<Option<String>>,
    /// what the last PSN sign-in or registering went wrong with
    error: Mutex<String>,
}

static G: OnceLock<Global> = OnceLock::new();

fn g() -> &'static Global {
    G.get().expect("ps5::init")
}

/// At startup: the app and its data folder.
pub fn init(app: AppHandle, data_dir: &Path) {
    let file = data_dir.join("ps5.json");
    let saved = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let _ = G.set(Global {
        app,
        file,
        saved: Mutex::new(saved),
        pin_wanted: Mutex::new(None),
        pin: Mutex::new(None),
        error: Mutex::new(String::new()),
    });
}

fn save(s: &Saved) {
    let g = g();
    *g.saved.lock().unwrap() = s.clone();
    if let Ok(t) = serde_json::to_string_pretty(s) {
        let _ = std::fs::write(&g.file, t);
    }
    let _ = g.app.emit_to("main", "ps5", status());
}

pub fn saved() -> Saved {
    g().saved.lock().unwrap().clone()
}

/// The Source tab's PS5 panel: signed in? which PS5? does the stream want the login passcode?
pub fn status() -> serde_json::Value {
    let g = g();
    let s = g.saved.lock().unwrap().clone();
    serde_json::json!({
        "signed_in": !s.account_id.is_empty(),
        "account": s.account_name,
        "console": s.console.as_ref().map(|c| serde_json::json!({ "name": c.nickname, "host": c.host })),
        "pin_wanted": *g.pin_wanted.lock().unwrap(),
        "error": g.error.lock().unwrap().clone(),
    })
}

fn set_error(e: impl Into<String>) {
    *g().error.lock().unwrap() = e.into();
    let _ = g().app.emit_to("main", "ps5", status());
}

// ---------------------------------------------------------------------------------------- PSN

fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{b:02X}"));
        }
    }
    o
}

fn login_url() -> String {
    format!(
        "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize?service_entity=urn:service-entity:psn&response_type=code\
         &client_id={CLIENT_ID}&redirect_uri={}&scope={}&request_locale=en_US&ui=pr&service_logo=ps&layout_type=popup\
         &smcid=remoteplay&prompt=always&PlatformPrivacyWs1=minimal",
        enc(REDIRECT),
        enc(SCOPE)
    )
}

/// The account's number (decimal) as Remote Play's account ID: 8 bytes, little-endian.
pub fn account_id_of(user_id: &str) -> Option<[u8; 8]> {
    user_id.trim().parse::<u64>().ok().map(u64::to_le_bytes)
}

/// The account ID (and online name) for the code Sony's page sent back.
fn account_from_code(code: &str) -> anyhow::Result<([u8; 8], String)> {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(20)).build()?;
    let form = format!("grant_type=authorization_code&code={}&scope={}&redirect_uri={}", enc(code), enc(SCOPE), enc(REDIRECT));
    let r = client
        .post(TOKEN_URL)
        .basic_auth(CLIENT_ID, Some(CLIENT_SECRET))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form)
        .send()?;
    let st = r.status();
    let t: serde_json::Value = r.json()?;
    let token = t["access_token"].as_str().ok_or_else(|| anyhow::anyhow!("PSN answered {st}: {t}"))?.to_string();
    let r = client.get(format!("{TOKEN_URL}/{}", enc(&token))).basic_auth(CLIENT_ID, Some(CLIENT_SECRET)).send()?;
    let info: serde_json::Value = r.json()?;
    let id = info["user_id"].as_str().and_then(account_id_of).ok_or_else(|| anyhow::anyhow!("PSN gave no account number"))?;
    Ok((id, info["online_id"].as_str().unwrap_or_default().to_string()))
}

/// Opens Sony's sign-in page in a window of the app. When Sony sends back its code, the account ID
/// is kept and the window closes (the password stays on Sony's page; the token is dropped).
pub fn sign_in(data_dir: &Path) -> Result<(), String> {
    let app = g().app.clone();
    if let Some(w) = app.get_webview_window(PSN_LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    set_error("");
    let url: tauri::Url = login_url().parse().map_err(|e| format!("{e}"))?;
    let done = Arc::new(AtomicBool::new(false));
    let b = WebviewWindowBuilder::new(&app, PSN_LABEL, WebviewUrl::External(url))
        .title("PlayStation Network — VI Translator")
        .inner_size(520.0, 760.0)
        .center()
        .on_navigation(move |u| {
            if !u.as_str().starts_with(REDIRECT) {
                return true;
            }
            if done.swap(true, Ordering::Relaxed) {
                return false;
            }
            let q: std::collections::HashMap<String, String> = u.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
            std::thread::spawn(move || {
                let g = g();
                match q.get("code").filter(|c| !c.is_empty()) {
                    Some(code) => match account_from_code(code) {
                        Ok((id, name)) => {
                            let mut s = saved();
                            s.account_id = B64.encode(id);
                            s.account_name = name;
                            set_error("");
                            save(&s);
                        }
                        Err(e) => set_error(format!("PSN: {e:#}")),
                    },
                    None => set_error(format!(
                        "PSN: {}",
                        q.get("error_description").or(q.get("error")).map(String::as_str).unwrap_or("no code")
                    )),
                }
                if let Some(w) = g.app.get_webview_window(PSN_LABEL) {
                    let _ = w.close();
                }
            });
            false
        });
    // (its own browser profile on Windows, apart from the app's pages and the Xbox player's)
    #[cfg(windows)]
    let b = b.data_directory(data_dir.join("psn-web"));
    #[cfg(not(windows))]
    let _ = data_dir;
    b.build().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn sign_out() {
    let mut s = saved();
    s.account_id.clear();
    s.account_name.clear();
    save(&s);
}

// ---------------------------------------------------------------------------------------- finding and linking

#[derive(Serialize, Clone)]
pub struct Found {
    pub host: String,
    pub name: String,
    pub on: bool,
}

/// The PS5s that answer on the home network within a few seconds.
pub fn find() -> Result<Vec<Found>, String> {
    let known: Vec<std::net::Ipv4Addr> = saved().console.and_then(|c| c.host.parse().ok()).into_iter().collect();
    let list = Arc::new(Mutex::new(Vec::new()));
    let l = list.clone();
    let d = ps::Discovery::start(&known, move |h| *l.lock().unwrap() = h, Arc::new(|_, _| {})).map_err(|e| e.to_string())?;
    let t = Instant::now();
    while t.elapsed() < Duration::from_millis(2500) {
        std::thread::sleep(Duration::from_millis(100));
        // (one answer is usually all there is: stop waiting a little after it)
        if !list.lock().unwrap().is_empty() && t.elapsed() > Duration::from_millis(1200) {
            break;
        }
    }
    drop(d);
    let hosts = list.lock().unwrap().clone();
    Ok(hosts.into_iter().filter(|h| h.ps5).map(|h| Found { host: h.addr, name: h.name, on: h.ready }).collect())
}

/// Registers with the PS5 at `host` with the PIN it shows; keeps its keys. Blocking (up to ~30 s).
pub fn link(host: &str, pin: &str) -> Result<String, String> {
    let s = saved();
    let id: [u8; 8] = B64.decode(&s.account_id).ok().and_then(|v| v.try_into().ok()).ok_or("Sign in to PlayStation Network first.")?;
    let pin: u32 = pin.trim().replace(' ', "").parse().map_err(|_| "The PIN is the 8 digits the PS5 shows.")?;
    let (tx, rx) = std::sync::mpsc::channel();
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let l = log.clone();
    let r = ps::Regist::start(
        host,
        id,
        pin,
        move |res| {
            let _ = tx.send(res);
        },
        Arc::new(move |level, t| {
            if level <= 2 {
                l.lock().unwrap().push(t.to_string());
            }
        }),
    )
    .map_err(|e| e.to_string())?;
    let res = rx.recv_timeout(Duration::from_secs(30));
    drop(r);
    match res {
        Ok(ps::RegistResult::Done(reg)) => {
            let mut s = saved();
            s.console = Some(Console {
                host: host.to_string(),
                nickname: reg.nickname.clone(),
                regist_key: B64.encode(reg.regist_key),
                rp_key: B64.encode(reg.rp_key),
                mac: B64.encode(reg.mac),
            });
            set_error("");
            save(&s);
            Ok(reg.nickname)
        }
        Ok(ps::RegistResult::Cancelled) => Err("Linking was cancelled.".into()),
        _ => {
            let why = log.lock().unwrap().last().cloned().unwrap_or_default();
            Err(format!("The PS5 did not accept the PIN or the account. {why}").trim().to_string())
        }
    }
}

pub fn forget() {
    let mut s = saved();
    s.console = None;
    save(&s);
}

/// The login passcode the stream asked for.
pub fn give_pin(pin: &str) {
    *g().pin.lock().unwrap() = Some(pin.trim().to_string());
}

// ---------------------------------------------------------------------------------------- playing

/// The PS5's picture going to `Shared` while it lives (as a capture card's does).
pub struct Ps5Capture {
    stop: Arc<AtomicBool>,
    handle: std::thread::JoinHandle<()>,
}

impl Ps5Capture {
    pub fn is_finished(&self) -> bool {
        self.handle.is_finished()
    }
    pub fn stop(self) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self.handle.join();
    }
}

/// The picture into the app: every frame as YUY2 for the preview (at the preview rate) and as RGBA
/// for the reading (at the capture rate). The colour is BT.709 studio range once the PS5's own
/// second studio range is stretched out (play::i420_to_yuy2).
struct ToShared {
    shared: Arc<Shared>,
    times: Mutex<(Instant, Instant)>,
    state: Mutex<Option<ps::Event>>,
}

const COLOR: YuvColor = YuvColor { bt709: true, full_range: false };

impl ps::play::Screen for ToShared {
    fn frame(&self, f: ps::play::I420) {
        let (full, preview) = {
            let t = self.times.lock().unwrap();
            (self.shared.full_due(t.0), self.shared.preview_due(t.1))
        };
        if !full && !preview {
            return;
        }
        let yuy2 = ps::play::i420_to_yuy2(&f, true);
        let w = f.w & !1;
        let mut t = self.times.lock().unwrap();
        if full {
            t.0 = Instant::now();
            self.shared.put_full(w, f.h, crate::capture::yuy2_to_rgba(&yuy2, w, f.h, COLOR));
        }
        if preview {
            t.1 = Instant::now();
            self.shared.put_preview_yuv(YuvFrame { w, h: f.h, color: COLOR, data: yuy2 });
        }
    }

    fn event(&self, e: &ps::Event) {
        match e {
            ps::Event::LoginPin { wrong } => {
                *g().pin_wanted.lock().unwrap() = Some(*wrong);
                let _ = g().app.emit_to("main", "ps5", status());
            }
            ps::Event::Connected => {
                *g().pin_wanted.lock().unwrap() = None;
                let _ = g().app.emit_to("main", "ps5", status());
            }
            _ => {}
        }
        *self.state.lock().unwrap() = Some(e.clone());
    }

    fn log(&self, level: i32, text: &str) {
        if level <= 2 || std::env::var_os("VI_TRANSLATOR_DEBUG").is_some() {
            eprintln!("[ps5] {text}");
        }
    }
}

/// Connects to the registered PS5 (waking it if it rests) and plays until stopped, the stream ends
/// or it fails (the manager starts it again).
pub fn start(shared: Arc<Shared>) -> Ps5Capture {
    let stop = Arc::new(AtomicBool::new(false));
    let s2 = stop.clone();
    let handle = std::thread::spawn(move || {
        let set = |s: String| shared.set_status(s);
        let Some(c) = saved().console else {
            set("PS5: link your PS5 in Source first.".into());
            std::thread::sleep(Duration::from_secs(2));
            return;
        };
        let Some((rk, rp)) = c.keys() else {
            set("PS5: its saved keys are damaged; link it again.".into());
            std::thread::sleep(Duration::from_secs(2));
            return;
        };
        // asleep? wake it, and wait until it answers as on
        let state = find().unwrap_or_default().into_iter().find(|f| f.host == c.host || f.name == c.nickname);
        let host = state.as_ref().map(|f| f.host.clone()).unwrap_or(c.host.clone());
        if state.as_ref().is_some_and(|f| !f.on) {
            set(format!("Waking {} …", c.nickname));
            if let Some(cred) = ps::credential(&rk) {
                let _ = ps::wakeup(&host, cred);
            }
            let t = Instant::now();
            while t.elapsed() < Duration::from_secs(40) && !s2.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_secs(2));
                if find().unwrap_or_default().iter().any(|f| f.host == host && f.on) {
                    break;
                }
            }
        }
        if s2.load(Ordering::Relaxed) {
            return;
        }
        set(format!("Connecting to {} …", c.nickname));
        let screen = Arc::new(ToShared {
            shared: shared.clone(),
            times: Mutex::new((Instant::now() - Duration::from_secs(1), Instant::now() - Duration::from_secs(1))),
            state: Mutex::new(None),
        });
        let player = match ps::play::Player::start(&host, &rk, &rp, ps::Video::p1080(60), true, screen.clone()) {
            Ok(p) => p,
            Err(e) => {
                set(format!("PS5: {e}"));
                std::thread::sleep(Duration::from_secs(3));
                return;
            }
        };
        let mut last_status = Instant::now() - Duration::from_secs(5);
        while !s2.load(Ordering::Relaxed) {
            if let Some(pin) = g().pin.lock().unwrap().take() {
                player.login_pin(&pin);
            }
            let ev = screen.state.lock().unwrap().clone();
            if let Some(ps::Event::Quit { error, why }) = ev {
                set(if error { format!("PS5: the stream ended ({why})") } else { format!("PS5: {why}") });
                *g().pin_wanted.lock().unwrap() = None;
                std::thread::sleep(Duration::from_secs(3));
                break;
            }
            if last_status.elapsed() > Duration::from_secs(1) {
                last_status = Instant::now();
                let frames = player.stats.frames.load(Ordering::Relaxed);
                let pads = player.stats.controllers.load(Ordering::Relaxed);
                match ev {
                    Some(ps::Event::LoginPin { .. }) => set(format!("{}: enter your PlayStation login passcode in Source", c.nickname)),
                    _ if frames > 0 => set(format!("Playing on {} ({} controller(s))", c.nickname, pads)),
                    _ => {}
                }
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        drop(player);
    });
    Ps5Capture { stop, handle }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_account_number_becomes_eight_little_endian_bytes() {
        assert_eq!(account_id_of("1"), Some([1, 0, 0, 0, 0, 0, 0, 0]));
        assert_eq!(account_id_of(" 4848584848484848484 "), Some(4848584848484848484u64.to_le_bytes()));
        assert_eq!(account_id_of("x"), None);
    }

    #[test]
    fn sony_s_address_is_escaped() {
        assert_eq!(enc("a b:c/d"), "a%20b%3Ac%2Fd");
        assert!(login_url().contains("redirect_uri=https%3A%2F%2Fremoteplay.dl.playstation.net%2Fremoteplay%2Fredirect"));
    }
}
