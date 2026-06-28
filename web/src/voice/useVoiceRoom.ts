import { useCallback, useRef, useState } from "react";



type VoiceUser = {
  id:string,
  username:string,
};

type SignalMessage = {
  type: "offer" | "answer" | "candidate" | "error"| "voice_state";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  error?: string;
  users?: VoiceUser[];
};

type VoiceState = "idle" | "connecting" | "connected" | "error";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";
const WS_URL = API_URL.replace(/^http/, "ws");

export function useVoiceRoom() {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [voiceUsers, setVoiceUsers] = useState<VoiceUser[]>([]);
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  const [currentChannelName, setCurrentChannelName] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);
  const [muted, setMuted] = useState(false);

  const sendSignal = useCallback((message: SignalMessage) => {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(JSON.stringify(message));
  }, []);

  const leaveVoice = useCallback(() => {
    const localStream = localStreamRef.current;
    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
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
    pcRef.current = null;
    wsRef.current = null;

    setState("idle");
    setError(null);
    setCurrentChannelId(null);
    setCurrentChannelName(null);
    setRemoteStreams([]);
    setVoiceUsers([]);
    setMuted(false);
  }, []);

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
        const localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 48000,
          },
          video: false,
        });

        localStreamRef.current = localStream;

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
            setState("connected");
          }

          if (
            pc.connectionState === "failed" ||
            pc.connectionState === "closed" ||
            pc.connectionState === "disconnected"
          ) {
            setState("idle");
          }
        };

        pc.ontrack = (event) => {
          const stream = event.streams[0];

          if (!stream) {
            return;
          }

          setRemoteStreams((prev) => {
            const exists = prev.some((item) => item.id === stream.id);
            if (exists) {
              return prev;
            }

            return [...prev, stream];
          });
        };

        for (const track of localStream.getTracks()) {
          const sender = pc.addTrack(track, localStream);

          if (track.kind === "audio") {
            const parameters = sender.getParameters();

            if (!parameters.encodings) {
              parameters.encodings = [{}];
            }

            parameters.encodings[0].maxBitrate = 64000;

            try {
              await sender.setParameters(parameters);
            } catch {
              // Не критично. Некоторые браузеры могут не дать менять bitrate.
            }
          }
        }

        const ws = new WebSocket(
          `${WS_URL}/voice/ws?channel_id=${encodeURIComponent(
            channelId,
          )}&user_id=${encodeURIComponent(userId)}&username=${encodeURIComponent(
            username,
          )}`,
        );

        wsRef.current = ws;

        ws.onopen = async () => {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          sendSignal({
            type: "offer",
            sdp: pc.localDescription ?? undefined,
          });
        };

        ws.onmessage = async (event) => {
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
        };

        ws.onerror = () => {
          setError("Ошибка WebSocket voice-подключения");
          setState("error");
        };

        ws.onclose = () => {
          if (state !== "idle") {
            setState("idle");
          }
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Не удалось войти в голосовой канал";

        setError(message);
        setState("error");
        leaveVoice();
      }
    },
    [leaveVoice, sendSignal, state],
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
    currentChannelId,
    currentChannelName,
    remoteStreams,
    voiceUsers,
    joinVoice,
    leaveVoice,
    toggleMute,
  };
}