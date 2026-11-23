//! The phone API end to end, with a stand-in recognizer: a line read in the subtitles area reaches
//! the listener; the TV page server answers connected TVs only; connecting a TV that isn't there
//! says so.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vi_translator_ffi::{Engine, EngineListener, OcrWord, PairError, TextRecognizer, TranslatedLine};

/// "Meet me at the docks." centred at the bottom of whatever picture it's given (where GTA VI's
/// line 1 is: the subtitles area is read up from there).
struct Fake;

impl TextRecognizer for Fake {
    fn recognize(&self, _bgra: Vec<u8>, width: u32, height: u32) -> Vec<OcrWord> {
        let words = ["Meet", "me", "at", "the", "docks."];
        let (ww, h) = (width as f64 * 0.05, 24.0); // (a 1080p subtitle line's height)
        let start = width as f64 / 2.0 - ww * words.len() as f64 / 2.0;
        words
            .iter()
            .enumerate()
            .map(|(i, t)| OcrWord { line: 0, text: t.to_string(), x: start + i as f64 * ww, y: height as f64 - h * 1.5, w: ww * 0.9, h })
            .collect()
    }
    fn max_dimension(&self) -> u32 {
        4000
    }
}

#[derive(Default)]
struct Heard {
    lines: Mutex<Vec<TranslatedLine>>,
    events: Mutex<Vec<(String, String)>>,
}

impl EngineListener for Heard {
    fn on_translation(&self, line: TranslatedLine) {
        self.lines.lock().unwrap().push(line);
    }
    fn on_screen(&self, _layout_json: Option<String>) {}
    fn on_status(&self, _message: String) {}
    fn on_event(&self, name: String, json: String) {
        self.events.lock().unwrap().push((name, json));
    }
}

fn get(port: u16, target: &str) -> String {
    let mut c = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    c.write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes()).unwrap();
    let mut all = String::new();
    let _ = c.read_to_string(&mut all);
    all
}

#[test]
fn a_line_read_reaches_the_app_and_the_tv_page() {
    let dir = std::env::temp_dir().join(format!("vit-ffi-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let heard = Arc::new(Heard::default());
    let engine = Engine::new(dir.join("data").display().to_string(), dir.join("db").display().to_string(), Arc::new(Fake), heard.clone()).unwrap();
    assert_eq!(engine.game(), "gta6");
    assert!(engine.games().iter().any(|g| g.id == "gta6"), "{:?}", engine.games());
    assert!(engine.prepare("nope".into(), "ar".into()).is_err());
    let areas = engine.read_areas();
    assert!(areas.iter().any(|a| a.id == "subtitles" && a.enabled), "{areas:?}");
    // (a translator without its key: the line comes back with its error, nothing is downloaded)
    engine.update_config(r#"{"engine": "deepl", "deepl_key": ""}"#.into()).unwrap();
    // a dark 1080p frame, again and again until the line has settled and gone to the translator
    let (w, h) = (1920u32, 1080u32);
    let start = Instant::now();
    loop {
        let wait = engine.process_frame(vec![0u8; (w * h * 4) as usize], w, h).unwrap();
        if heard.lines.lock().unwrap().iter().any(|l| l.area == "subtitles") || start.elapsed() > Duration::from_secs(20) {
            break;
        }
        std::thread::sleep(Duration::from_millis(wait.min(1000)));
    }
    let lines = heard.lines.lock().unwrap().clone();
    let line = lines.iter().find(|l| l.area == "subtitles").expect("a subtitle line");
    assert_eq!(line.en, "Meet me at the docks.");
    assert!(line.error.as_deref().is_some_and(|e| e.contains("DeepL")), "{line:?}");
    assert!(line.json.contains("\"area\":\"subtitles\""));
    assert!(engine.process_frame(vec![0u8; 10], w, h).is_err(), "not a picture of that size");

    // the TV page: for connected TVs only
    let port = engine.start_tv_server(0).unwrap();
    assert!(get(port, "/tv.json?t=nope").starts_with("HTTP/1.1 403"));
    let state: serde_json::Value = serde_json::from_str(&engine.overlay_state_json()).unwrap();
    assert!(state["areas"].is_array() && state["shown"].is_object());
    // connecting a TV that isn't there
    let r = engine.pair_tv("192.168.255.254:8792".into(), "123456".into(), "Test phone".into());
    assert!(matches!(r, Err(PairError::NoAnswer)), "{r:?}");
    let r = engine.pair_tv("192.168.255.254".into(), "123456".into(), "Test phone".into());
    assert!(matches!(r, Err(PairError::NoAnswer)), "an address alone: {r:?}");
    assert!(heard.events.lock().unwrap().iter().any(|(n, j)| n == "tv-paired" && j.contains("no_answer")));
    assert!(engine.list_tvs().is_empty());
    // the phone's own preview of the TV page
    let url = engine.local_viewer_url().unwrap();
    let target = url.trim_start_matches(&format!("http://127.0.0.1:{port}")).to_string();
    assert!(get(port, &target).starts_with("HTTP/1.1 200"), "{url}");
    // the live page: off until the settings turn it on
    assert!(get(port, "/live.json").starts_with("HTTP/1.1 404"));
    engine.update_config(r#"{"lan_page": true}"#.into()).unwrap();
    assert!(get(port, "/live.json").starts_with("HTTP/1.1 200"));
    let info: serde_json::Value = serde_json::from_str(&engine.lan_info()).unwrap();
    assert_eq!(info["enabled"], true);
    assert!(engine.font_list().iter().any(|f| f == "Cairo"));
    let pages: serde_json::Value = serde_json::from_str(&engine.page_options("gta6".into())).unwrap();
    assert!(pages["pages"].is_array());
    assert!(serde_json::from_str::<serde_json::Value>(&engine.screen_json()).unwrap().get("layout").is_some());
    // a snapshot of a dark frame: the stand-in recognizer's line, to a translator without its key
    let r = engine.take_snapshot(vec![0u8; (w * h * 4) as usize], w, h);
    assert!(r.is_ok() || r.as_ref().err().is_some_and(|e| e.to_string().contains("DeepL")), "{r:?}");
    assert!(engine.take_snapshot(vec![0u8; 4], w, h).is_err());
    engine.memory_clear();
    engine.stop_tv_server();
    assert!(engine.local_viewer_url().is_none());

    // settings
    engine.update_config(r#"{"target_lang": "fr"}"#.into()).unwrap();
    assert!(engine.config_json().contains("\"target_lang\":\"fr\""));
    assert!(engine.set_target_lang("xx".into()).is_err());
    assert!(dir.join("data").join("config.json").exists());
    drop(engine);
    let _ = std::fs::remove_dir_all(&dir);
}
