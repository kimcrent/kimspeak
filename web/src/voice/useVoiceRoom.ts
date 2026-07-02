import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionState,
  LocalAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import { createVoiceToken } from "../api";

export type VoiceState = "idle" | "connecting" | "connected" | "error";

export type VoiceSettings = {
  muted: boolean;
  inputDeviceId: string;
  outputDeviceId: string;
  inputGain: number;
  vadThreshold: number;
  bitrateKbps: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  typingAttenuation: boolean;
  comfortNoise: boolean;
};

export type ScreenShareSourceType = "application" | "screen" | "device";

export type ScreenShareSettings = {
  sourceType: ScreenShareSourceType;
  sourceId?: string;
  sourceTitle?: string;
  captureAudio: boolean;
  quality: "sd" | "hd";
  resolution: 360 | 480 | 720 | 1080 | 1440 | "source";
  frameRate: 5 | 30 | 60;
  bitrateKbps: number;
  audioBitrateKbps: 64 | 96 | 128 | 192 | 256 | 320;
  viewerLimit: number;
  privacy: "public" | "contacts" | "private";
};

export type VoiceUser = {
  id: string;
  username: string;
  settings: Pick<VoiceSettings, "muted" | "noiseSuppression">;
};

export type RemoteAudioElement = {
  id: string;
  userId: string;
  element: HTMLMediaElement;
};

export type ScreenShareElement = {
  id: string;
  userId: string;
  username: string;
  element: HTMLMediaElement;
};

type MicrophoneMonitor = {
  audioContext: AudioContext;
  analyser: AnalyserNode;
  dataArray: Uint8Array;
  gateOpen: boolean;
  gateUntil: number;
  level: number;
  monitorTrack: MediaStreamTrack;
  noiseFloor: number;
  rafId: number;
  source: MediaStreamAudioSourceNode;
  sourceTrackId: string;
};

type JoinVoiceArgs = {
  authToken: string;
  channelId: string;
  channelName: string;
  guildId: string;
  userId: string;
  username: string;
};

const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  muted: false,
  inputDeviceId: "",
  outputDeviceId: "",
  inputGain: 1,
  vadThreshold: 0.34,
  bitrateKbps: 64,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: false,
  typingAttenuation: false,
  comfortNoise: false,
};

const VAD_HOLD_MS = 260;
const VAD_CLOSE_RATIO = 0.72;

function getMicrophoneOptions(settings: VoiceSettings) {
  return {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48_000 },
    deviceId: settings.inputDeviceId
      ? { exact: settings.inputDeviceId }
      : undefined,
  };
}

function getParticipantName(participant: RemoteParticipant) {
  return participant.name || participant.identity;
}

function isScreenParticipant(participant: RemoteParticipant) {
  return participant.identity.endsWith(":screen");
}

function getScreenOwnerIdentity(identity: string) {
  return identity.endsWith(":screen") ? identity.slice(0, -":screen".length) : identity;
}

function getParticipantMuted(participant: RemoteParticipant) {
  const publication = participant.getTrackPublication(Track.Source.Microphone);
  return publication?.isMuted ?? false;
}

