import { useEffect, useRef } from "react";
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
            <article className="screenShareTile" key={share.id}>
              <div
                className="screenShareVideo"
                ref={(node) => {
                  if (node) {
                    stageRefs.current.set(share.id, node);
                  }
                }}
              />
              <div className="screenShareCaption">
                {share.username || share.userId}
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
