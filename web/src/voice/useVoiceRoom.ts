import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionState,
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
  inputGain: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  bitrateKbps: number;
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
  inputGain: 1,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  bitrateKbps: 64,
};

function getParticipantName(participant: RemoteParticipant) {
  return participant.name || participant.identity;
}

function isScreenParticipant(participant: RemoteParticipant) {
  return participant.identity.endsWith(":screen");
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

  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const [currentChannelId, setCurrentChannelId] = useState("");
  const [currentChannelName, setCurrentChannelName] = useState("");
  const [voiceSettings, setVoiceSettings] = useState(DEFAULT_VOICE_SETTINGS);
  const [voiceUsers, setVoiceUsers] = useState<VoiceUser[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<RemoteAudioElement[]>([]);
  const [screenShares, setScreenShares] = useState<ScreenShareElement[]>([]);
  const [remoteVolumes, setRemoteVolumes] = useState<Record<string, number>>({});

  const muted = voiceSettings.muted;

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
  }, []);

  const updateVoiceSettings = useCallback(
    (patch: Partial<VoiceSettings>) => {
      setVoiceSettings((current) => {
        const next = { ...current, ...patch };
        const room = roomRef.current;

        if (room && patch.muted !== undefined && patch.muted !== current.muted) {
          room.localParticipant
            .setMicrophoneEnabled(!patch.muted, {
              echoCancellation: next.echoCancellation,
              noiseSuppression: next.noiseSuppression,
              autoGainControl: next.autoGainControl,
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
    [],
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
        await room.localParticipant.setMicrophoneEnabled(
          !voiceSettings.muted,
          {
            echoCancellation: voiceSettings.echoCancellation,
            noiseSuppression: voiceSettings.noiseSuppression,
            autoGainControl: voiceSettings.autoGainControl,
          },
        );

        if (room.state === ConnectionState.Connected) {
          setState("connected");
        }

        refreshParticipants();
      } catch (err) {
        room.disconnect();
        roomRef.current = null;
        setState("error");
        setError(
          err instanceof Error
            ? err.message
            : "Не удалось подключиться к голосовому каналу",
        );
      }
    },
    [
      detachRemoteTrack,
      leaveVoice,
      refreshParticipants,
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
      remoteStreams,
      remoteVolumes,
      screenShares,
      state,
      toggleMute,
      updateRemoteVolume,
      updateVoiceSettings,
      voiceSettings,
      voiceUsers,
    ],
  );
}
