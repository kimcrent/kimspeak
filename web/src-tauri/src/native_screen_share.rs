use livekit::options::{TrackPublishOptions, VideoEncoding};
use livekit::prelude::*;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use livekit::webrtc::audio_frame::AudioFrame;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use livekit::webrtc::audio_source::native::NativeAudioSource;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use livekit::webrtc::native::yuv_helper;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use livekit::webrtc::video_frame::{I420Buffer, VideoBuffer, VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::webrtc::video_source::{RtcVideoSource, VideoResolution};

#[cfg(target_os = "macos")]
use screencapturekit::cv::CVPixelBufferLockFlags;
#[cfg(target_os = "macos")]
use screencapturekit::prelude::*;

use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::borrow::Cow;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
#[cfg(target_os = "macos")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::Instant;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::async_runtime::JoinHandle;
use tokio::sync::oneshot;

#[cfg(target_os = "windows")]
use std::ffi::c_void;

#[cfg(target_os = "windows")]
use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
#[cfg(target_os = "windows")]
use windows_capture::frame::Frame;
#[cfg(target_os = "windows")]
use windows_capture::graphics_capture_api::InternalCaptureControl;
#[cfg(target_os = "windows")]
use windows_capture::monitor::Monitor;
#[cfg(target_os = "windows")]
use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    GraphicsCaptureItemType, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
};
#[cfg(target_os = "windows")]
use windows_capture::window::Window;

pub struct NativeScreenShareState {
    current: Mutex<Option<RunningScreenShare>>,
}

impl Default for NativeScreenShareState {
    fn default() -> Self {
        Self {
            current: Mutex::new(None),
        }
    }
}

struct RunningScreenShare {
    close_tx: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub id: String,
    pub title: String,

