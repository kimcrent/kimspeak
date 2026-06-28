import { RemoteAudio } from "./RemoteAudio";

type VoicePanelProps = {
  state: "idle" | "connecting" | "connected" | "error";
  error: string | null;
  muted: boolean;
  channelName: string | null;
  remoteStreams: MediaStream[];
  onToggleMute: () => void;
  onLeave: () => void;
};

export function VoicePanel({
  state,
  error,
  muted,
  channelName,
  remoteStreams,
  onToggleMute,
  onLeave,
}: VoicePanelProps) {
  if (state === "idle" && !channelName) {
    return null;
  }

  return (
    <div className="voice-panel">
      <div className="voice-panel__info">
        <div className="voice-panel__title">
          {state === "connecting" && "Подключение к голосу..."}
          {state === "connected" && `В голосе: ${channelName}`}
          {state === "error" && "Ошибка голосового канала"}
        </div>

        {error && <div className="voice-panel__error">{error}</div>}

        {state === "connected" && (
          <div className="voice-panel__subtitle">
            Входящих потоков: {remoteStreams.length}
          </div>
        )}
      </div>

      <div className="voice-panel__actions">
        <button type="button" onClick={onToggleMute}>
          {muted ? "Включить микрофон" : "Выключить микрофон"}
        </button>

        <button type="button" onClick={onLeave}>
          Выйти
        </button>
      </div>

      <div className="voice-panel__audios">
        {remoteStreams.map((stream) => (
          <RemoteAudio key={stream.id} stream={stream} />
        ))}
      </div>
    </div>
  );
}
