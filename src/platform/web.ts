import type { AppPlatform, ExternalArticleOpenOptions } from "./Platform";
import { getDefaultWebApiUrl, getDefaultWebUsername } from "@/services/web/FreshRssApi";
import { WebRssClient } from "@/services/web/WebRssClient";
import { registerFreshRssExtensionServiceWorker } from "@/services/web/runtimeConfig";

/**
 * Validate the scheme and open synchronously so a user click retains its popup permission.
 * 校验地址协议后同步打开页面，保留用户点击所授予的弹窗权限。
 */
async function openArticle(rawUrl: string, options?: ExternalArticleOpenOptions): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只允许打开 HTTP 或 HTTPS 网页。");
  }
  if (!options?.preferForeground) {
    window.open(url.href, "_blank", "noopener,noreferrer");
    return;
  }

  // Bootstrap a same-origin blank page synchronously. Detach its opener and suppress
  // the referrer before any external navigation; focus remains a browser preference.
  // 先创建空白页，在外部导航前断开 opener 并禁用 referrer，再尝试切到前台。
  const tab = window.open("about:blank", "_blank");
  if (!tab) return;
  try {
    tab.opener = null;
    const referrerPolicy = tab.document.createElement("meta");
    referrerPolicy.name = "referrer";
    referrerPolicy.content = "no-referrer";
    tab.document.head.appendChild(referrerPolicy);
    // A browser may reject focus without preventing the article from opening.
    try { tab.focus(); } catch { /* Best effort only. */ }
    tab.location.replace(url.href);
  } catch (error) {
    tab.close();
    throw error;
  }
}

/**
 * Keep browser services and host integration inside the Web adapter, independent of native code.
 * 将浏览器服务和宿主集成集中在 Web 适配器中，与原生代码保持独立。
 */
export const platform: AppPlatform = {
  rssClient: new WebRssClient(),
  getConnectionDefaults: () => ({
    apiUrl: getDefaultWebApiUrl(),
    username: getDefaultWebUsername(),
  }),
  isPreviewRequested: () => new URLSearchParams(window.location.search).get("preview") === "1",
  externalArticles: { kind: "external", open: openArticle },
  initialize: registerFreshRssExtensionServiceWorker,
};
