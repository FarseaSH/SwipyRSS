import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./runtime";

/**
 * Logical-pixel bounds of the external-page child WebView within the main window's client area.
 * 外链子 WebView 在主窗口客户区中的逻辑像素边界。
 */
export type ExternalWebviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Open an external article URL in a controlled in-app WebView. Both the frontend and Rust validate
 * the URL. This optional adapter uses a child WebView inside the main window.
 *
 * 在受控的应用内 WebView 中打开文章外链。
 *
 * URL 会同时在前端和 Rust 端校验；这个可选适配器使用主窗口内的子 WebView。
 */
export async function openExternalWebview(rawUrl: string, bounds?: ExternalWebviewBounds): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("只允许打开 HTTP 或 HTTPS 网页。");
  }

  if (!isTauriRuntime()) {
    throw new Error("当前环境无法调用 Tauri 原生浏览页。");
  }

  if (!bounds) throw new Error("缺少应用内浏览页的布局边界。");
  await invoke("open_external_url", { url: url.href, bounds });
}

/**
 * Update the native child WebView's position and size when the main window resizes.
 * 主窗口尺寸变化时，同步更新原生子 WebView 的位置和大小。
 */
export async function resizeExternalWebview(bounds: ExternalWebviewBounds): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("resize_external_webview", { bounds });
}

/**
 * Close the native external-page WebView while preserving the main React page and reading position.
 * 关闭原生外链子 WebView，主 React 页面和原阅读位置保持不变。
 */
export async function closeExternalWebview(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("close_external_webview");
}