    #[serde(rename = "type")]
    pub source_type: String,

    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartNativeScreenShareRequest {
    pub livekit_url: String,
    pub livekit_token: String,
    pub room: String,
    pub source_id: String,

    pub resolution: Option<String>,
    pub frame_rate: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    pub capture_audio: Option<bool>,
}

#[derive(Debug, Clone)]
struct ScreenCaptureSettings {
    width: u32,
    height: u32,
    frame_rate: u32,
    bitrate_kbps: u32,
    capture_audio: bool,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
const SCREEN_AUDIO_SAMPLE_RATE: u32 = 48_000;

#[cfg(any(target_os = "windows", target_os = "macos"))]
const SCREEN_AUDIO_NUM_CHANNELS: u32 = 2;

fn normalize_settings(request: &StartNativeScreenShareRequest) -> ScreenCaptureSettings {
    let (width, height) = match request.resolution.as_deref() {
        Some("720p") => (1280, 720),
        Some("1080p") => (1920, 1080),
        Some("1440p") | Some("2k") => (2560, 1440),
        Some("source") => (0, 0),
        _ => (1280, 720),
    };

    ScreenCaptureSettings {
        width,
        height,
        frame_rate: request.frame_rate.unwrap_or(30).clamp(5, 60),
        bitrate_kbps: request.bitrate_kbps.unwrap_or(2_500).clamp(500, 20_000),
        capture_audio: request.capture_audio.unwrap_or(false),
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn current_timestamp_us() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_micros() as i64
}

#[tauri::command]
pub async fn list_capture_sources() -> Result<Vec<CaptureSource>, String> {
    list_capture_sources_impl()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn list_capture_sources_impl() -> Result<Vec<CaptureSource>, String> {
    Err("native screen capture is currently implemented only for Windows and macOS".to_string())
}

#[cfg(target_os = "macos")]
fn list_capture_sources_impl() -> Result<Vec<CaptureSource>, String> {
    let content = SCShareableContent::create()
        .with_on_screen_windows_only(true)
        .with_exclude_desktop_windows(true)
        .get()
        .map_err(|error| {
            format!(
                "failed to enumerate macOS capture sources: {error}. Grant Screen Recording permission to KIMSpeak in System Settings."
            )
        })?;

    let mut sources = Vec::new();

    for (index, display) in content.displays().into_iter().enumerate() {
        let display_id = display.display_id();

        sources.push(CaptureSource {
            id: format!("display:{display_id}"),
            title: format!(
                "Display {} — {}x{}",
                index + 1,
                display.width(),
                display.height()
            ),
            source_type: "monitor".to_string(),
            thumbnail: None,
        });
    }

    for window in content.windows() {
        if !window.is_on_screen() {
            continue;
        }

        let title = window.title().unwrap_or_default();
        if title.trim().is_empty() {
            continue;
        }

        let app_name = window
            .owning_application()
            .map(|application| application.application_name())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "unknown".to_string());

        sources.push(CaptureSource {
            id: format!("window:{}", window.window_id()),
            title: format!("{title} — {app_name}"),
            source_type: "window".to_string(),
            thumbnail: None,
        });
    }

    Ok(sources)
}

#[cfg(target_os = "windows")]
fn list_capture_sources_impl() -> Result<Vec<CaptureSource>, String> {
    let mut sources = Vec::new();

    let monitors =
        Monitor::enumerate().map_err(|error| format!("failed to enumerate monitors: {error}"))?;

    for (index, monitor) in monitors.into_iter().enumerate() {
        let monitor_index = monitor.index().unwrap_or(index + 1);
        let name = monitor
            .name()
            .or_else(|_| monitor.device_name())
            .unwrap_or_else(|_| format!("Monitor {monitor_index}"));

        let width = monitor.width().unwrap_or_default();
        let height = monitor.height().unwrap_or_default();
        let refresh_rate = monitor.refresh_rate().unwrap_or_default();

        sources.push(CaptureSource {
            id: format!("monitor:{monitor_index}"),
            title: format!("{name} — {width}x{height} {refresh_rate}Hz"),
            source_type: "monitor".to_string(),
            thumbnail: None,
        });
    }

    let windows =
        Window::enumerate().map_err(|error| format!("failed to enumerate windows: {error}"))?;

    for window in windows {
        if !window.is_valid() {
            continue;
        }

        let title = window.title().unwrap_or_default();
        if title.trim().is_empty() {
            continue;
        }

        let process_name = window
            .process_name()
            .unwrap_or_else(|_| "unknown".to_string());
        let hwnd = window.as_raw_hwnd() as usize;

        sources.push(CaptureSource {
            id: format!("window:{hwnd}"),
            title: format!("{title} — {process_name}"),
            source_type: "window".to_string(),
            thumbnail: None,
        });
    }

    Ok(sources)
}

#[tauri::command]
pub async fn start_native_screen_share(
    state: tauri::State<'_, NativeScreenShareState>,
    request: StartNativeScreenShareRequest,
) -> Result<(), String> {
    if request.livekit_url.trim().is_empty() {
        return Err("livekitUrl is required".to_string());
    }

    if request.livekit_token.trim().is_empty() {
        return Err("livekitToken is required".to_string());
    }

    if request.room.trim().is_empty() {
        return Err("room is required".to_string());
    }

    if request.source_id.trim().is_empty() {
        return Err("sourceId is required".to_string());
    }

    let settings = normalize_settings(&request);

    if settings.capture_audio && !cfg!(any(target_os = "windows", target_os = "macos")) {
        println!("captureAudio=true requested, but system audio capture is currently implemented only for Windows and macOS");
    }

    let previous = {
        let mut current = state
            .current
            .lock()
            .map_err(|_| "failed to lock native screen share state".to_string())?;

        current.take()
    };

    if let Some(previous) = previous {
        let _ = previous.close_tx.send(());
        previous.task.abort();
    }

    let (close_tx, close_rx) = oneshot::channel();
    let task_request = request.clone();
    let task_settings = settings.clone();

    let task = tauri::async_runtime::spawn(async move {
        if let Err(error) =
            run_livekit_screen_publisher(task_request, task_settings, close_rx).await
        {
            eprintln!("Native LiveKit screen publisher failed: {error}");
        }
    });

    {
        let mut current = state
            .current
            .lock()
            .map_err(|_| "failed to lock native screen share state".to_string())?;

        *current = Some(RunningScreenShare { close_tx, task });
    }

    println!(
        "Native share task spawned: url={}, room={}, source_id={}, {}x{}, {}fps, {}kbps",
        request.livekit_url,
        request.room,
        request.source_id,
        settings.width,
        settings.height,
        settings.frame_rate,
        settings.bitrate_kbps,
    );

    Ok(())
}

#[tauri::command]
pub async fn stop_native_screen_share(
    state: tauri::State<'_, NativeScreenShareState>,
) -> Result<(), String> {
    let running = {
        let mut current = state
            .current
            .lock()
            .map_err(|_| "failed to lock native screen share state".to_string())?;

        current.take()
    };

    if let Some(running) = running {
        let _ = running.close_tx.send(());
        let _ = running.task.await;

        println!("Native screen share stopped");
    } else {
        println!("Native screen share stop requested, but nothing is running");
    }

    Ok(())
}

async fn run_livekit_screen_publisher(
    request: StartNativeScreenShareRequest,
    settings: ScreenCaptureSettings,
    mut close_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    let settings = resolve_capture_settings(&request, settings)?;

    println!(
        "Native LiveKit publisher connecting to {}",
        request.livekit_url
    );

    let mut room_options = RoomOptions::default();
    room_options.auto_subscribe = false;

    let (room, mut room_events) =
        Room::connect(&request.livekit_url, &request.livekit_token, room_options)
            .await
            .map_err(|error| format!("failed to connect to LiveKit: {error}"))?;

    println!(
        "Native LiveKit publisher connected to room: {}",
        room.name()
    );

    let events_task = tauri::async_runtime::spawn(async move {
        while let Some(event) = room_events.recv().await {
            println!("Native LiveKit room event: {:?}", event);
        }
    });

    let video_source = NativeVideoSource::new(
        VideoResolution {
            width: settings.width,
            height: settings.height,
        },
        true,
    );

    let video_track = LocalVideoTrack::create_video_track(
        "native_screen_share",
        RtcVideoSource::Native(video_source.clone()),
    );

    room.local_participant()
        .publish_track(
            LocalTrack::Video(video_track),
            TrackPublishOptions {
                source: TrackSource::Screenshare,
                simulcast: false,
                video_encoding: Some(VideoEncoding {
                    max_bitrate: settings.bitrate_kbps as u64 * 1000,
                    max_framerate: settings.frame_rate as f64,
                }),
                ..Default::default()
            },
        )
        .await
        .map_err(|error| format!("failed to publish native screen track: {error}"))?;

    println!(
        "Native screen video track published to LiveKit: source={}, {}x{}, {}fps, {}kbps",
        request.source_id,
        settings.width,
        settings.height,
        settings.frame_rate,
        settings.bitrate_kbps,
    );

    let stop_flag = Arc::new(AtomicBool::new(false));

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let audio_source = if settings.capture_audio {
        let audio_source = NativeAudioSource::new(
            AudioSourceOptions::default(),
            SCREEN_AUDIO_SAMPLE_RATE,
            SCREEN_AUDIO_NUM_CHANNELS,
            100,
        );

        let audio_track = LocalAudioTrack::create_audio_track(
            "native_screen_share_audio",
            RtcAudioSource::Native(audio_source.clone()),
        );

        room.local_participant()
            .publish_track(
                LocalTrack::Audio(audio_track),
                TrackPublishOptions {
                    source: TrackSource::ScreenshareAudio,
                    ..Default::default()
                },
            )
            .await
            .map_err(|error| format!("failed to publish native screen audio track: {error}"))?;

        println!("Native screen audio track published to LiveKit");

        Some(audio_source)
    } else {
        None
    };

    #[cfg(target_os = "windows")]
    let audio_task = if let Some(audio_source) = audio_source.clone() {
        let audio_stop_flag = stop_flag.clone();

        Some(tauri::async_runtime::spawn(async move {
            let mut audio_rx =
                crate::screen_audio::spawn_system_audio_capture(audio_stop_flag.clone());

            while let Some(samples) = audio_rx.recv().await {
                if audio_stop_flag.load(Ordering::SeqCst) {
                    break;
                }

                let samples_per_channel = samples.len() as u32 / SCREEN_AUDIO_NUM_CHANNELS;

                if samples_per_channel == 0 {
                    continue;
                }

                let frame = AudioFrame {
                    data: Cow::Owned(samples),
                    sample_rate: SCREEN_AUDIO_SAMPLE_RATE,
                    num_channels: SCREEN_AUDIO_NUM_CHANNELS,
                    samples_per_channel,
                };

                if let Err(error) = audio_source.capture_frame(&frame).await {
                    eprintln!("failed to capture native screen audio frame: {error}");
                    break;
                }
            }

            audio_source.clear_buffer();

            println!("Native screen audio task finished");
        }))
    } else {
        None
    };

    #[cfg(target_os = "macos")]
    let audio_task: Option<JoinHandle<()>> = None;

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let audio_task: Option<JoinHandle<()>> = None;

    #[cfg(target_os = "windows")]
    let capture_task = {
        let capture_request = request.clone();
        let capture_settings = settings.clone();
        let capture_stop_flag = stop_flag.clone();
        let capture_video_source = video_source.clone();

        tauri::async_runtime::spawn_blocking(move || {
            run_windows_graphics_capture(
                capture_request,
                capture_settings,
                capture_video_source,
                capture_stop_flag,
            )
        })
    };

    #[cfg(target_os = "macos")]
    let capture_task = {
        let capture_request = request.clone();
        let capture_settings = settings.clone();
        let capture_stop_flag = stop_flag.clone();
        let capture_video_source = video_source.clone();
        let capture_audio_source = audio_source.clone();

        tauri::async_runtime::spawn_blocking(move || {
            run_macos_screen_capture(
                capture_request,
                capture_settings,
                capture_video_source,
                capture_audio_source,
                capture_stop_flag,
            )
        })
    };

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let capture_task = tauri::async_runtime::spawn_blocking(move || {
        Err("native screen capture is currently implemented only for Windows and macOS".to_string())
    });

    tokio::select! {
        _ = &mut close_rx => {
            println!("Native screen publisher received stop signal");
            stop_flag.store(true, Ordering::SeqCst);
        }

        result = capture_task => {
            match result {
                Ok(Ok(())) => println!("Native screen capture finished"),
                Ok(Err(error)) => eprintln!("Native screen capture failed: {error}"),
                Err(error) => eprintln!("Native screen capture task join failed: {error}"),
            }
        }
    }

    stop_flag.store(true, Ordering::SeqCst);

    if let Some(audio_task) = audio_task {
        audio_task.abort();
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if let Some(audio_source) = audio_source {
        audio_source.clear_buffer();
    }

    events_task.abort();

    let _ = room.close().await;

    println!("Native LiveKit publisher disconnected");

    Ok(())
}

#[cfg(target_os = "windows")]
fn resolve_capture_settings(
    request: &StartNativeScreenShareRequest,
    mut settings: ScreenCaptureSettings,
) -> Result<ScreenCaptureSettings, String> {
    if settings.width > 0 && settings.height > 0 {
        return Ok(settings);
    }

    let (width, height) = resolve_capture_item_size(&request.source_id)?;
    settings.width = width.max(1);
    settings.height = height.max(1);

    Ok(settings)
}

#[cfg(target_os = "macos")]
fn resolve_capture_settings(
    request: &StartNativeScreenShareRequest,
    mut settings: ScreenCaptureSettings,
) -> Result<ScreenCaptureSettings, String> {
    if settings.width > 0 && settings.height > 0 {
        return Ok(settings);
    }

    let (width, height) = resolve_macos_capture_item_size(&request.source_id)?;
    settings.width = width.max(1);
    settings.height = height.max(1);

    Ok(settings)
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn resolve_capture_settings(
    _request: &StartNativeScreenShareRequest,
    mut settings: ScreenCaptureSettings,
) -> Result<ScreenCaptureSettings, String> {
    if settings.width == 0 || settings.height == 0 {
        settings.width = 1280;
        settings.height = 720;
    }

    Ok(settings)
}

#[cfg(target_os = "macos")]
enum MacosCaptureItem {
    Display(SCDisplay),
    Window(SCWindow),
}

#[cfg(target_os = "macos")]
fn get_macos_shareable_content() -> Result<SCShareableContent, String> {
    SCShareableContent::create()
        .with_on_screen_windows_only(true)
        .with_exclude_desktop_windows(true)
        .get()
        .map_err(|error| {
            format!(
                "failed to get macOS shareable content: {error}. Grant Screen Recording permission to KIMSpeak in System Settings."
            )
        })
}

#[cfg(target_os = "macos")]
fn resolve_macos_capture_item(source_id: &str) -> Result<MacosCaptureItem, String> {
    let content = get_macos_shareable_content()?;

    if source_id == "monitor:primary" || source_id == "display:primary" {
        let display = content
            .displays()
            .into_iter()
            .next()
            .ok_or_else(|| "no display is available for capture".to_string())?;

        return Ok(MacosCaptureItem::Display(display));
    }

    if let Some(raw_display_id) = source_id
        .strip_prefix("display:")
        .or_else(|| source_id.strip_prefix("monitor:"))
    {
        let display_id = raw_display_id
            .parse::<u32>()
            .map_err(|_| format!("invalid display source id: {source_id}"))?;

        let display = content
            .displays()
            .into_iter()
            .find(|display| display.display_id() == display_id)
            .ok_or_else(|| format!("display is not available for capture: {source_id}"))?;

        return Ok(MacosCaptureItem::Display(display));
    }

    if let Some(raw_window_id) = source_id.strip_prefix("window:") {
        let window_id = raw_window_id
            .parse::<u32>()
            .map_err(|_| format!("invalid window source id: {source_id}"))?;

        let window = content
            .windows()
            .into_iter()
            .find(|window| window.window_id() == window_id)
            .ok_or_else(|| format!("window is not available for capture: {source_id}"))?;

        return Ok(MacosCaptureItem::Window(window));
    }

    Err(format!("unknown capture source id: {source_id}"))
}

#[cfg(target_os = "macos")]
fn macos_capture_item_size(item: &MacosCaptureItem) -> (u32, u32) {
    match item {
        MacosCaptureItem::Display(display) => (display.width(), display.height()),
        MacosCaptureItem::Window(window) => {
            let frame = window.frame();
            (
                frame.size.width.round().max(1.0) as u32,
                frame.size.height.round().max(1.0) as u32,
            )
        }
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_capture_item_size(source_id: &str) -> Result<(u32, u32), String> {
    let item = resolve_macos_capture_item(source_id)?;
    Ok(macos_capture_item_size(&item))
}

#[cfg(target_os = "macos")]
fn macos_content_filter_for_item(item: &MacosCaptureItem) -> Result<SCContentFilter, String> {
    match item {
        MacosCaptureItem::Display(display) => SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .try_build()
            .map_err(|error| format!("failed to create macOS display capture filter: {error}")),
        MacosCaptureItem::Window(window) => SCContentFilter::create()
            .with_window(window)
            .try_build()
            .map_err(|error| format!("failed to create macOS window capture filter: {error}")),
    }
}

#[cfg(target_os = "windows")]
enum SelectedCaptureItem {
    Monitor(Monitor),
    Window(Window),
}

#[cfg(target_os = "windows")]
fn resolve_capture_item(source_id: &str) -> Result<SelectedCaptureItem, String> {
    if source_id == "monitor:primary" {
        let monitor = Monitor::primary()
            .map_err(|error| format!("failed to get primary monitor: {error}"))?;

        return Ok(SelectedCaptureItem::Monitor(monitor));
    }

    if let Some(raw_index) = source_id.strip_prefix("monitor:") {
        let index = raw_index
            .parse::<usize>()
            .map_err(|_| format!("invalid monitor source id: {source_id}"))?;

        let monitor = Monitor::from_index(index)
            .map_err(|error| format!("failed to get monitor {index}: {error}"))?;

        return Ok(SelectedCaptureItem::Monitor(monitor));
    }

    if let Some(raw_hwnd) = source_id.strip_prefix("window:") {
        let hwnd = raw_hwnd
            .parse::<usize>()
            .map_err(|_| format!("invalid window source id: {source_id}"))?;

        let window = Window::from_raw_hwnd(hwnd as *mut c_void);

        if !window.is_valid() {
            return Err(format!("window is not valid for capture: {source_id}"));
        }

        return Ok(SelectedCaptureItem::Window(window));
    }

    Err(format!("unknown capture source id: {source_id}"))
}

#[cfg(target_os = "windows")]
fn resolve_capture_item_size(source_id: &str) -> Result<(u32, u32), String> {
    match resolve_capture_item(source_id)? {
        SelectedCaptureItem::Monitor(monitor) => {
            let width = monitor
                .width()
                .map_err(|error| format!("failed to read monitor width: {error}"))?;
            let height = monitor
                .height()
                .map_err(|error| format!("failed to read monitor height: {error}"))?;

            Ok((width, height))
        }
        SelectedCaptureItem::Window(window) => {
            let width = window
                .width()
                .map_err(|error| format!("failed to read window width: {error}"))?
                .max(1) as u32;
            let height = window
                .height()
                .map_err(|error| format!("failed to read window height: {error}"))?
                .max(1) as u32;

            Ok((width, height))
        }
    }
}

#[cfg(target_os = "windows")]
fn run_windows_graphics_capture(
    request: StartNativeScreenShareRequest,
    settings: ScreenCaptureSettings,
    video_source: NativeVideoSource,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let item = resolve_capture_item(&request.source_id)?;

    match item {
        SelectedCaptureItem::Monitor(monitor) => {
            run_windows_graphics_capture_for_item(monitor, settings, video_source, stop_flag)
        }
        SelectedCaptureItem::Window(window) => {
            run_windows_graphics_capture_for_item(window, settings, video_source, stop_flag)
        }
    }
}

#[cfg(target_os = "macos")]
fn run_macos_screen_capture(
    request: StartNativeScreenShareRequest,
    settings: ScreenCaptureSettings,
    video_source: NativeVideoSource,
    audio_source: Option<NativeAudioSource>,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String> {
    let item = resolve_macos_capture_item(&request.source_id)?;
    let filter = macos_content_filter_for_item(&item)?;
    let captures_audio = audio_source.is_some();

    let config = SCStreamConfiguration::new()
        .with_width(settings.width.max(1))
        .with_height(settings.height.max(1))
        .with_pixel_format(PixelFormat::BGRA)
        .with_shows_cursor(true)
        .with_captures_audio(captures_audio)
        .with_excludes_current_process_audio(true)
        .with_sample_rate(SCREEN_AUDIO_SAMPLE_RATE as i32)
        .with_channel_count(SCREEN_AUDIO_NUM_CHANNELS as i32)
        .with_fps(settings.frame_rate.max(1));

    if captures_audio && !config.excludes_current_process_audio() {
        return Err(
            "macOS system audio capture cannot safely exclude KIMSpeak audio on this system"
                .to_string(),
        );
    }

    let handler = Arc::new(MacosLiveKitCapture {
        video_source,
        audio_source,
        target_width: settings.width,
        target_height: settings.height,
    });

    let mut stream = SCStream::new(&filter, &config);

    let video_handler = handler.clone();
    stream
        .add_output_handler(
            move |sample, output_type| video_handler.handle(sample, output_type),
            SCStreamOutputType::Screen,
        )
        .ok_or_else(|| "failed to register macOS screen capture output handler".to_string())?;

    if captures_audio {
        let audio_handler = handler.clone();
        stream
            .add_output_handler(
                move |sample, output_type| audio_handler.handle(sample, output_type),
                SCStreamOutputType::Audio,
            )
            .ok_or_else(|| "failed to register macOS screen audio output handler".to_string())?;
    }

    stream
        .start_capture()
        .map_err(|error| format!("failed to start macOS ScreenCaptureKit stream: {error}"))?;

    println!(
        "macOS ScreenCaptureKit stream started: source={}, {}x{}, audio={}",
        request.source_id, settings.width, settings.height, captures_audio,
    );

    while !stop_flag.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(50));
    }

    stream
        .stop_capture()
        .map_err(|error| format!("failed to stop macOS ScreenCaptureKit stream: {error}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
struct MacosLiveKitCapture {
    video_source: NativeVideoSource,
    audio_source: Option<NativeAudioSource>,
    target_width: u32,
    target_height: u32,
}

#[cfg(target_os = "macos")]
impl MacosLiveKitCapture {
    fn handle(&self, sample: CMSampleBuffer, output_type: SCStreamOutputType) {
        match output_type {
            SCStreamOutputType::Screen => self.handle_video(sample),
            SCStreamOutputType::Audio => self.handle_audio(sample),
            SCStreamOutputType::Microphone => {}
        }
    }

    fn handle_video(&self, sample: CMSampleBuffer) {
        if sample
            .frame_status()
            .map(|status| !status.has_content())
            .unwrap_or(false)
        {
            return;
        }

        if let Err(error) = sample.make_data_ready() {
            eprintln!("failed to prepare macOS screen sample buffer: {error}");
            return;
        }

        let Some(pixel_buffer) = sample.image_buffer() else {
            return;
        };

        let guard = match pixel_buffer.lock(CVPixelBufferLockFlags::READ_ONLY) {
            Ok(guard) => guard,
            Err(error) => {
                eprintln!("failed to lock macOS screen pixel buffer: {error}");
                return;
            }
        };

        let width = guard.width() as u32;
        let height = guard.height() as u32;
        let bytes_per_row = guard.bytes_per_row();

        if width == 0 || height == 0 || bytes_per_row == 0 {
            return;
        }

        let raw_bgra = guard.as_slice();
        let expected_row_bytes = width as usize * 4;

        let video_frame = if bytes_per_row == expected_row_bytes {
            bgra_to_i420_frame(
                raw_bgra,
                width,
                height,
                self.target_width,
                self.target_height,
            )
        } else {
            let Some(packed_bgra) =
                pack_macos_bgra_rows(raw_bgra, width as usize, height as usize, bytes_per_row)
            else {
                eprintln!("macOS screen pixel buffer has an invalid row stride");
                return;
            };

            bgra_to_i420_frame(
                &packed_bgra,
                width,
                height,
                self.target_width,
                self.target_height,
            )
        };

        self.video_source.capture_frame(&video_frame);
    }

    fn handle_audio(&self, sample: CMSampleBuffer) {
        let Some(audio_source) = self.audio_source.clone() else {
            return;
        };

        if let Err(error) = sample.make_data_ready() {
            eprintln!("failed to prepare macOS audio sample buffer: {error}");
            return;
        }

        let Some(samples) = macos_audio_sample_to_i16(&sample) else {
            return;
        };

        let samples_per_channel = samples.len() as u32 / SCREEN_AUDIO_NUM_CHANNELS;

        if samples_per_channel == 0 {
            return;
        }

        tauri::async_runtime::spawn(async move {
            let frame = AudioFrame {
                data: Cow::Owned(samples),
                sample_rate: SCREEN_AUDIO_SAMPLE_RATE,
                num_channels: SCREEN_AUDIO_NUM_CHANNELS,
                samples_per_channel,
            };

            if let Err(error) = audio_source.capture_frame(&frame).await {
                eprintln!("failed to capture macOS screen audio frame: {error}");
            }
        });
    }
}

#[cfg(target_os = "macos")]
fn pack_macos_bgra_rows(
    raw_bgra: &[u8],
    width: usize,
    height: usize,
    bytes_per_row: usize,
) -> Option<Vec<u8>> {
    let row_bytes = width.checked_mul(4)?;
    let mut packed = Vec::with_capacity(row_bytes.checked_mul(height)?);

    for row in 0..height {
        let start = row.checked_mul(bytes_per_row)?;
        let end = start.checked_add(row_bytes)?;

        if end > raw_bgra.len() {
            return None;
        }

        packed.extend_from_slice(&raw_bgra[start..end]);
    }

    Some(packed)
}

#[cfg(target_os = "macos")]
fn macos_audio_sample_to_i16(sample: &CMSampleBuffer) -> Option<Vec<i16>> {
    let buffer_list = sample.audio_buffer_list()?;

    if buffer_list.num_buffers() == 0 {
        return None;
    }

    if buffer_list.num_buffers() == 1 {
        let buffer = buffer_list.get(0)?;
        let source_channels = buffer.number_channels.max(1) as usize;
        let samples = audio_bytes_to_i16(buffer.data())?;

        return Some(normalize_interleaved_audio_channels(
            samples,
            source_channels,
            SCREEN_AUDIO_NUM_CHANNELS as usize,
        ));
    }

    let mut planes = Vec::new();

    for buffer in buffer_list.iter() {
        let samples = audio_bytes_to_i16(buffer.data())?;

        if !samples.is_empty() {
            planes.push(samples);
        }
    }

    if planes.is_empty() {
        return None;
    }

    Some(interleave_planar_audio(
        &planes,
        SCREEN_AUDIO_NUM_CHANNELS as usize,
    ))
}

#[cfg(target_os = "macos")]
fn audio_bytes_to_i16(bytes: &[u8]) -> Option<Vec<i16>> {
    if bytes.len() >= 4 && bytes.len() % 4 == 0 && looks_like_f32_pcm(bytes) {
        return Some(
            bytes
                .chunks_exact(4)
                .map(|chunk| {
                    let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    let sample = sample.clamp(-1.0, 1.0);
                    (sample * i16::MAX as f32) as i16
                })
                .collect(),
        );
    }

    if bytes.len() >= 2 && bytes.len() % 2 == 0 {
        return Some(
            bytes
                .chunks_exact(2)
                .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
                .collect(),
        );
    }

    None
}

#[cfg(target_os = "macos")]
fn looks_like_f32_pcm(bytes: &[u8]) -> bool {
    let mut checked = 0usize;

    for chunk in bytes.chunks_exact(4).take(32) {
        let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);

        if !sample.is_finite() || sample.abs() > 16.0 {
            return false;
        }

        checked += 1;
    }

    checked > 0
}

#[cfg(target_os = "macos")]
fn normalize_interleaved_audio_channels(
    samples: Vec<i16>,
    source_channels: usize,
    target_channels: usize,
) -> Vec<i16> {
    if source_channels == target_channels {
        return samples;
    }

    let source_channels = source_channels.max(1);
    let target_channels = target_channels.max(1);
    let frames = samples.len() / source_channels;
    let mut normalized = Vec::with_capacity(frames * target_channels);

    for frame in 0..frames {
        let source_start = frame * source_channels;

        for channel in 0..target_channels {
            let source_channel = channel.min(source_channels - 1);
            normalized.push(samples[source_start + source_channel]);
        }
    }

    normalized
}

#[cfg(target_os = "macos")]
fn interleave_planar_audio(planes: &[Vec<i16>], target_channels: usize) -> Vec<i16> {
    let target_channels = target_channels.max(1);
    let frames = planes.iter().map(Vec::len).min().unwrap_or(0);
    let mut interleaved = Vec::with_capacity(frames * target_channels);

    for frame in 0..frames {
        for channel in 0..target_channels {
            let plane = channel.min(planes.len() - 1);
            interleaved.push(planes[plane][frame]);
        }
    }

    interleaved
}

#[cfg(target_os = "windows")]
fn run_windows_graphics_capture_for_item<T>(
    item: T,
    settings: ScreenCaptureSettings,
    video_source: NativeVideoSource,
    stop_flag: Arc<AtomicBool>,
) -> Result<(), String>
where
    T: TryInto<GraphicsCaptureItemType> + Send + 'static,
{
    let frame_interval = Duration::from_millis(1000 / settings.frame_rate.max(1) as u64);

    let flags = CaptureFlags {
        video_source,
        target_width: settings.width,
        target_height: settings.height,
        frame_interval,
        stop_flag,
    };

    let capture_settings = Settings::new(
        item,
        CursorCaptureSettings::Default,
        DrawBorderSettings::WithoutBorder,
        SecondaryWindowSettings::Default,
        MinimumUpdateIntervalSettings::Custom(frame_interval),
        DirtyRegionSettings::Default,
        ColorFormat::Bgra8,
        flags,
    );

    LiveKitWgcCapture::start(capture_settings)
        .map_err(|error| format!("Windows Graphics Capture failed: {error}"))
}

#[cfg(target_os = "windows")]
struct CaptureFlags {
    video_source: NativeVideoSource,
    target_width: u32,
    target_height: u32,
    frame_interval: Duration,
    stop_flag: Arc<AtomicBool>,
}

#[cfg(target_os = "windows")]
struct LiveKitWgcCapture {
    video_source: NativeVideoSource,
    target_width: u32,
    target_height: u32,
    frame_interval: Duration,
    last_frame_at: Option<Instant>,
    stop_flag: Arc<AtomicBool>,
    no_padding_buffer: Vec<u8>,
}

#[cfg(target_os = "windows")]
impl GraphicsCaptureApiHandler for LiveKitWgcCapture {
    type Flags = CaptureFlags;
    type Error = Box<dyn std::error::Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            video_source: ctx.flags.video_source,
            target_width: ctx.flags.target_width,
            target_height: ctx.flags.target_height,
            frame_interval: ctx.flags.frame_interval,
            last_frame_at: None,
            stop_flag: ctx.flags.stop_flag,
            no_padding_buffer: Vec::new(),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.stop_flag.load(Ordering::SeqCst) {
            capture_control.stop();
            return Ok(());
        }

        let now = Instant::now();
        if let Some(last_frame_at) = self.last_frame_at {
            if now.duration_since(last_frame_at) < self.frame_interval {
                return Ok(());
            }
        }
        self.last_frame_at = Some(now);

        let frame_buffer = frame.buffer()?;
        let width = frame_buffer.width();
        let height = frame_buffer.height();
        let bgra = frame_buffer.as_nopadding_buffer(&mut self.no_padding_buffer);

        let video_frame =
            bgra_to_i420_frame(bgra, width, height, self.target_width, self.target_height);

        self.video_source.capture_frame(&video_frame);

        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        println!("Windows capture item closed");
        self.stop_flag.store(true, Ordering::SeqCst);
        Ok(())
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn bgra_to_i420_frame(
    bgra: &[u8],
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
) -> VideoFrame<I420Buffer> {
    let target_width = target_width.max(1);
    let target_height = target_height.max(1);
    let source_width = source_width.max(1);
    let source_height = source_height.max(1);

    let mut source_frame = VideoFrame {
        rotation: VideoRotation::VideoRotation0,
        timestamp_us: current_timestamp_us(),
        frame_metadata: None,
        buffer: I420Buffer::new(source_width, source_height),
    };

    let i420_buffer = &mut source_frame.buffer;
    let (stride_y, stride_u, stride_v) = i420_buffer.strides();
    let (data_y, data_u, data_v) = i420_buffer.data_mut();

    yuv_helper::argb_to_i420(
        bgra,
        source_width * 4,
        data_y,
        stride_y,
        data_u,
        stride_u,
        data_v,
        stride_v,
        source_width as i32,
        source_height as i32,
    );

    if source_width == target_width && source_height == target_height {
        return source_frame;
    }

    let (fit_width, fit_height) =
        fit_inside(source_width, source_height, target_width, target_height);
    let scaled_buffer = source_frame
        .buffer
        .scale(fit_width as i32, fit_height as i32);

    let mut output_frame = VideoFrame {
        rotation: VideoRotation::VideoRotation0,
        timestamp_us: source_frame.timestamp_us,
        frame_metadata: None,
        buffer: I420Buffer::new(target_width, target_height),
    };

    fill_i420_black(&mut output_frame.buffer);
    copy_i420_centered(&scaled_buffer, &mut output_frame.buffer);

    output_frame
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn fit_inside(
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
) -> (u32, u32) {
    let width_scale = target_width as f64 / source_width as f64;
    let height_scale = target_height as f64 / source_height as f64;
    let scale = width_scale.min(height_scale);

    let mut width = (source_width as f64 * scale).round() as u32;
    let mut height = (source_height as f64 * scale).round() as u32;

    width = width.clamp(1, target_width);
    height = height.clamp(1, target_height);

    if width > 1 {
        width &= !1;
    }

    if height > 1 {
        height &= !1;
    }

    (width.max(1), height.max(1))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn fill_i420_black(buffer: &mut I420Buffer) {
    let (data_y, data_u, data_v) = buffer.data_mut();
    data_y.fill(16);
    data_u.fill(128);
    data_v.fill(128);
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn copy_i420_centered(source: &I420Buffer, target: &mut I420Buffer) {
    let x_offset = ((target.width().saturating_sub(source.width())) / 2) & !1;
    let y_offset = ((target.height().saturating_sub(source.height())) / 2) & !1;

    let (source_stride_y, source_stride_u, source_stride_v) = source.strides();
    let (target_stride_y, target_stride_u, target_stride_v) = target.strides();
    let (source_y, source_u, source_v) = source.data();
    let (target_y, target_u, target_v) = target.data_mut();

    copy_plane(
        source_y,
        source_stride_y,
        target_y,
        target_stride_y,
        source.width(),
        source.height(),
        x_offset,
        y_offset,
    );
    copy_plane(
        source_u,
        source_stride_u,
        target_u,
        target_stride_u,
        source.chroma_width(),
        source.chroma_height(),
        x_offset / 2,
        y_offset / 2,
    );
    copy_plane(
        source_v,
        source_stride_v,
        target_v,
        target_stride_v,
        source.chroma_width(),
        source.chroma_height(),
        x_offset / 2,
        y_offset / 2,
    );
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn copy_plane(
    source: &[u8],
    source_stride: u32,
    target: &mut [u8],
    target_stride: u32,
    width: u32,
    height: u32,
    x_offset: u32,
    y_offset: u32,
) {
    let source_stride = source_stride as usize;
    let target_stride = target_stride as usize;
    let width = width as usize;
    let height = height as usize;
    let x_offset = x_offset as usize;
    let y_offset = y_offset as usize;

    for row in 0..height {
        let source_start = row * source_stride;
        let target_start = (row + y_offset) * target_stride + x_offset;

        target[target_start..target_start + width]
            .copy_from_slice(&source[source_start..source_start + width]);
    }
}
