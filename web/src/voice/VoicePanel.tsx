import { useEffect, useRef } from "react";
import type { RemoteAudioElement } from "./useVoiceRoom";

type VoicePanelProps = {
  remoteStreams: RemoteAudioElement[];
  remoteVolumes: Record<string, number>;
  outputDeviceId?: string;
};

export function VoicePanel({
  remoteStreams,
  remoteVolumes,
  outputDeviceId,
}: VoicePanelProps) {
  const audioHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const audioHost = audioHostRef.current;

    if (!audioHost) {
      return;
    }

    audioHost.replaceChildren(...remoteStreams.map((item) => item.element));
  }, [remoteStreams]);

  useEffect(() => {
    remoteStreams.forEach((item) => {
      item.element.volume = remoteVolumes[item.userId] ?? 1;

      if (outputDeviceId && "setSinkId" in item.element) {
        item.element
          .setSinkId(outputDeviceId)
          .catch((error) => console.error("Failed to set audio output", error));
      }
    });
  }, [outputDeviceId, remoteStreams, remoteVolumes]);

  return <div className="voice-panel__audios" ref={audioHostRef} />;
}