export function useVoiceRoom() {
  const roomRef = useRef<Room | null>(null);
  const currentUserRef = useRef<{ id: string; username: string } | null>(null);
  const audioElementsRef = useRef(new Map<string, RemoteAudioElement>());
  const screenShareElementsRef = useRef(new Map<string, ScreenShareElement>());
  const remoteVolumesRef = useRef<Record<string, number>>({});
  const microphoneMonitorRef = useRef<MicrophoneMonitor | null>(null);
  const voiceSettingsRef = useRef(DEFAULT_VOICE_SETTINGS);

  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const [currentChannelId, setCurrentChannelId] = useState("");
  const [currentChannelName, setCurrentChannelName] = useState("");
  const [voiceSettings, setVoiceSettings] = useState(DEFAULT_VOICE_SETTINGS);
  const [voiceUsers, setVoiceUsers] = useState<VoiceUser[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<RemoteAudioElement[]>([]);
  const [screenShares, setScreenShares] = useState<ScreenShareElement[]>([]);
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>({});
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [isMicrophoneGateOpen, setIsMicrophoneGateOpen] = useState(false);

  const muted = voiceSettings.muted;

  useEffect(() => {
    voiceSettingsRef.current = voiceSettings;
  }, [voiceSettings]);

  const stopMicrophoneMonitor = useCallback(() => {
    const monitor = microphoneMonitorRef.current;

    if (!monitor) {
      return;
    }

    window.cancelAnimationFrame(monitor.rafId);
    monitor.source.disconnect();
    monitor.monitorTrack.stop();
    void monitor.audioContext.close();
    microphoneMonitorRef.current = null;
    setMicrophoneLevel(0);
    setIsMicrophoneGateOpen(false);
  }, []);

  const startMicrophoneMonitor = useCallback(
    (localTrack: LocalAudioTrack) => {
      const sendTrack = localTrack.mediaStreamTrack;
      const currentMonitor = microphoneMonitorRef.current;

      if (currentMonitor?.sourceTrackId === sendTrack.id) {
        return;
      }

      stopMicrophoneMonitor();

      const audioWindow = window as Window & {
        webkitAudioContext?: typeof AudioContext;
      };
      const AudioContextConstructor =
        globalThis.AudioContext || audioWindow.webkitAudioContext;

      if (!AudioContextConstructor) {
        return;
      }

      const audioContext = new AudioContextConstructor({
        latencyHint: "interactive",
      });
      const monitorTrack = sendTrack.clone();
      const source = audioContext.createMediaStreamSource(
        new MediaStream([monitorTrack]),
      );
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.38;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.fftSize);
      const monitor: MicrophoneMonitor = {
        audioContext,
        analyser,
        dataArray,
        gateOpen: false,
        gateUntil: 0,
        level: 0,
        monitorTrack,
        noiseFloor: 0.03,
        rafId: 0,
        source,
        sourceTrackId: sendTrack.id,
      };

      const tick = () => {
        analyser.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (const sample of dataArray) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }

        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(1, rms * voiceSettingsRef.current.inputGain * 4.8);
        const settings = voiceSettingsRef.current;
        if (!monitor.gateOpen && level < 0.75) {
          monitor.noiseFloor = monitor.noiseFloor * 0.96 + level * 0.04;
        }
        const openThreshold = Math.max(
          settings.vadThreshold,
          Math.min(0.82, monitor.noiseFloor + 0.12),
        );
        const closeThreshold = Math.max(0.01, openThreshold * VAD_CLOSE_RATIO);
        const now = performance.now();
        const shouldOpen = !settings.muted && level >= openThreshold;

        if (shouldOpen) {
          monitor.gateUntil = now + VAD_HOLD_MS;
        }

        const isGateOpen =
          !settings.muted &&
          (level >= closeThreshold || now < monitor.gateUntil);

        if (sendTrack.readyState === "live") {
          sendTrack.enabled = isGateOpen;
        }

        if (Math.abs(monitor.level - level) > 0.01) {
          monitor.level = level;
          setMicrophoneLevel(level);
        }
        if (monitor.gateOpen !== isGateOpen) {
          monitor.gateOpen = isGateOpen;
          setIsMicrophoneGateOpen(isGateOpen);
        }

        monitor.rafId = window.requestAnimationFrame(tick);
      };

      microphoneMonitorRef.current = monitor;
      void audioContext.resume();
      tick();
    },
    [stopMicrophoneMonitor],
  );

  const refreshParticipants = useCallback(() => {
    const room = roomRef.current;
    const currentUser = currentUserRef.current;

    if (!room || !currentUser) {
      setVoiceUsers([]);
      return;
    }

    const nextUsers: VoiceUser[] = [
      {
        id: currentUser.id,
        username: currentUser.username,
        settings: {
          muted: voiceSettings.muted,
          noiseSuppression: voiceSettings.noiseSuppression,
        },
      },
      ...Array.from(room.remoteParticipants.values()).map((participant) => ({
        participant,
      }))
        .filter(({ participant }) => !isScreenParticipant(participant))
        .map(({ participant }) => ({
          id: participant.identity,
          username: getParticipantName(participant),
          settings: {
            muted: getParticipantMuted(participant),
            noiseSuppression: true,
          },
        })),
    ];

    setVoiceUsers(nextUsers);
  }, [voiceSettings.muted, voiceSettings.noiseSuppression]);

  const detachRemoteTrack = useCallback((trackSid: string) => {
    const audioItem = audioElementsRef.current.get(trackSid);

    if (audioItem) {
      audioItem.element.pause();
      audioItem.element.remove();
      audioElementsRef.current.delete(trackSid);
      setRemoteStreams(Array.from(audioElementsRef.current.values()));
      return;
    }

    const screenShareItem = screenShareElementsRef.current.get(trackSid);

    if (!screenShareItem) {
      return;
    }

    screenShareItem.element.pause();
    screenShareItem.element.remove();
    screenShareElementsRef.current.delete(trackSid);
    setScreenShares(Array.from(screenShareElementsRef.current.values()));
  }, []);

  const leaveVoice = useCallback(() => {
    const room = roomRef.current;

    stopMicrophoneMonitor();

    audioElementsRef.current.forEach((item) => {
      item.element.pause();
      item.element.remove();
    });
    audioElementsRef.current.clear();
    setRemoteStreams([]);

    screenShareElementsRef.current.forEach((item) => {
      item.element.pause();
      item.element.remove();
    });
    screenShareElementsRef.current.clear();
    setScreenShares([]);

    if (room) {
      room.disconnect();
      roomRef.current = null;
    }

    currentUserRef.current = null;
    setCurrentChannelId("");
    setCurrentChannelName("");
    setVoiceUsers([]);
    setError("");
    setState("idle");
  }, [stopMicrophoneMonitor]);

  const updateVoiceSettings = useCallback(
    (patch: Partial<VoiceSettings>) => {
      setVoiceSettings((current) => {
        const next = { ...current, ...patch };
        const room = roomRef.current;

        const shouldRefreshMicrophone =
          patch.muted !== undefined ||
          patch.inputDeviceId !== undefined ||
          patch.noiseSuppression !== undefined ||
          patch.echoCancellation !== undefined ||
          patch.autoGainControl !== undefined;

        if (room && shouldRefreshMicrophone) {
          room.localParticipant
            .setMicrophoneEnabled(!next.muted, getMicrophoneOptions(next))
            .then((publication) => {
              if (next.muted) {
                stopMicrophoneMonitor();
                return;
              }

              const localTrack = publication?.track;
              if (localTrack instanceof LocalAudioTrack) {
                startMicrophoneMonitor(localTrack);
              }
            })
            .catch((err) => {
              setError(
                err instanceof Error
                  ? err.message
                  : "Не удалось изменить состояние микрофона",
              );
            });
        }

        return next;
      });
    },
    [startMicrophoneMonitor, stopMicrophoneMonitor],
  );

  const toggleMute = useCallback(() => {
    updateVoiceSettings({ muted: !voiceSettings.muted });
  }, [updateVoiceSettings, voiceSettings.muted]);

  const updateRemoteVolume = useCallback((userId: string, volume: number) => {
    const normalizedVolume = Math.max(0, Math.min(2, volume));
    const nextVolumes = {
      ...remoteVolumesRef.current,
      [userId]: normalizedVolume,
    };

    remoteVolumesRef.current = nextVolumes;
    audioElementsRef.current.forEach((item) => {
      if (item.userId === userId) {
        item.element.volume = normalizedVolume;
      }
    });
    setRemoteVolumes(nextVolumes);
  }, []);

  const joinVoice = useCallback(
    async (args: JoinVoiceArgs) => {
      leaveVoice();
      setState("connecting");
      setError("");
      setCurrentChannelId(args.channelId);
      setCurrentChannelName(args.channelName);
      currentUserRef.current = {
        id: args.userId,
        username: args.username,
      };

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      roomRef.current = room;

      const syncParticipants = () => refreshParticipants();

      const handleTrackSubscribed = (
        track: RemoteTrack,
        publication: { trackSid: string },
        participant: RemoteParticipant,
      ) => {
        if (
          track.kind === Track.Kind.Video &&
          track.source === Track.Source.ScreenShare
        ) {
          const element = track.attach();
          element.autoplay = true;
          element.dataset.trackSid = publication.trackSid;
          element.dataset.userId = participant.identity;
          if (element instanceof HTMLVideoElement) {
            element.playsInline = true;
          }

          screenShareElementsRef.current.set(publication.trackSid, {
            id: publication.trackSid,
            userId: participant.identity,
            username: getParticipantName(participant),
            element,
          });
          setScreenShares(Array.from(screenShareElementsRef.current.values()));
          return;
        }

        if (
          track.kind !== Track.Kind.Audio &&
          track.source !== Track.Source.ScreenShareAudio
        ) {
          return;
        }

        const currentUser = currentUserRef.current;
        const isOwnScreenAudio =
          track.source === Track.Source.ScreenShareAudio &&
          currentUser?.id === getScreenOwnerIdentity(participant.identity);

        if (isOwnScreenAudio) {
          track.detach().forEach((element) => element.remove());
          return;
        }

        const element = track.attach();
        const volume = remoteVolumesRef.current[participant.identity] ?? 1;
        element.autoplay = true;
        element.dataset.trackSid = publication.trackSid;
        element.volume = volume;

        audioElementsRef.current.set(publication.trackSid, {
          id: publication.trackSid,
          userId: participant.identity,
          element,
        });
        setRemoteStreams(Array.from(audioElementsRef.current.values()));
      };

      const handleTrackUnsubscribed = (
        track: RemoteTrack,
        publication: { trackSid: string },
      ) => {
        track.detach();
        detachRemoteTrack(publication.trackSid);
      };

      room
        .on(RoomEvent.ParticipantConnected, syncParticipants)
        .on(RoomEvent.ParticipantDisconnected, syncParticipants)
        .on(RoomEvent.TrackMuted, syncParticipants)
        .on(RoomEvent.TrackUnmuted, syncParticipants)
        .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
        .on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
        .on(RoomEvent.Disconnected, () => {
          if (roomRef.current === room) {
            leaveVoice();
          }
        });

      try {
        const voiceToken = await createVoiceToken(
          args.authToken,
          args.guildId,
          args.channelId,
        );

        await room.connect(voiceToken.url, voiceToken.token);

        if (!voiceSettings.muted) {
          try {
            const microphonePublication =
              await room.localParticipant.setMicrophoneEnabled(
                true,
                getMicrophoneOptions(voiceSettings),
              );

            const localTrack = microphonePublication?.track;
            if (localTrack instanceof LocalAudioTrack) {
              startMicrophoneMonitor(localTrack);
            }
          } catch (microphoneError) {
            const message =
              microphoneError instanceof Error
                ? microphoneError.message
                : "Не удалось включить микрофон";

            console.error("Failed to enable microphone:", microphoneError);
            setVoiceSettings((current) => ({ ...current, muted: true }));
            setError(`Микрофон недоступен: ${message}`);
          }
        }

        if (room.state === ConnectionState.Connected) {
          setState("connected");
        }

        refreshParticipants();
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Не удалось подключиться к голосовому каналу";

        console.error("Failed to connect voice room:", err);
        room.disconnect();
        roomRef.current = null;
        setState("error");
        setError(message);
      }
    },
    [
      detachRemoteTrack,
      leaveVoice,
      refreshParticipants,
      startMicrophoneMonitor,
      voiceSettings,
    ],
  );

  useEffect(() => {
    refreshParticipants();
  }, [refreshParticipants]);

  useEffect(() => leaveVoice, [leaveVoice]);

  return useMemo(
    () => ({
      state,
      error,
      muted,
      voiceSettings,
      currentChannelId,
      currentChannelName,
      voiceUsers,
      remoteStreams,
      screenShares,
      remoteVolumes,
      microphoneLevel,
      isMicrophoneGateOpen,
      joinVoice,
      leaveVoice,
      toggleMute,
      updateVoiceSettings,
      updateRemoteVolume,
    }),
    [
      currentChannelId,
      currentChannelName,
      error,
      joinVoice,
      leaveVoice,
      muted,
      microphoneLevel,
      remoteStreams,
      remoteVolumes,
      screenShares,
      isMicrophoneGateOpen,
      state,
      toggleMute,
      updateRemoteVolume,
      updateVoiceSettings,
      voiceSettings,
      voiceUsers,
    ],
  );
}
