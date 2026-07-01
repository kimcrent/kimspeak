import { invoke } from "@tauri-apps/api/core";
import type { ScreenShareSettings } from "../voice/useVoiceRoom";

export type CaptureSource = {
  id: string;
  title: string;
  type: "monitor" | "window" | "browser";
  thumbnail?: string | null;
};

export type NativeScreenResolution = "720p" | "1080p" | "1440p";

export type StartNativeScreenShareRequest = {
  livekitUrl: string;
  livekitToken: string;
  room: string;
  sourceId: string;
  sourceTitle?: string;
  resolution?: NativeScreenResolution;
} & Omit<ScreenShareSettings, "resolution" | "sourceId" | "sourceTitle">;

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isNativeScreenShareAvailable(): boolean {
  return isTauriRuntime();
}

function ensureTauriRuntime(): void {
  if (!isTauriRuntime()) {
    throw new Error("Native capture доступен только в Tauri-приложении.");
  }
}

export async function listCaptureSources(): Promise<CaptureSource[]> {
  ensureTauriRuntime();
  return invoke<CaptureSource[]>("list_capture_sources");
}

export async function startNativeScreenShare(
  request: StartNativeScreenShareRequest,
): Promise<void> {
  ensureTauriRuntime();
  await invoke("start_native_screen_share", { request });
}

export async function stopNativeScreenShare(): Promise<void> {
  ensureTauriRuntime();
  await invoke("stop_native_screen_share");
}
