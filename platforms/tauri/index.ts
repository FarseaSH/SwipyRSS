import type { AppPlatform } from "@/platform/Platform";
import { TauriRssClient } from "./TauriRssClient";
import { ExternalBrowserPage } from "./ExternalBrowserPage";

/**
 * Supply native services and UI from this optional adapter; shared pages remain platform-neutral.
 * 通过这个可选适配器提供原生服务和界面，让共享页面保持平台无关。
 */
export const platform: AppPlatform = {
  rssClient: new TauriRssClient(),
  getConnectionDefaults: () => ({ apiUrl: "", username: "" }),
  isPreviewRequested: () => false,
  externalArticles: { kind: "embedded", View: ExternalBrowserPage },
};
