import { useCallback, useRef, useState } from "react";

export type VoiceSettings = {
  muted: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  inputGain: number;
  bitrateKbps: number;
};

export type VoiceUser = {
  id: string;
  username: string;
  settings: VoiceSettings;
};

export type RemoteVoiceStream = {
  id: string;
  trackId: string;
  userId: string | null;
  stream: MediaStream;
};

type SignalMessage = {
  type:
    | "offer"
    | "answer"
    | "candidate"
    | "error"
    | "voice_state"
    | "voice_settings";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  settings?: VoiceSettings;
  error?: string;
  users?: VoiceUser[];
};

type VoiceState = "idle" | "connecting" | "connected" | "error";

type AudioTrackConstraints = MediaTrackConstraints & {
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

type WindowWithWebAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  muted: false,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  inputGain: 1,
  bitrateKbps: 64,
};

const VOICE_SETTINGS_KEY = "kimspeak_voice_settings";
const REMOTE_VOLUME_KEY = "kimspeak_remote_voice_volumes";
const SETTINGS_BROADCAST_DELAY = 120;
const CONNECTION_RECOVERY_DELAY = 4500;

const API_BASE_URL = normalizeBaseUrl(
  import.meta.env.DEV ? "/api" : import.meta.env.VITE_API_BASE_URL,
);
const WS_URL = toWebSocketBaseUrl(API_BASE_URL);
const ICE_SERVERS = loadIceServers();

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

function splitEnvList(value?: string): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadIceServers(): RTCIceServer[] {
  const stunUrls = splitEnvList(import.meta.env.VITE_WEBRTC_STUN_URLS);
  const turnUrls = splitEnvList(import.meta.env.VITE_WEBRTC_TURN_URLS);
  const iceServers: RTCIceServer[] = [
    {
      urls: stunUrls.length ? stunUrls : "stun:stun.l.google.com:19302",
    },
  ];

  if (turnUrls.length) {
    iceServers.push({
      urls: turnUrls,
      username: import.meta.env.VITE_WEBRTC_TURN_USERNAME,
      credential: import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL,
    });
  }

  return iceServers;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRemoteVolume(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 2) : 1;
}

function normalizeVoiceSettings(
  value?: Partial<VoiceSettings> | null,
): VoiceSettings {
  const settings = value || {};
  const inputGain = Number(settings.inputGain ?? DEFAULT_VOICE_SETTINGS.inputGain);
  const bitrateKbps = Number(
    settings.bitrateKbps ?? DEFAULT_VOICE_SETTINGS.bitrateKbps,
  );

  return {
    muted: Boolean(settings.muted ?? DEFAULT_VOICE_SETTINGS.muted),
    echoCancellation: Boolean(
      settings.echoCancellation ?? DEFAULT_VOICE_SETTINGS.echoCancellation,
    ),
    noiseSuppression: Boolean(
      settings.noiseSuppression ?? DEFAULT_VOICE_SETTINGS.noiseSuppression,
    ),
    autoGainControl: Boolean(
      settings.autoGainControl ?? DEFAULT_VOICE_SETTINGS.autoGainControl,
    ),
    inputGain: Number.isFinite(inputGain) ? clamp(inputGain, 0, 2) : 1,
    bitrateKbps: Number.isFinite(bitrateKbps)
      ? Math.round(clamp(bitrateKbps, 16, 128))
      : 64,
  };
}

function readStoredVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_KEY);
    return raw
      ? normalizeVoiceSettings(JSON.parse(raw) as Partial<VoiceSettings>)
      : DEFAULT_VOICE_SETTINGS;
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

function persistVoiceSettings(settings: VoiceSettings) {
  try {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Настройки микрофона не критичны, если хранилище недоступно.
  }
}

function readStoredRemoteVolumes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(REMOTE_VOLUME_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const volumes: Record<string, number> = {};

    for (const [userId, volume] of Object.entries(parsed)) {
      volumes[userId] = normalizeRemoteVolume(Number(volume));
    }

    return volumes;
  } catch {
    return {};
  }
}

function persistRemoteVolumes(volumes: Record<string, number>) {
  try {
    localStorage.setItem(REMOTE_VOLUME_KEY, JSON.stringify(volumes));
  } catch {
    // Персональная громкость не должна ломать голос, если storage недоступен.
  }
}

function getAudioConstraints(settings: VoiceSettings): AudioTrackConstraints {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: 1,
    sampleRate: 48000,
  };
}

function getAudioContextConstructor(): typeof AudioContext | null {
  const audioWindow = window as WindowWithWebAudio;
  return audioWindow.AudioContext || audioWindow.webkitAudioContext || null;
}

