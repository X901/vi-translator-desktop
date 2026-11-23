//! Xbox remote play inside VI Translator: Microsoft's own web player in a window of the app, which
//! the window capture reads like any game window (its title is the source). The player signs in on
//! Microsoft's own pages, typed by the player; its cookies stay in its own folder of the app's.
//! Controllers reach the console through the page (the browser's Gamepad API).
//!
//! In our own window the player keeps playing while VI Translator is in front (the Xbox app pauses
//! the moment it loses focus), and the page is told it is always visible, so a covered window is
//! still drawn and still read.
//!
//! Windows (WebView2) and macOS (WKWebView). Not Linux: WebKitGTK has no WebRTC, which the stream needs.

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// The player's window title: the source's value, read by the window capture.
pub const TITLE: &str = "Xbox — VI Translator";
const LABEL: &str = "xbox";
/// Microsoft's player, at its remote play (console) page (www.xbox.com/play/consoles leads there).
const URL: &str = "https://play.xbox.com/remoteplay";
/// Sign-in and the player stay in the window; any other address opens in the default browser.
const ALLOWED: [&str; 11] = [
    "xbox.com", "live.com", "microsoft.com", "microsoftonline.com", "msftauth.net", "msauth.net", "live.net", "xboxlive.com",
    "akamaized.net", "msecnd.net", "office.com",
];

/// Can this build play Xbox in the app?
pub const fn available() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

/// The page is always visible and focused, as far as it can tell: covered by the app's own window,
/// it keeps drawing and playing. (A minimised window still stops: there is nothing to draw.)
const ALWAYS_VISIBLE: &str = r#"(() => {
  try {
    Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => "visible" });
    const quiet = (e) => { if (e.target === window || e.target === document) e.stopImmediatePropagation(); };
    for (const t of [window, document]) {
      t.addEventListener("visibilitychange", quiet, true);
      t.addEventListener("blur", quiet, true);
      t.addEventListener("pagehide", quiet, true);
    }
  } catch (e) {}
})();"#;

/// An address the window keeps (Microsoft's sign-in and the player), not one for the browser.
pub fn allowed(url: &tauri::Url) -> bool {
    match url.scheme() {
        "https" => {}
        // (the page's own blank frames and data)
        "about" | "data" | "blob" => return true,
        _ => return false,
    }
    let Some(host) = url.host_str() else { return false };
    ALLOWED.iter().any(|a| host == *a || host.ends_with(&format!(".{a}")))
}

/// Opens the player's window, or brings it to the front.
pub fn open(app: &AppHandle, data_dir: &std::path::Path) -> Result<(), String> {
    if !available() {
        return Err("Xbox in VI Translator is not available on this system".into());
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let url: tauri::Url = URL.parse().map_err(|e| format!("{e}"))?;
    let b = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title(TITLE)
        .inner_size(1280.0, 760.0)
        .min_inner_size(640.0, 400.0)
        .center()
        .initialization_script(ALWAYS_VISIBLE)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .on_navigation(|url| {
            if allowed(url) {
                return true;
            }
            let _ = crate::open_url(url.as_str());
            false
        })
        .on_new_window(|url, _| {
            // (Microsoft's sign-in may open its own small window: kept; anything else is the browser's)
            if allowed(&url) {
                return NewWindowResponse::Allow;
            }
            let _ = crate::open_url(url.as_str());
            NewWindowResponse::Deny
        });
    // Windows: its own WebView2 profile (cookies, storage) and a browser that never throttles or
    // stops drawing a covered window; the video plays without a click.
    #[cfg(windows)]
    let b = b.data_directory(data_dir.join("xbox-web")).additional_browser_args(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
         --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
         --autoplay-policy=no-user-gesture-required",
    );
    // macOS: Safari's own name (the player checks for a browser it supports)
    #[cfg(target_os = "macos")]
    let b = b.user_agent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
    );
    #[cfg(not(windows))]
    let _ = data_dir;
    b.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_in_and_the_player_stay_in_the_window() {
        let ok = |u: &str| allowed(&u.parse().unwrap());
        assert!(ok("https://www.xbox.com/play/consoles"));
        assert!(ok("https://login.live.com/oauth20_authorize.srf"));
        assert!(ok("https://login.microsoftonline.com/x"));
        assert!(ok("about:blank"));
        // anything else is the browser's, and so is plain http or a look-alike
        assert!(!ok("https://example.com/"));
        assert!(!ok("http://www.xbox.com/"));
        assert!(!ok("https://xbox.com.evil.example/"));
        assert!(!ok("https://notxbox.com/"));
    }
}
