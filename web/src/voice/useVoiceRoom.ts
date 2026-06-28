import { useCallback, useEffect, useRef, useState } from "react";

type VoiceUser = {
  id: string;
  username: string;
};

type SignalMessage = {
  type: "offer" | "answer" | "candidate" | "error" | "voice_state";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  error?: string;
  users?: VoiceUser[];
};

type VoiceState = "idle" | "connecting" | "connected" | "error";

export type VoiceSettings = {
  inputDeviceId: string;
  inputGain: number;
  outputVolume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  highPassFilter: boolean;
};

const VOICE_SETTINGS_KEY = "kimspeak_voice_settings";

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  inputDeviceId: "",
  inputGain: 1,
  outputVolume: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  highPassFilter: false,
};

const API_BASE_URL = normalizeBaseUrl(
  import.meta.env.DEV ? "/api" : import.meta.env.VITE_API_BASE_URL,
);
const WS_URL = toWebSocketBaseUrl(API_BASE_URL);

function normalizeBaseUrl(baseUrl?: string): string {
  const normalized = baseUrl?.trim() || "/api";
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function toWebSocketBaseUrl(baseUrl: string): string {
  if (baseUrl.startsWith("/")) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${baseUrl}`;
  }

  return baseUrl.replace(/^http/i, "ws");
}

function getVoiceErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return "Не удалось войти в голосовой канал";
  }

  if (err.name === "NotAllowedError") {
    return "Нет доступа к микрофону. Разрешите KIMSpeak доступ к микрофону в настройках macOS.";
  }

  if (err.name === "NotFoundError") {
    return "Микрофон не найден. Проверьте устройство ввода в macOS.";
  }

  if (err.name === "NotReadableError") {
    return "Микрофон занят другим приложением или недоступен.";
  }

  return err.message || "Не удалось войти в голосовой канал";
}

function getInitialVoiceSettings(): VoiceSettings {
  try {
    const saved = localStorage.getItem(VOICE_SETTINGS_KEY);

    if (!saved) {
      return DEFAULT_VOICE_SETTINGS;
    }

    return {
      ...DEFAULT_VOICE_SETTINGS,
      ...(JSON.parse(saved) as Partial<VoiceSettings>),
    };
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

function getAudioConstraints(settings: VoiceSettings): MediaTrackConstraints {
  return {
    deviceId: settings.inputDeviceId
      ? {
          exact: settings.inputDeviceId,
        }
      : undefined,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: 1,
    sampleRate: 48000,
    sampleSize: 16,
  };
}

export function useVoiceRoom() {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelFrameRef = useRef<number | null>(null);

  const [voiceUsers, setVoiceUsers] = useState<VoiceUser[]>([]);
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  const [currentChannelName, setCurrentChannelName] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);
  const [muted, setMuted] = useState(false);
  const [settings, setSettingsState] = useState<VoiceSettings>(getInitialVoiceSettings);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [inputLevel, setInputLevel] = useState(0);
  const settingsRef = useRef<VoiceSettings>(settings);

  const refreshInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setInputDevices([]);
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    setInputDevices(devices.filter((device) => device.kind === "audioinput"));
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }

    navigator.mediaDevices.addEventListener("devicechange", refreshInputDevices);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshInputDevices);
    };
  }, [refreshInputDevices]);

  const stopLevelMeter = useCallback(() => {
    if (levelFrameRef.current !== null) {
      window.cancelAnimationFrame(levelFrameRef.current);
      levelFrameRef.current = null;
    }

    setInputLevel(0);
  }, []);

  const startLevelMeter = useCallback(() => {
    stopLevelMeter();

    const analyser = analyserRef.current;

    if (!analyser) {
      return;
    }

    const buffer = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);

      let sum = 0;
      for (const value of buffer) {
        const centered = value - 128;
        sum += centered * centered;
      }

      const rms = Math.sqrt(sum / buffer.length) / 128;
      setInputLevel(Math.min(1, rms * 2.4));
      levelFrameRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  }, [stopLevelMeter]);

  const setVoiceSettings = useCallback((next: VoiceSettings) => {
    const normalized = {
      ...next,
      inputGain: Math.min(2, Math.max(0, next.inputGain)),
      outputVolume: Math.min(1, Math.max(0, next.outputVolume)),
    };

    settingsRef.current = normalized;
    setSettingsState(normalized);
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(normalized));

    const gainNode = gainNodeRef.current;
    if (gainNode) {
      gainNode.gain.value = normalized.inputGain;
    }

    const rawTrack = rawStreamRef.current?.getAudioTracks()[0];
    if (rawTrack) {
      rawTrack
        .applyConstraints(getAudioConstraints(normalized))
        .catch(() => {
          // Some devices do not support changing processing constraints while active.
        });
    }
  }, []);

  const createProcessedAudioStream = useCallback(async (rawStream: MediaStream) => {
    const audioContext = new AudioContext({
      sampleRate: 48000,
    });
    const source = audioContext.createMediaStreamSource(rawStream);
    const analyser = audioContext.createAnalyser();
    const filterNode = audioContext.createBiquadFilter();
    const gainNode = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();

    analyser.fftSize = 256;
    filterNode.type = "highpass";
    filterNode.frequency.value = 85;
    gainNode.gain.value = settingsRef.current.inputGain;

    source.connect(analyser);
    if (settingsRef.current.highPassFilter) {
      analyser.connect(filterNode);
      filterNode.connect(gainNode);
    } else {
      analyser.connect(gainNode);
    }
    gainNode.connect(destination);

    audioContextRef.current = audioContext;
    gainNodeRef.current = gainNode;
    analyserRef.current = analyser;

    startLevelMeter();

    return destination.stream;
  }, [startLevelMeter]);

  const sendSignal = useCallback((message: SignalMessage) => {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(JSON.stringify(message));
  }, []);

  const leaveVoice = useCallback(() => {
    stopLevelMeter();

    const localStream = localStreamRef.current;
    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
    }

    const rawStream = rawStreamRef.current;
    if (rawStream) {
      for (const track of rawStream.getTracks()) {
        track.stop();
      }
    }

    const audioContext = audioContextRef.current;
    if (audioContext) {
      void audioContext.close();
    }

    const pc = pcRef.current;
    if (pc) {
      pc.close();
    }

    const ws = wsRef.current;
    if (ws) {
      ws.close();
    }

    localStreamRef.current = null;
    rawStreamRef.current = null;
    audioContextRef.current = null;
    gainNodeRef.current = null;
    analyserRef.current = null;
    pcRef.current = null;
    wsRef.current = null;

    setState("idle");
    setError(null);
    setCurrentChannelId(null);
    setCurrentChannelName(null);
    setRemoteStreams([]);
    setVoiceUsers([]);
    setMuted(false);
  }, [stopLevelMeter]);

  const joinVoice = useCallback(
    async (params: {
      channelId: string;
      channelName: string;
      userId: string;
      username: string;
    }) => {
      const { channelId, channelName, userId, username } = params;

      if (!channelId || !userId) {
        setError("channelId и userId обязательны");
        setState("error");
        return;
      }

      leaveVoice();

      setState("connecting");
      setError(null);
      setCurrentChannelId(channelId);
      setCurrentChannelName(channelName);
      setRemoteStreams([]);

      try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(settingsRef.current),
          video: false,
        });
        const localStream = await createProcessedAudioStream(rawStream);

        rawStreamRef.current = rawStream;
        localStreamRef.current = localStream;
        refreshInputDevices().catch(() => {
          setInputDevices([]);
        });

        const pc = new RTCPeerConnection({
          iceServers: [
            {
              urls: "stun:stun.l.google.com:19302",
            },
          ],
        });

        pcRef.current = pc;

        pc.onicecandidate = (event) => {
          if (!event.candidate) {
            return;
          }

          sendSignal({
            type: "candidate",
            candidate: event.candidate.toJSON(),
          });
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            setError(null);
            setState("connected");
            return;
          }

          if (pc.connectionState === "disconnected") {
            setError("WebRTC соединение временно потеряно, пробуем восстановить...");
            setState("connecting");
            return;
          }

          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            setError(`WebRTC соединение ${pc.connectionState}`);
            setState("error");
          }
        };

        pc.ontrack = (event) => {
          const stream = event.streams[0] ?? new MediaStream([event.track]);

          if (!stream) {
            return;
          }

          event.track.onended = () => {
            setRemoteStreams((prev) =>
              prev.filter((item) => item.id !== stream.id),
            );
          };

          setRemoteStreams((prev) => {
            const activeStreams = prev.filter((item) =>
              item.getTracks().some((track) => track.readyState !== "ended"),
            );
            const exists = activeStreams.some((item) => item.id === stream.id);
            if (exists) {
              return activeStreams;
            }

            return [...activeStreams, stream];
          });
        };

        for (const track of localStream.getTracks()) {
          const sender = pc.addTrack(track, localStream);

          if (track.kind === "audio") {
            const parameters = sender.getParameters();

            if (!parameters.encodings) {
              parameters.encodings = [{}];
            }

            parameters.encodings[0].maxBitrate = 96000;

            try {
              await sender.setParameters(parameters);
            } catch {
              // Не критично. Некоторые браузеры могут не дать менять bitrate.
            }
          }
        }

        const wsUrl = `${WS_URL}/voice/ws?channel_id=${encodeURIComponent(
            channelId,
          )}&user_id=${encodeURIComponent(userId)}&username=${encodeURIComponent(
            username,
          )}`;
        const ws = new WebSocket(wsUrl);
        let wsOpened = false;

        wsRef.current = ws;

        ws.onopen = async () => {
          wsOpened = true;

          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            sendSignal({
              type: "offer",
              sdp: pc.localDescription ?? undefined,
            });
          } catch (err) {
            setError(getVoiceErrorMessage(err));
            setState("error");
            leaveVoice();
          }
        };

        ws.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data) as SignalMessage;

            if (message.type === "voice_state") {
              setVoiceUsers(message.users ?? []);
              return;
            }

            if (message.type === "answer") {
              if (!message.sdp) {
                return;
              }

              await pc.setRemoteDescription(message.sdp);
              return;
            }

            if (message.type === "offer") {
              if (!message.sdp) {
                return;
              }

              await pc.setRemoteDescription(message.sdp);

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              sendSignal({
                type: "answer",
                sdp: pc.localDescription ?? undefined,
              });

              return;
            }

            if (message.type === "candidate") {
              if (!message.candidate) {
                return;
              }

              await pc.addIceCandidate(message.candidate);
              return;
            }

            if (message.type === "error") {
              setError(message.error ?? "Ошибка voice-сервера");
              setState("error");
            }
          } catch (err) {
            setError(getVoiceErrorMessage(err));
            setState("error");
          }
        };

        ws.onerror = () => {
          setError(`Не удалось подключиться к voice WebSocket (${wsUrl})`);
          setState("error");
        };

        ws.onclose = (event) => {
          if (!wsOpened) {
            setError(`Voice WebSocket закрылся до подключения (${event.code})`);
            setState("error");
            return;
          }

          if (event.code !== 1000) {
            setError(`Voice WebSocket закрыт (${event.code})`);
            setState("error");
            return;
          }

          setState((current) => {
            if (current === "error") {
              return current;
            }

            return "idle";
          });
        };
      } catch (err) {
        const message = getVoiceErrorMessage(err);

        setError(message);
        setState("error");
        leaveVoice();
      }
    },
    [createProcessedAudioStream, leaveVoice, refreshInputDevices, sendSignal],
  );

  const toggleMute = useCallback(() => {
    const localStream = localStreamRef.current;

    if (!localStream) {
      return;
    }

    const nextMuted = !muted;

    for (const track of localStream.getAudioTracks()) {
      track.enabled = !nextMuted;
    }

    setMuted(nextMuted);
  }, [muted]);

  return {
    state,
    error,
    muted,
    settings,
    inputDevices,
    inputLevel,
    currentChannelId,
    currentChannelName,
    remoteStreams,
    voiceUsers,
    joinVoice,
    leaveVoice,
    toggleMute,
    refreshInputDevices,
    setVoiceSettings,
  };
}
