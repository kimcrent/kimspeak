import { useMemo, useState } from "react";
import type {
  ScreenShareSettings,
  ScreenShareSourceType,
} from "./useVoiceRoom";

type ScreenSharePickerProps = {
  onClose: () => void;
  onStart: (settings: ScreenShareSettings) => void;
};

const SOURCE_TABS: Array<{
  id: ScreenShareSourceType;
  label: string;
  description: string;
}> = [
  {
    id: "application",
    label: "Приложения",
    description: "Окна программ",
  },
  {
    id: "screen",
    label: "Весь экран",
    description: "Мониторы",
  },
  {
    id: "device",
    label: "Устройства",
    description: "Вкладки и источники",
  },
];

const RESOLUTIONS: ScreenShareSettings["resolution"][] = [
  360,
  480,
  720,
  1080,
  1440,
  "source",
];
const FRAME_RATES: ScreenShareSettings["frameRate"][] = [5, 30, 60];
const AUDIO_BITRATES: ScreenShareSettings["audioBitrateKbps"][] = [
  64,
  96,
  128,
  192,
  256,
  320,
];

function getResolutionLabel(value: ScreenShareSettings["resolution"]) {
  return value === "source" ? "Источник" : String(value);
}

function getSourcePreviewTitle(sourceType: ScreenShareSourceType) {
  if (sourceType === "application") {
    return "Окно приложения";
  }

  if (sourceType === "screen") {
    return "Весь экран";
  }

  return "Устройство";
}

