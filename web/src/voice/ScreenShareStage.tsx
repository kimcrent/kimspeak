import { useEffect, useRef, useState } from "react";
import type { ScreenShareElement } from "./useVoiceRoom";

type ScreenShareStageProps = {
  isLocalSharing: boolean;
  muted: boolean;
  screenShares: ScreenShareElement[];
  onOpenSettings: () => void;
  onStopLocalShare: () => void;
  onToggleMute: () => void;
};

export function ScreenShareStage({
  isLocalSharing,
  muted,
  screenShares,
  onOpenSettings,
  onStopLocalShare,
  onToggleMute,
}: ScreenShareStageProps) {
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const videoHostRefs = useRef(new Map<string, HTMLDivElement>());
  const fullscreenHideTimerRef = useRef<number | null>(null);
  const [selectedShareId, setSelectedShareId] = useState("");
  const [fullscreenShareId, setFullscreenShareId] = useState("");
  const [isFullscreenControlsVisible, setIsFullscreenControlsVisible] =
    useState(false);

  const showFullscreenControls = () => {
    setIsFullscreenControlsVisible(true);

    if (fullscreenHideTimerRef.current) {
      window.clearTimeout(fullscreenHideTimerRef.current);
    }

    fullscreenHideTimerRef.current = window.setTimeout(() => {
      setIsFullscreenControlsVisible(false);
    }, 2400);
  };

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } finally {
      setFullscreenShareId("");
      setIsFullscreenControlsVisible(false);
    }
  };

  const requestFullscreen = async (shareId: string) => {
    const node = tileRefs.current.get(shareId);

    if (!node) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }

      await node.requestFullscreen();
      setFullscreenShareId(shareId);
      showFullscreenControls();
    } catch {
      setFullscreenShareId(shareId);
      showFullscreenControls();
    }
  };

  useEffect(() => {
    const activeIds = new Set(screenShares.map((share) => share.id));

    videoHostRefs.current.forEach((node, id) => {
      if (!activeIds.has(id)) {
        node.replaceChildren();
        videoHostRefs.current.delete(id);
        tileRefs.current.delete(id);
      }
    });

    screenShares.forEach((share) => {
      const node = videoHostRefs.current.get(share.id);

      if (!node) {
        return;
      }

      node.replaceChildren(share.element);
    });
  }, [screenShares]);

  useEffect(() => {
    const syncFullscreen = () => {
      if (!document.fullscreenElement) {
        setFullscreenShareId("");
        setIsFullscreenControlsVisible(false);
      } else {
        showFullscreenControls();
      }
    };

    document.addEventListener("fullscreenchange", syncFullscreen);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      if (fullscreenHideTimerRef.current) {
        window.clearTimeout(fullscreenHideTimerRef.current);
      }
    };
  }, []);

  if (!isLocalSharing && screenShares.length === 0) {
    return null;
  }

  const hasSelectedShare = screenShares.some(
    (share) => share.id === selectedShareId,
  );
  const activeShareId = hasSelectedShare
    ? selectedShareId
    : screenShares[0]?.id || "";
  const orderedShares = activeShareId
    ? [
        ...screenShares.filter((share) => share.id === activeShareId),
        ...screenShares.filter((share) => share.id !== activeShareId),
      ]
    : screenShares;

  return (
    <section className="screenShareStage" aria-label="Демонстрация экрана">
      <header className="screenShareStageHeader">
        <div>
          <strong>Демонстрация экрана</strong>
          <span>
            {screenShares.length > 0
              ? `${screenShares.length} активных показов`
              : "Вы показываете экран"}
          </span>
        </div>

        {isLocalSharing && (
          <button onClick={onStopLocalShare} type="button">
            Остановить показ
          </button>
        )}
      </header>

      {screenShares.length > 0 ? (
        <div
          className={
            screenShares.length === 1
              ? "screenShareGrid single"
              : "screenShareGrid multi"
          }
        >
          {orderedShares.map((share) => {
            const isSelected = share.id === activeShareId;

            return (
              <article
                className={
                  fullscreenShareId === share.id
                    ? "screenShareTile fullscreen"
                    : isSelected
                      ? "screenShareTile selected"
                      : "screenShareTile"
                }
                key={share.id}
                onClick={() => setSelectedShareId(share.id)}
                onMouseMove={() => {
                  if (fullscreenShareId === share.id) {
                    showFullscreenControls();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedShareId(share.id);
                  }
                }}
                ref={(node) => {
                  if (node) {
                    tileRefs.current.set(share.id, node);
                  }
                }}
                role="button"
                tabIndex={0}
                title="Выбрать трансляцию"
              >
                <div
                  className="screenShareVideo"
                  ref={(node) => {
                    if (node) {
                      videoHostRefs.current.set(share.id, node);
                    }
                  }}
                />
                <div className="screenShareCaption">
                  <span>{share.username || share.userId}</span>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedShareId(share.id);
                      requestFullscreen(share.id);
                    }}
                    type="button"
                  >
                    Во весь экран
                  </button>
                </div>
                {fullscreenShareId === share.id && (
                  <div
                    className={
                      isFullscreenControlsVisible
                        ? "screenFullscreenBar visible"
                        : "screenFullscreenBar"
                    }
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="screenFullscreenTitle">
                      <strong>{share.username || share.userId}</strong>
                      <span>Текущая трансляция</span>
                    </div>
                    <div className="screenFullscreenActions">
                      <button onClick={onToggleMute} type="button">
                        {muted ? "Включить микрофон" : "Выключить микрофон"}
                      </button>
                      {isLocalSharing && (
                        <button onClick={onStopLocalShare} type="button">
                          Остановить экран
                        </button>
                      )}
                      <button onClick={onOpenSettings} type="button">
                        Настройки
                      </button>
                      <button onClick={exitFullscreen} type="button">
                        Выйти из полноэкранного режима
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="screenShareLocalNotice">
          <strong>Ваш экран транслируется</strong>
          <span>Другие участники увидят его в этой области.</span>
        </div>
      )}
    </section>
  );
}
