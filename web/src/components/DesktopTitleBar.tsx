import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function DesktopTitleBar() {
  const isDesktop = isTauriRuntime();

  if (!isDesktop) {
    return null;
  }

  const currentWindow = getCurrentWindow();

  const handleStartDrag = async (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    await currentWindow.startDragging();
  };

  const handleMinimize = async () => {
    await currentWindow.minimize();
  };

  const handleToggleMaximize = async () => {
    await currentWindow.toggleMaximize();
  };

  const handleClose = async () => {
    await currentWindow.close();
  };

  return (
    <div className="desktop-titlebar">
      <div
        className="desktop-titlebar__drag"
        data-tauri-drag-region
        onMouseDown={handleStartDrag}
      >
        <div className="desktop-titlebar__logo" data-tauri-drag-region>
          <span
            className="desktop-titlebar__mark"
            data-tauri-drag-region
            aria-hidden="true"
          />
          <span data-tauri-drag-region>KIMSpeak</span>
        </div>
      </div>

      <div className="desktop-titlebar__controls">
        <button onClick={handleMinimize} title="Свернуть" type="button">
          -
        </button>
        <button
          onClick={handleToggleMaximize}
          title="Развернуть"
          type="button"
        >
          □
        </button>
        <button
          className="desktop-titlebar__close"
          onClick={handleClose}
          title="Закрыть"
          type="button"
        >
          ×
        </button>
      </div>
    </div>
  );
}