function getOwnerIdFromTrackId(trackId: string): string | null {
  const separatorIndex = trackId.indexOf("_");

  if (separatorIndex <= 0) {
    return null;
  }

  return trackId.slice(0, separatorIndex);
}

async function setSenderBitrate(
  sender: RTCRtpSender | null,
  bitrateKbps: number,
) {
  if (!sender) {
    return;
  }

  const parameters = sender.getParameters();

  if (!parameters.encodings) {
    parameters.encodings = [{}];
  }

  parameters.encodings[0].maxBitrate = bitrateKbps * 1000;
  await sender.setParameters(parameters);
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

export function useVoiceRoom() {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const settingsBroadcastTimerRef = useRef<number | null>(null);
  const pendingSettingsRef = useRef<VoiceSettings | null>(null);
  const voiceSessionRef = useRef(0);
  const connectionRecoveryTimerRef = useRef<number | null>(null);

  const [voiceUsers, setVoiceUsers] = useState<VoiceUser[]>([]);
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  const [currentChannelName, setCurrentChannelName] = useState<string | null>(
    null,
  );
  const [remoteStreams, setRemoteStreams] = useState<RemoteVoiceStream[]>([]);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(
    readStoredVoiceSettings,
  );
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>(
    readStoredRemoteVolumes,
  );
  const voiceSettingsRef = useRef<VoiceSettings>(voiceSettings);
  const remoteVolumesRef = useRef<Record<string, number>>(remoteVolumes);

  const sendSignal = useCallback((message: SignalMessage) => {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(JSON.stringify(message));
  }, []);

  const clearSettingsBroadcast = useCallback(() => {
    if (settingsBroadcastTimerRef.current === null) {
      return;
    }

    window.clearTimeout(settingsBroadcastTimerRef.current);
    settingsBroadcastTimerRef.current = null;
    pendingSettingsRef.current = null;
  }, []);

  const clearConnectionRecoveryTimer = useCallback(() => {
    if (connectionRecoveryTimerRef.current === null) {
      return;
    }

    window.clearTimeout(connectionRecoveryTimerRef.current);
    connectionRecoveryTimerRef.current = null;
  }, []);

  const scheduleSettingsBroadcast = useCallback(
    (settings: VoiceSettings) => {
      pendingSettingsRef.current = settings;

      if (settingsBroadcastTimerRef.current !== null) {
        return;
      }

      settingsBroadcastTimerRef.current = window.setTimeout(() => {
        settingsBroadcastTimerRef.current = null;

        const pendingSettings = pendingSettingsRef.current;
        pendingSettingsRef.current = null;

        if (pendingSettings) {
          sendSignal({
            type: "voice_settings",
            settings: pendingSettings,
          });
        }
      }, SETTINGS_BROADCAST_DELAY);
    },
    [sendSignal],
  );

  const cleanupAudioGraph = useCallback(() => {
    audioSourceNodeRef.current?.disconnect();
    gainNodeRef.current?.disconnect();

    if (
      audioContextRef.current &&
      audioContextRef.current.state !== "closed"
    ) {
      void audioContextRef.current.close();
    }

    audioSourceNodeRef.current = null;
    gainNodeRef.current = null;
    audioContextRef.current = null;
  }, []);

  const createLocalAudioStream = useCallback(
    async (sourceStream: MediaStream, settings: VoiceSettings) => {
      cleanupAudioGraph();

      const sourceTrack = sourceStream.getAudioTracks()[0];
      const AudioContextConstructor = getAudioContextConstructor();

      if (!sourceTrack || !AudioContextConstructor) {
        return sourceStream;
      }

      try {
        const audioContext = new AudioContextConstructor({
          latencyHint: "interactive",
        });
        const sourceNode = audioContext.createMediaStreamSource(
          new MediaStream([sourceTrack]),
        );
        const gainNode = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();

        gainNode.gain.value = settings.inputGain;
        sourceNode.connect(gainNode);
        gainNode.connect(destination);

        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }

        audioContextRef.current = audioContext;
        audioSourceNodeRef.current = sourceNode;
        gainNodeRef.current = gainNode;

        return destination.stream;
      } catch {
        cleanupAudioGraph();
        return sourceStream;
      }
    },
    [cleanupAudioGraph],
  );

  const applyVoiceSettings = useCallback(async (settings: VoiceSettings) => {
    const sourceStream = sourceStreamRef.current;

    if (sourceStream) {
      await Promise.all(
        sourceStream.getAudioTracks().map(async (track) => {
          track.enabled = !settings.muted;

          try {
            await track.applyConstraints(getAudioConstraints(settings));
          } catch {
            // Не все окружения позволяют менять DSP-флаги на лету.
          }
        }),
      );
    }

    const localStream = localStreamRef.current;
    if (localStream && localStream !== sourceStream) {
      for (const track of localStream.getAudioTracks()) {
        track.enabled = !settings.muted;
      }
    }

    const gainNode = gainNodeRef.current;
    const audioContext = audioContextRef.current;
    if (gainNode && audioContext) {
      gainNode.gain.setTargetAtTime(
        settings.inputGain,
        audioContext.currentTime,
        0.02,
      );
    }

    try {
      await setSenderBitrate(audioSenderRef.current, settings.bitrateKbps);
    } catch {
      // Bitrate hint может быть недоступен в части WebView/браузеров.
    }
  }, []);

  const commitVoiceSettings = useCallback((settings: VoiceSettings) => {
    voiceSettingsRef.current = settings;
    setVoiceSettings(settings);
    persistVoiceSettings(settings);
  }, []);

  const updateVoiceSettings = useCallback(
    (patch: Partial<VoiceSettings>) => {
      const nextSettings = normalizeVoiceSettings({
        ...voiceSettingsRef.current,
        ...patch,
      });

      commitVoiceSettings(nextSettings);
      void applyVoiceSettings(nextSettings);
      scheduleSettingsBroadcast(nextSettings);
    },
    [applyVoiceSettings, commitVoiceSettings, scheduleSettingsBroadcast],
  );

  const updateRemoteVolume = useCallback((userId: string, volume: number) => {
    const nextVolume = normalizeRemoteVolume(volume);
    const nextVolumes = {
      ...remoteVolumesRef.current,
      [userId]: nextVolume,
    };

    remoteVolumesRef.current = nextVolumes;
    setRemoteVolumes(nextVolumes);
    persistRemoteVolumes(nextVolumes);
  }, []);

  const leaveVoice = useCallback(() => {
    voiceSessionRef.current += 1;
    clearSettingsBroadcast();
    clearConnectionRecoveryTimer();

    const sourceStream = sourceStreamRef.current;
    if (sourceStream) {
      for (const track of sourceStream.getTracks()) {
        track.stop();
      }
    }

    const localStream = localStreamRef.current;
    if (localStream && localStream !== sourceStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
    }

    cleanupAudioGraph();

    const pc = pcRef.current;
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      pc.close();
    }

    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;

      if (
        ws.readyState === WebSocket.CONNECTING ||
        ws.readyState === WebSocket.OPEN
      ) {
        ws.close(1000, "leave");
      } else {
        ws.close();
      }
    }

    sourceStreamRef.current = null;
    localStreamRef.current = null;
    audioSenderRef.current = null;
    pcRef.current = null;
    wsRef.current = null;

    setState("idle");
    setError(null);
    setCurrentChannelId(null);
    setCurrentChannelName(null);
    setRemoteStreams([]);
    setVoiceUsers([]);
  }, [cleanupAudioGraph, clearConnectionRecoveryTimer, clearSettingsBroadcast]);

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

      const sessionId = voiceSessionRef.current + 1;
      voiceSessionRef.current = sessionId;
      const isCurrentSession = () => voiceSessionRef.current === sessionId;
      const initialSettings = voiceSettingsRef.current;

      setState("connecting");
      setError(null);
      setCurrentChannelId(channelId);
      setCurrentChannelName(channelName);
      setRemoteStreams([]);

      try {
        const sourceStream = await navigator.mediaDevices.getUserMedia({
          audio: getAudioConstraints(initialSettings),
          video: false,
        });

        if (!isCurrentSession()) {
          for (const track of sourceStream.getTracks()) {
            track.stop();
          }
          return;
        }

        const localStream = await createLocalAudioStream(
          sourceStream,
          initialSettings,
        );

        if (!isCurrentSession()) {
          for (const track of sourceStream.getTracks()) {
            track.stop();
          }

          if (localStream !== sourceStream) {
            for (const track of localStream.getTracks()) {
              track.stop();
            }
          }
          return;
        }

        sourceStreamRef.current = sourceStream;
        localStreamRef.current = localStream;

        const pc = new RTCPeerConnection({
          iceServers: ICE_SERVERS,
        });

        pcRef.current = pc;

        pc.onicecandidate = (event) => {
          if (!isCurrentSession()) {
            return;
          }

          if (!event.candidate) {
            return;
          }

          sendSignal({
            type: "candidate",
            candidate: event.candidate.toJSON(),
          });
        };

        pc.onconnectionstatechange = () => {
          if (!isCurrentSession()) {
            return;
          }

          if (pc.connectionState === "connected") {
            clearConnectionRecoveryTimer();
            setError(null);
            setState("connected");
            return;
          }

          if (pc.connectionState === "disconnected") {
            clearConnectionRecoveryTimer();
            setError("Голосовое соединение восстанавливается...");
            connectionRecoveryTimerRef.current = window.setTimeout(() => {
              connectionRecoveryTimerRef.current = null;

              if (
                isCurrentSession() &&
                pc.connectionState === "disconnected"
              ) {
                setError("WebRTC соединение потеряно");
                setState("error");
              }
            }, CONNECTION_RECOVERY_DELAY);
            return;
          }

          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            clearConnectionRecoveryTimer();
            setError(`WebRTC соединение ${pc.connectionState}`);
            setState("error");
          }
        };

        pc.ontrack = (event) => {
          if (!isCurrentSession()) {
            return;
          }

          const stream = event.streams[0];

          if (!stream) {
            return;
          }

          const remoteStream: RemoteVoiceStream = {
            id: `${stream.id}:${event.track.id}`,
            trackId: event.track.id,
            userId: getOwnerIdFromTrackId(event.track.id),
            stream,
          };

          event.track.onended = () => {
            if (!isCurrentSession()) {
              return;
            }

            setRemoteStreams((prev) =>
              prev.filter((item) => item.trackId !== event.track.id),
            );
          };

          setRemoteStreams((prev) => {
            const exists = prev.some((item) => item.trackId === event.track.id);
            if (exists) {
              return prev.map((item) =>
                item.trackId === event.track.id ? remoteStream : item,
              );
            }

            return [...prev, remoteStream];
          });
        };

        for (const track of localStream.getTracks()) {
          const sender = pc.addTrack(track, localStream);

          if (track.kind === "audio") {
            audioSenderRef.current = sender;
            await setSenderBitrate(sender, initialSettings.bitrateKbps).catch(
              () => undefined,
            );
          }
        }

        await applyVoiceSettings(initialSettings);

        const wsUrl = `${WS_URL}/voice/ws?channel_id=${encodeURIComponent(
          channelId,
        )}&user_id=${encodeURIComponent(userId)}&username=${encodeURIComponent(
          username,
        )}`;
        const ws = new WebSocket(wsUrl);
        let wsOpened = false;

        wsRef.current = ws;

        ws.onopen = async () => {
          if (!isCurrentSession()) {
            return;
          }

          wsOpened = true;

          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            sendSignal({
              type: "offer",
              sdp: pc.localDescription ?? undefined,
            });
            sendSignal({
              type: "voice_settings",
              settings: voiceSettingsRef.current,
            });
          } catch (err) {
            if (!isCurrentSession()) {
              return;
            }

            setError(getVoiceErrorMessage(err));
            setState("error");
            leaveVoice();
          }
        };

        ws.onmessage = async (event) => {
          if (!isCurrentSession()) {
            return;
          }

          try {
            const message = JSON.parse(event.data) as SignalMessage;

            if (message.type === "voice_state") {
              setVoiceUsers(
                (message.users ?? []).map((user) => ({
                  ...user,
                  settings: normalizeVoiceSettings(user.settings),
                })),
              );
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
            if (!isCurrentSession()) {
              return;
            }

            setError(getVoiceErrorMessage(err));
            setState("error");
          }
        };

        ws.onerror = () => {
          if (!isCurrentSession()) {
            return;
          }

          setError("Не удалось подключиться к voice WebSocket");
          setState("error");
        };

        ws.onclose = (event) => {
          if (!isCurrentSession()) {
            return;
          }

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
        if (voiceSessionRef.current !== sessionId) {
          return;
        }

        const message = getVoiceErrorMessage(err);

        setError(message);
        setState("error");
        leaveVoice();
      }
    },
    [
      applyVoiceSettings,
      clearConnectionRecoveryTimer,
      createLocalAudioStream,
      leaveVoice,
      sendSignal,
    ],
  );

  const toggleMute = useCallback(() => {
    updateVoiceSettings({
      muted: !voiceSettingsRef.current.muted,
    });
  }, [updateVoiceSettings]);

  return {
    state,
    error,
    muted: voiceSettings.muted,
    voiceSettings,
    currentChannelId,
    currentChannelName,
    remoteStreams,
    remoteVolumes,
    voiceUsers,
    joinVoice,
    leaveVoice,
    toggleMute,
    updateVoiceSettings,
    updateRemoteVolume,
  };
}
