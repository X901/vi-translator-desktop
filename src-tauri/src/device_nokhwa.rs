//! Capture cards and other video devices on Linux (V4L2) and macOS (AVFoundation), with nokhwa.
//!
//! Same contract as the Windows version (device.rs): the card's picture is the whole game frame,
//! read at the capture rate into the shared frame slot. MJPEG frames (what most capture cards
//! send) are decoded with the image crate; other formats with nokhwa's own converters.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use anyhow::{Result, anyhow};
use nokhwa::Camera;
use nokhwa::pixel_format::RgbAFormat;
use nokhwa::utils::{ApiBackend, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType};

use crate::capture::{FrameData, Shared, shrink};

/// Prefix that marks a device (not a window) in the config's source field.
pub const PREFIX: &str = "device:";

fn init() {
    #[cfg(target_os = "macos")]
    {
        static ONCE: std::sync::Once = std::sync::Once::new();
        // asks for camera access the first time (capture cards are cameras to macOS)
        ONCE.call_once(|| nokhwa::nokhwa_initialize(|_| {}));
    }
}

fn devices() -> Vec<(String, CameraIndex)> {
    init();
    nokhwa::query(ApiBackend::Auto)
        .unwrap_or_default()
        .into_iter()
        .map(|c| (c.human_name(), c.index().clone()))
        .collect()
}

/// Names of the video devices (capture cards, webcams).
pub fn list() -> Vec<String> {
    devices().into_iter().map(|(n, _)| n).collect()
}

fn open(name: &str) -> Result<Camera> {
    let (_, index) = devices().into_iter().find(|(n, _)| n == name).ok_or_else(|| anyhow!("capture device \"{name}\" not found"))?;
    let mut cam = Camera::new(index, RequestedFormat::new::<RgbAFormat>(RequestedFormatType::AbsoluteHighestResolution))
        .map_err(|e| anyhow!("open \"{name}\": {e}"))?;
    cam.open_stream().map_err(|e| anyhow!("start \"{name}\": {e}"))?;
    Ok(cam)
}

/// One frame as RGBA.
fn read(cam: &mut Camera) -> Result<(u32, u32, Vec<u8>)> {
    let buf = cam.frame().map_err(|e| anyhow!("{e}"))?;
    if buf.source_frame_format() == FrameFormat::MJPEG {
        let img = image::load_from_memory_with_format(buf.buffer(), image::ImageFormat::Jpeg)?.into_rgba8();
        let (w, h) = img.dimensions();
        return Ok((w, h, img.into_raw()));
    }
    let img = buf.decode_image::<RgbAFormat>().map_err(|e| anyhow!("{e}"))?;
    let (w, h) = img.dimensions();
    Ok((w, h, img.into_raw()))
}

pub struct DeviceCapture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl DeviceCapture {
    pub fn is_finished(&self) -> bool {
        self.thread.as_ref().is_none_or(|t| t.is_finished())
    }
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Read the device in the background until stopped (or it fails: the manager then restarts it).
/// (`_big`, the 4K picture: here the card always runs at its highest resolution; the picture's size
/// is the preview's limit, `capture::preview_w`)
pub fn start(name: String, shared: Arc<Shared>, _big: bool) -> DeviceCapture {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = std::thread::spawn(move || {
        let mut cam = match open(&name) {
            Ok(c) => c,
            Err(e) => {
                shared.set_status(format!("{e}"));
                std::thread::sleep(Duration::from_secs(3));
                return;
            }
        };
        shared.set_status(format!("Capturing \"{name}\""));
        let ago = Instant::now() - Duration::from_secs(1);
        let (mut last, mut last_preview) = (ago, ago);
        while !flag.load(Ordering::Relaxed) {
            // devices push frames at their own rate: read every one, keep what's due
            match read(&mut cam) {
                Ok((w, h, rgba)) => {
                    if shared.preview_due(last_preview) {
                        last_preview = Instant::now();
                        shared.put_preview(shrink(&rgba, w, h, (w * 4) as usize, false));
                    }
                    if shared.full_due(last) {
                        last = Instant::now();
                        shared.put_full(w, h, rgba);
                    }
                }
                Err(e) => {
                    shared.set_status(format!("Capture device \"{name}\" stopped: {e}"));
                    break;
                }
            }
        }
        let _ = cam.stop_stream();
    });
    DeviceCapture { stop, thread: Some(thread) }
}

/// Capture a single frame from a device (used by `--grab-device`).
pub fn grab_once(name: &str) -> Result<Arc<FrameData>> {
    let mut cam = open(name)?;
    // the first frames of a capture card are often black: skip a few
    let mut frame = read(&mut cam)?;
    for _ in 0..5 {
        frame = read(&mut cam)?;
    }
    let _ = cam.stop_stream();
    Ok(Arc::new(FrameData { w: frame.0, h: frame.1, rgba: frame.2, seq: 1 }))
}
