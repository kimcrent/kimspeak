import { useEffect, useRef, useState } from "react";
import type { ScreenShareElement } from "./useVoiceRoom";

type ScreenShareStageProps = {
  isLocalSharing: boolean;
  screenShares: ScreenShareElement[];
  onStopLocalShare: () => void;
};

export function ScreenShareStage({
  isLocalSharing,
  screenShares,
  onStopLocalShare,
}: ScreenShareStageProps) {
  const stageRefs = useRef(new Map<string, HTMLDivElement>());
  const [fullscreenShareId, setFullscreenShareId] = useState("");

  const requestFullscreen = async (shareId: string) => {
    const node = stageRefs.current.get(shareId);

    if (!node) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }

      await node.requestFullscreen();
    } catch {
      setFullscreenShareId(shareId);
    }
  };

  useEffect(() => {
    const activeIds = new Set(screenShares.map((share) => share.id));

    stageRefs.current.forEach((node, id) => {
      if (!activeIds.has(id)) {
        node.replaceChildren();
        stageRefs.current.delete(id);
      }
    });

    screenShares.forEach((share) => {
      const node = stageRefs.current.get(share.id);

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
      }
    };

    document.addEventListener("fullscreenchange", syncFullscreen);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
    };
  }, []);

  if (!isLocalSharing && screenShares.length === 0) {
    return null;
  }

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
        <div className="screenShareGrid">
          {screenShares.map((share) => (
            <article
              className={
                fullscreenShareId === share.id
                  ? "screenShareTile fullscreen"
                  : "screenShareTile"
              }
              key={share.id}
            >
              <div
                className="screenShareVideo"
                ref={(node) => {
                  if (node) {
                    stageRefs.current.set(share.id, node);
                  }
                }}
              />
              <div className="screenShareCaption">
                <span>{share.username || share.userId}</span>
                <button
                  onClick={() => requestFullscreen(share.id)}
                  type="button"
                >
                  Во весь экран
                </button>
              </div>
            </article>
          ))}
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
