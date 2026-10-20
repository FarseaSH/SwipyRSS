export type FreshRssExtensionRuntimeConfig = {
  apiBase: string;
  username: string;
  serviceWorkerUrl: string;
  serviceWorkerScope: string;
  extensionVersion: string;
};

let cachedConfig: FreshRssExtensionRuntimeConfig | null | undefined;

/**
 * Read same-origin runtime configuration written to the mount node by the FreshRSS Extension page.
 * 读取 FreshRSS Extension 页面写入挂载节点的同源运行时配置。
 */
export function getFreshRssExtensionRuntimeConfig(): FreshRssExtensionRuntimeConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const root = document.getElementById("root");
  if (root?.dataset.runtime !== "freshrss-extension") {
    cachedConfig = null;
    return cachedConfig;
  }

  const { apiBase, username, serviceWorkerUrl, serviceWorkerScope, extensionVersion } = root.dataset;
  if (!apiBase || !serviceWorkerUrl || !serviceWorkerScope || !extensionVersion) {
    console.warn("SwipyRSS：FreshRSS Extension 运行时配置不完整，已停用扩展专用配置。");
    cachedConfig = null;
    return cachedConfig;
  }

  cachedConfig = {
    apiBase,
    username: username ?? "",
    serviceWorkerUrl,
    serviceWorkerScope,
    extensionVersion,
  };
  return cachedConfig;
}

/**
 * Register the FreshRSS Extension Service Worker only in a secure context.
 * FreshRSS Extension 的 Service Worker 只在安全上下文中注册。
 */
export function registerFreshRssExtensionServiceWorker(): void {
  const config = getFreshRssExtensionRuntimeConfig();
  if (!config || !("serviceWorker" in navigator) || !window.isSecureContext) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(config.serviceWorkerUrl, {
      scope: config.serviceWorkerScope,
      updateViaCache: "none",
    }).catch((error: unknown) => {
      console.warn("SwipyRSS：FreshRSS Extension Service Worker 注册失败。", error);
    });
  }, { once: true });
}
