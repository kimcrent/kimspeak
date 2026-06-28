import { useEffect, useRef } from "react";

type RemoteAudioProps = {
  stream: MediaStream;
};

export function RemoteAudio({ stream }: RemoteAudioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.srcObject = stream;
  }, [stream]);

  return <audio ref={audioRef} autoPlay />;
}