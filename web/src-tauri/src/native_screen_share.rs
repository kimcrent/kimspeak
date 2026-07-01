use livekit::options::{TrackPublishOptions, VideoEncoding};
use livekit::prelude::*;
use livekit::webrtc::audio_frame::AudioFrame;
use livekit::webrtc::audio_source::native::NativeAudioSource;
use livekit::webrtc::audio_source::{AudioSourceOptions, RtcAudioSource};
use livekit::webrtc::native::yuv_helper;
use livekit::webrtc::video_frame::{I420Buffer, VideoBuffer, VideoFrame, VideoRotation};
use livekit::webrtc::video_source::native::NativeVideoSource;
use livekit::webrtc::video_source::{RtcVideoSource, VideoResolution};

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
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

#[cfg(not(target_os = "windows"))]
fn list_capture_sources_impl() -> Result<Vec<CaptureSource>, String> {
    Err("native screen capture is currently implemented only for Windows".to_string())
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

    if settings.capture_audio && !cfg!(target_os = "windows") {
        println!("captureAudio=true requested, but system audio capture is currently implemented only for Windows");
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

    #[cfg(target_os = "windows")]
    let audio_task = if settings.capture_audio {
        let audio_source = NativeAudioSource::new(
            AudioSourceOptions::default(),
            crate::screen_audio::SAMPLE_RATE,
            crate::screen_audio::NUM_CHANNELS,
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

        let audio_stop_flag = stop_flag.clone();

        Some(tauri::async_runtime::spawn(async move {
            let mut audio_rx =
                crate::screen_audio::spawn_system_audio_capture(audio_stop_flag.clone());

            while let Some(samples) = audio_rx.recv().await {
                if audio_stop_flag.load(Ordering::SeqCst) {
                    break;
                }

                let samples_per_channel = samples.len() as u32 / crate::screen_audio::NUM_CHANNELS;

                if samples_per_channel == 0 {
                    continue;
                }

                let frame = AudioFrame {
                    data: Cow::Owned(samples),
                    sample_rate: crate::screen_audio::SAMPLE_RATE,
                    num_channels: crate::screen_audio::NUM_CHANNELS,
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

    #[cfg(not(target_os = "windows"))]
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

    #[cfg(not(target_os = "windows"))]
    let capture_task = tauri::async_runtime::spawn_blocking(move || {
        Err("native screen capture is currently implemented only for Windows".to_string())
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

#[cfg(not(target_os = "windows"))]
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

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
fn fill_i420_black(buffer: &mut I420Buffer) {
    let (data_y, data_u, data_v) = buffer.data_mut();
    data_y.fill(16);
    data_u.fill(128);
    data_v.fill(128);
}

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
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
