import { useSyncExternalStore } from "react";

export type HostState = {
  buildId: string;
  version: string;
  channel: "stable" | "prerelease" | "test";
  mode: "direct" | "enhanced";
  configuredMode: "auto" | "direct" | "enhanced";
  update: "idle" | "available" | "downloading" | "ready";
  builds: Array<{ buildId: string; version: string; channel: string }>;
  message: string;
};

declare global {
  interface Window {
    swipyHost?: {
      getState(): HostState | null;
      update(): Promise<void>;
      check(): Promise<void>;
      chooseBuild(id: string): Promise<void>;
      reload(): void;
      useDirect(): void;
    };
  }
}

const snapshot = () => window.swipyHost?.getState() ?? null;
const serverSnapshot = () => null;
const subscribe = (callback: () => void) => {
  window.addEventListener("swipyrss:host-state", callback);
  return () => window.removeEventListener("swipyrss:host-state", callback);
};
export const useHostState = () => useSyncExternalStore(subscribe, snapshot, serverSnapshot);
export function requestHostUpdate() {
  void window.swipyHost?.update().catch((error: unknown) => console.warn("SwipyRSS 更新失败", error));
}
