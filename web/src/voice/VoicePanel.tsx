import { useEffect, useRef } from "react";
import type {
  RemoteAudioElement,
  VoiceSettings,
  VoiceState,
} from "./useVoiceRoom";

type VoicePanelProps = {
  state: VoiceState;
  error: string;
  muted: boolean;
  voiceSettings: VoiceSettings;
  channelName: string;
  remoteStreams: RemoteAudioElement[];
  remoteVolumes: Record<string, number>;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleScreenShare: () => void;
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
  isScreenSharing,
  onToggleMute,
  onToggleScreenShare,
  onOpenSettings,
  onLeave,
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
    });
  }, [remoteStreams, remoteVolumes]);

  if (state === "idle") {
    return null;
  }

  const panelClassName =
    state === "error" ? "voice-panel voice-panel--error" : "voice-panel";
  const statusText =
    state === "connecting"
      ? "Подключение..."
      : state === "connected"
        ? "Голос активен"
        : "Ошибка подключения";

  return (
    <section className={panelClassName} aria-live="polite">
      <div className="voice-panel__info">
        <div className="voice-panel__title">
          {channelName || "Голосовой канал"}
        </div>
        <div className="voice-panel__subtitle">
          {statusText} · {voiceSettings.bitrateKbps} кбит/с
        </div>
        {error && <div className="voice-panel__error">{error}</div>}
      </div>

      <div className="voice-panel__actions">
        <button
          className={muted ? "voice-panel__mute muted" : "voice-panel__mute"}
          onClick={onToggleMute}
          type="button"
        >
          {muted ? "Включить микрофон" : "Выключить микрофон"}
        </button>
        <button
          className={
            isScreenSharing
              ? "voice-panel__screen active"
              : "voice-panel__screen"
          }
          disabled={state !== "connected"}
          onClick={onToggleScreenShare}
          type="button"
        >
          {isScreenSharing ? "Остановить экран" : "Показать экран"}
        </button>
        <button
          className="voice-panel__icon"
          onClick={onOpenSettings}
          title="Настройки голоса"
          type="button"
        >
          ⚙
        </button>
        <button
          className="voice-panel__leave"
          onClick={onLeave}
          type="button"
        >
          Выйти
        </button>
      </div>

      <div className="voice-panel__audios" ref={audioHostRef} />
    </section>
  );
}
