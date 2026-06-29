import { RemoteAudio } from "./RemoteAudio";
import type { RemoteVoiceStream, VoiceSettings } from "./useVoiceRoom";

type VoicePanelProps = {
  state: "idle" | "connecting" | "connected" | "error";
  error: string | null;
  muted: boolean;
  voiceSettings: VoiceSettings;
  channelName: string | null;
  remoteStreams: RemoteVoiceStream[];
  remoteVolumes: Record<string, number>;
  onToggleMute: () => void;
  onOpenSettings: () => void;
  onLeave: () => void;
};

export function VoicePanel({
  state,
  error,
  muted,
  voiceSettings,
  channelName,
  remoteStreams,
  remoteVolumes,
  onToggleMute,
  onOpenSettings,
  onLeave,
}: VoicePanelProps) {
  if (state === "idle" && !channelName) {
    return null;
  }

  return (
    <div className={`voice-panel voice-panel--${state}`}>
      <div className="voice-panel__info">
        <div className="voice-panel__title">
          {state === "connecting" && "Подключение к голосу..."}
          {state === "connected" && `В голосе: ${channelName}`}
          {state === "error" && "Ошибка голосового канала"}
        </div>

        {error && <div className="voice-panel__error">{error}</div>}

        {state === "connected" && (
          <div className="voice-panel__subtitle">
            {remoteStreams.length} входящих · микрофон{" "}
            {muted ? "выключен" : "включён"} · усиление{" "}
            {Math.round(voiceSettings.inputGain * 100)}%
          </div>
        )}
      </div>

      <div className="voice-panel__actions">
        <button
          className={muted ? "voice-panel__mute muted" : "voice-panel__mute"}
          type="button"
          onClick={onToggleMute}
        >
          {muted ? "Вкл. микрофон" : "Выкл. микрофон"}
        </button>

        <button
          className="voice-panel__icon"
          type="button"
          onClick={onOpenSettings}
          title="Настройки"
        >
          ⚙
        </button>

        <button className="voice-panel__leave" type="button" onClick={onLeave}>
          Выйти
        </button>
      </div>

      <div className="voice-panel__audios">
        {remoteStreams.map((remoteStream) => {
          const volume = remoteStream.userId
            ? remoteVolumes[remoteStream.userId] ?? 1
            : 1;

          return (
            <RemoteAudio
              key={remoteStream.id}
              stream={remoteStream.stream}
              volume={volume}
            />
          );
        })}
      </div>
    </div>
  );
}
