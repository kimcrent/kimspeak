import { useEffect, useRef } from "react";

type RemoteAudioProps = {
  stream: MediaStream;
  volume: number;
};

export function RemoteAudio({ stream, volume }: RemoteAudioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.srcObject = stream;
    audioRef.current.volume = volume;
  }, [stream, volume]);

  return <audio ref={audioRef} autoPlay />;
}
