import { RemoteAudio } from "./RemoteAudio";
import type { VoiceSettings } from "./useVoiceRoom";

import { useState } from "react";

type VoicePanelProps = {
  state: "idle" | "connecting" | "connected" | "error";
  error: string | null;
  muted: boolean;
  channelName: string | null;
  remoteStreams: MediaStream[];
  settings: VoiceSettings;
  inputDevices: MediaDeviceInfo[];
  inputLevel: number;
  onToggleMute: () => void;
  onLeave: () => void;
  onRefreshDevices: () => void;
  onSettingsChange: (settings: VoiceSettings) => void;
};

export function VoicePanel({
  state,
  error,
  muted,
  channelName,
  remoteStreams,
  settings,
  inputDevices,
  inputLevel,
  onToggleMute,
  onLeave,
  onRefreshDevices,
  onSettingsChange,
}: VoicePanelProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  if (state === "idle" && !channelName) {
    return null;
  }

  const setSetting = <Key extends keyof VoiceSettings>(
    key: Key,
    value: VoiceSettings[Key],
  ) => {
    onSettingsChange({
      ...settings,
      [key]: value,
    });
  };

  return (
    <>
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

        <div className="voice-panel__meter" aria-hidden="true">
          <span style={{ width: `${Math.round(inputLevel * 100)}%` }} />
        </div>

        <div className="voice-panel__actions">
          <button type="button" onClick={onToggleMute}>
            {muted ? "Включить микрофон" : "Выключить микрофон"}
          </button>

          <button
            type="button"
            onClick={() => {
              onRefreshDevices();
              setIsSettingsOpen(true);
            }}
          >
            Настройки
          </button>

          <button type="button" onClick={onLeave}>
            Выйти
          </button>
        </div>

        <div className="voice-panel__audios">
          {remoteStreams.map((stream) => (
            <RemoteAudio
              key={stream.id}
              stream={stream}
              volume={settings.outputVolume}
            />
          ))}
        </div>
      </div>

      {isSettingsOpen && (
        <div className="voice-settings-backdrop">
          <section className="voice-settings" aria-modal="true" role="dialog">
            <div className="voice-settings__header">
              <div>
                <h2>Настройки голоса</h2>
                <p>Микрофон, шумоподавление и уровни WebRTC.</p>
              </div>
              <button
                className="voice-settings__close"
                onClick={() => setIsSettingsOpen(false)}
                type="button"
              >
                x
              </button>
            </div>

            <label className="voice-settings__field">
              <span>Микрофон</span>
              <select
                value={settings.inputDeviceId}
                onChange={(event) =>
                  setSetting("inputDeviceId", event.target.value)
                }
              >
                <option value="">Системный по умолчанию</option>
                {inputDevices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Микрофон ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>

            <div className="voice-settings__level">
              <div>
                <span>Уровень микрофона</span>
                <b>{Math.round(inputLevel * 100)}%</b>
              </div>
              <span style={{ width: `${Math.round(inputLevel * 100)}%` }} />
            </div>

            <label className="voice-settings__field">
              <span>Громкость микрофона</span>
              <input
                type="range"
                min="0"
                max="200"
                step="5"
                value={Math.round(settings.inputGain * 100)}
                onChange={(event) =>
                  setSetting("inputGain", Number(event.target.value) / 100)
                }
              />
              <small>{Math.round(settings.inputGain * 100)}%</small>
            </label>

            <label className="voice-settings__field">
              <span>Громкость собеседников</span>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={Math.round(settings.outputVolume * 100)}
                onChange={(event) =>
                  setSetting("outputVolume", Number(event.target.value) / 100)
                }
              />
              <small>{Math.round(settings.outputVolume * 100)}%</small>
            </label>

            <div className="voice-settings__toggles">
              <label>
                <input
                  checked={settings.noiseSuppression}
                  onChange={(event) =>
                    setSetting("noiseSuppression", event.target.checked)
                  }
                  type="checkbox"
                />
                Шумоподавление
              </label>
              <label>
                <input
                  checked={settings.echoCancellation}
                  onChange={(event) =>
                    setSetting("echoCancellation", event.target.checked)
                  }
                  type="checkbox"
                />
                Подавление эха
              </label>
              <label>
                <input
                  checked={settings.autoGainControl}
                  onChange={(event) =>
                    setSetting("autoGainControl", event.target.checked)
                  }
                  type="checkbox"
                />
                Автоусиление
              </label>
              <label>
                <input
                  checked={settings.highPassFilter}
                  onChange={(event) =>
                    setSetting("highPassFilter", event.target.checked)
                  }
                  type="checkbox"
                />
                Срез низких частот
              </label>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
