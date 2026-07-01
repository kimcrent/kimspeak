#[cfg(target_os = "windows")]
use std::{
    collections::VecDeque,
    error::Error,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
};

#[cfg(target_os = "windows")]
use tokio::sync::mpsc;

#[cfg(target_os = "windows")]
use wasapi::*;

#[cfg(target_os = "windows")]
type Res<T> = Result<T, Box<dyn Error + Send + Sync>>;

#[cfg(target_os = "windows")]
pub type AudioChunk = Vec<i16>;

#[cfg(target_os = "windows")]
pub const SAMPLE_RATE: u32 = 48_000;

#[cfg(target_os = "windows")]
pub const NUM_CHANNELS: u32 = 2;

#[cfg(target_os = "windows")]
pub const FRAMES_PER_CHUNK: usize = 480;

/// Захватывает системный звук Windows через WASAPI loopback.
/// Возвращает PCM i16 interleaved stereo: L, R, L, R...
#[cfg(target_os = "windows")]
pub fn spawn_system_audio_capture(stop_flag: Arc<AtomicBool>) -> mpsc::Receiver<AudioChunk> {
    let (tx, rx) = mpsc::channel::<AudioChunk>(8);

    thread::Builder::new()
        .name("kimspeak-screen-audio-capture".to_string())
        .spawn(move || {
            if let Err(err) = capture_loop(tx, stop_flag) {
                eprintln!("screen audio capture failed: {err}");
            }
        })
        .expect("failed to spawn screen audio capture thread");

    rx
}

#[cfg(target_os = "windows")]
fn capture_loop(tx: mpsc::Sender<AudioChunk>, stop_flag: Arc<AtomicBool>) -> Res<()> {
    initialize_mta().ok()?;

    // Capture all system output except KIMSpeak itself. This prevents viewers from
    // hearing their own voices through the streamer's shared system audio.
    let current_process_id = std::process::id();
    let include_current_process_tree = false;
    let mut audio_client =
        AudioClient::new_application_loopback_client(current_process_id, include_current_process_tree)?;

    // LiveKit/WebRTC удобнее кормить 48 kHz stereo.
    // autoconvert=true ниже позволит WASAPI конвертировать формат.
    let desired_format = WaveFormat::new(
        32,
        32,
        &SampleType::Float,
        SAMPLE_RATE as usize,
        NUM_CHANNELS as usize,
        None,
    );
    let blockalign = desired_format.get_blockalign();

    let mode = StreamMode::EventsShared {
        autoconvert: true,
        // Process-loopback clients do not report a reliable device period.
        // 20 ms keeps latency low while leaving enough room for WASAPI scheduling.
        buffer_duration_hns: 200_000,
    };

    // Для loopback используем Capture-направление на render device.
    audio_client.initialize_client(&desired_format, &Direction::Capture, &mode)?;

    let event_handle = audio_client.set_get_eventhandle()?;
    let capture_client = audio_client.get_audiocaptureclient()?;

    let mut sample_queue: VecDeque<u8> = VecDeque::new();

    // 10 мс при 48 kHz = 480 samples на канал.
    // stereo => 960 i16 значений.
    let bytes_per_chunk = FRAMES_PER_CHUNK * blockalign as usize;

    audio_client.start_stream()?;

    while !stop_flag.load(Ordering::SeqCst) {
        capture_client.read_from_device_to_deque(&mut sample_queue)?;

        while sample_queue.len() >= bytes_per_chunk {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }

            let mut bytes = vec![0u8; bytes_per_chunk];

            for b in bytes.iter_mut() {
                *b = sample_queue.pop_front().unwrap();
            }

            let pcm_i16 = f32le_bytes_to_i16(&bytes);

            if tx.blocking_send(pcm_i16).is_err() {
                audio_client.stop_stream()?;
                return Ok(());
            }
        }

        let _ = event_handle.wait_for_event(100);
    }

    audio_client.stop_stream()?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn f32le_bytes_to_i16(bytes: &[u8]) -> Vec<i16> {
    bytes
        .chunks_exact(4)
        .map(|chunk| {
            let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            let sample = sample.clamp(-1.0, 1.0);
            (sample * i16::MAX as f32) as i16
        })
        .collect()
}
