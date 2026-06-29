import { useEffect, useRef } from "react";

type RemoteAudioProps = {
  stream: MediaStream;
  volume: number;
};

type WindowWithWebAudio = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getAudioContextConstructor(): typeof AudioContext | null {
  const audioWindow = window as WindowWithWebAudio;
  return audioWindow.AudioContext || audioWindow.webkitAudioContext || null;
}

export function RemoteAudio({ stream, volume }: RemoteAudioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const isFallbackAudioRef = useRef(false);

  useEffect(() => {
    const AudioContextConstructor = getAudioContextConstructor();
    const audioElement = audioRef.current;

    isFallbackAudioRef.current = false;

    if (AudioContextConstructor) {
      try {
        const audioContext = new AudioContextConstructor({
          latencyHint: "interactive",
        });
        const sourceNode = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();

        gainNode.gain.value = 1;
        sourceNode.connect(gainNode);
        gainNode.connect(audioContext.destination);

        if (audioContext.state === "suspended") {
          void audioContext.resume();
        }

        audioContextRef.current = audioContext;
        sourceNodeRef.current = sourceNode;
        gainNodeRef.current = gainNode;

        return () => {
          sourceNode.disconnect();
          gainNode.disconnect();
          void audioContext.close();

          if (audioContextRef.current === audioContext) {
            audioContextRef.current = null;
            sourceNodeRef.current = null;
            gainNodeRef.current = null;
          }
        };
      } catch {
        // Ниже остаётся обычный audio fallback без усиления выше 100%.
      }
    }

    if (!audioElement) {
      return;
    }

    isFallbackAudioRef.current = true;
    audioElement.srcObject = stream;
    audioElement.volume = 1;

    return () => {
      audioElement.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const nextVolume = clamp(volume, 0, 2);
    const gainNode = gainNodeRef.current;
    const audioContext = audioContextRef.current;

    if (gainNode && audioContext) {
      gainNode.gain.setTargetAtTime(nextVolume, audioContext.currentTime, 0.02);
      return;
    }

    if (isFallbackAudioRef.current && audioRef.current) {
      audioRef.current.volume = clamp(nextVolume, 0, 1);
    }
  }, [volume]);

  return <audio ref={audioRef} autoPlay />;
}