export function ScreenSharePicker({
  onClose,
  onStart,
}: ScreenSharePickerProps) {
  const [settings, setSettings] = useState<ScreenShareSettings>({
    sourceType: "application",
    captureAudio: true,
    quality: "hd",
    resolution: 1080,
    frameRate: 30,
    bitrateKbps: 8000,
    audioBitrateKbps: 128,
    viewerLimit: 0,
    privacy: "public",
  });

  const readyPresetLabel = useMemo(() => {
    const resolution = getResolutionLabel(settings.resolution);
    return `${resolution}p · ${settings.frameRate}fps`;
  }, [settings.frameRate, settings.resolution]);

  const setPatch = (patch: Partial<ScreenShareSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  };

  return (
    <div
      className="screenPickerBackdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="screenPicker"
        aria-label="Выбор источника трансляции"
        aria-modal="true"
        role="dialog"
      >
        <header className="screenPickerTabs">
          {SOURCE_TABS.map((tab) => (
            <button
              className={
                settings.sourceType === tab.id
                  ? "screenPickerTab active"
                  : "screenPickerTab"
              }
              key={tab.id}
              onClick={() => setPatch({ sourceType: tab.id })}
              type="button"
            >
              <span>{tab.label}</span>
              <small>{tab.description}</small>
            </button>
          ))}
        </header>

        <div className="screenPickerBody">
          <div className="screenPickerSources">
            <button className="screenSourceCard selected" type="button">
              <span className="screenSourcePreview">
                <b>{getSourcePreviewTitle(settings.sourceType)}</b>
                <small>{readyPresetLabel}</small>
              </span>
              <strong>{getSourcePreviewTitle(settings.sourceType)}</strong>
              <small>
                После нажатия старта система подтвердит конкретный источник
                захвата.
              </small>
            </button>

            <button className="screenSourceCard" type="button">
              <span className="screenSourcePreview secondary">
                <b>Предпросмотр</b>
                <small>Будет доступен после нативного захвата</small>
              </span>
              <strong>Последний выбранный источник</strong>
              <small>Можно подключить через desktop backend.</small>
            </button>
          </div>

          <aside className="screenPickerSettings">
            <section>
              <h3>Основные настройки</h3>
              <div className="screenSettingRow">
                <span>Готовая конфигурация</span>
                <div className="segmentedControl">
                  {RESOLUTIONS.map((resolution) => (
                    <button
                      className={
                        settings.resolution === resolution ? "active" : ""
                      }
                      key={resolution}
                      onClick={() => setPatch({ resolution })}
                      type="button"
                    >
                      {getResolutionLabel(resolution)}
                    </button>
                  ))}
                  <button
                    className={settings.quality === "hd" ? "active" : ""}
                    onClick={() => setPatch({ quality: "hd" })}
                    type="button"
                  >
                    HD
                  </button>
                </div>
              </div>

              <label className="screenSettingRow">
                <span>Захват звука</span>
                <input
                  checked={settings.captureAudio}
                  onChange={(event) =>
                    setPatch({ captureAudio: event.target.checked })
                  }
                  type="checkbox"
                />
              </label>

              <div className="screenSettingRow">
                <span>Конфиденциальность</span>
                <div className="segmentedControl">
                  {(["public", "contacts", "private"] as const).map(
                    (privacy) => (
                      <button
                        className={settings.privacy === privacy ? "active" : ""}
                        key={privacy}
                        onClick={() => setPatch({ privacy })}
                        type="button"
                      >
                        {privacy === "public"
                          ? "Публичный"
                          : privacy === "contacts"
                            ? "Контакты"
                            : "Закрытая"}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </section>

            <section>
              <h3>Расширенные настройки</h3>
              <div className="screenSettingRow">
                <span>Разрешение</span>
                <div className="segmentedControl">
                  {RESOLUTIONS.map((resolution) => (
                    <button
                      className={
                        settings.resolution === resolution ? "active" : ""
                      }
                      key={resolution}
                      onClick={() => setPatch({ resolution })}
                      type="button"
                    >
                      {getResolutionLabel(resolution)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="screenSettingRow">
                <span>Частота кадров</span>
                <div className="segmentedControl compact">
                  {FRAME_RATES.map((frameRate) => (
                    <button
                      className={settings.frameRate === frameRate ? "active" : ""}
                      key={frameRate}
                      onClick={() => setPatch({ frameRate })}
                      type="button"
                    >
                      {frameRate}
                    </button>
                  ))}
                </div>
              </div>

              <div className="screenSettingRow">
                <span>Битрейт</span>
                <div className="stepperControl">
                  <button
                    onClick={() =>
                      setPatch({
                        bitrateKbps: Math.max(1000, settings.bitrateKbps - 500),
                      })
                    }
                    type="button"
                  >
                    −
                  </button>
                  <b>{settings.bitrateKbps} Kbps</b>
                  <button
                    onClick={() =>
                      setPatch({
                        bitrateKbps: Math.min(20000, settings.bitrateKbps + 500),
                      })
                    }
                    type="button"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="screenSettingRow">
                <span>Битрейт аудио [Kbps]</span>
                <div className="segmentedControl">
                  {AUDIO_BITRATES.map((bitrate) => (
                    <button
                      className={
                        settings.audioBitrateKbps === bitrate ? "active" : ""
                      }
                      key={bitrate}
                      onClick={() => setPatch({ audioBitrateKbps: bitrate })}
                      type="button"
                    >
                      {bitrate}
                    </button>
                  ))}
                </div>
              </div>

              <div className="screenSettingRow">
                <span>Лимит зрителей</span>
                <div className="stepperControl">
                  <button
                    onClick={() =>
                      setPatch({
                        viewerLimit: Math.max(0, settings.viewerLimit - 1),
                      })
                    }
                    type="button"
                  >
                    −
                  </button>
                  <b>{settings.viewerLimit || "∞"}</b>
                  <button
                    onClick={() =>
                      setPatch({ viewerLimit: settings.viewerLimit + 1 })
                    }
                    type="button"
                  >
                    +
                  </button>
                </div>
              </div>
            </section>
          </aside>
        </div>

        <footer className="screenPickerFooter">
          <button className="screenPickerBack" onClick={onClose} type="button">
            Назад
          </button>
          <button
            className="screenPickerStart"
            onClick={() => onStart(settings)}
            type="button"
          >
            Начать прямой эфир
          </button>
        </footer>
      </section>
    </div>
  );
}
