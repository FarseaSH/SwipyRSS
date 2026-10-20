import { ChevronLeft, Globe2, Share2 } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  closeExternalWebview,
  openExternalWebview,
  resizeExternalWebview,
  type ExternalWebviewBounds,
} from "./externalWebview";
import type { ExternalArticleViewProps } from "@/platform/Platform";

// The native child WebView always overlays React; reserve the full browser-bar separator area.
// 原生子 WebView 始终盖在 React 图层之上，留出完整的浏览器栏分隔区。
const EXTERNAL_WEBVIEW_TOP_GUARD = 8;

/**
 * Round the DOM placeholder bounds inward and convert them to logical pixels for the Tauri child
 * WebView.
 * 把 DOM 占位区向内取整后转成 Tauri 子 WebView 使用的逻辑像素边界。
 */
function readHostBounds(host: HTMLElement): ExternalWebviewBounds {
  const rect = host.getBoundingClientRect();
  const x = Math.ceil(rect.left);
  const y = Math.ceil(rect.top) + EXTERNAL_WEBVIEW_TOP_GUARD;
  const right = Math.floor(rect.right);
  const bottom = Math.floor(rect.bottom);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

/**
 * Provide the external-page browser shell inside the main window. React renders only the trusted
 * back bar and layout placeholder; Rust creates a native child WebView for third-party pages,
 * keeping them outside the main DOM and without application capabilities.
 *
 * 主窗口内的外链浏览页壳。
 *
 * React 只渲染可信的顶部返回栏和布局占位区；第三方网页由 Rust
 * 创建的原生子 WebView 承载，不进入主应用 DOM，也不获得应用 capability。
 */
export function ExternalBrowserPage({ url, onClose, onError, onToast }: ExternalArticleViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const openedRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const domain = useMemo(() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }, [url]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let openFrame = 0;
    let resizeFrame = 0;

    /**
     * If a native operation fails, first try cleaning up the partially created child WebView, then
     * return the app to the reader.
     * 原生操作失败时先尝试清理半创建的子 WebView，再让应用退回正文。
     */
    const reportError = (error: unknown) => {
      if (disposed) return;
      void closeExternalWebview().finally(() => onError(error));
    };

    /**
     * Coalesce frequent ResizeObserver callbacks into animation frames to avoid excessive IPC
     * calls.
     * 用动画帧合并 ResizeObserver 的密集回调，避免频繁跨越 IPC。
     */
    const scheduleResize = () => {
      if (!openedRef.current || resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        if (!disposed) void resizeExternalWebview(readHostBounds(host)).catch(reportError);
      });
    };

    const observer = new ResizeObserver(scheduleResize);
    observer.observe(host);
    window.addEventListener("resize", scheduleResize);
    window.visualViewport?.addEventListener("resize", scheduleResize);

    // Use requestAnimationFrame to let CSS layout settle and avoid duplicate creation during React
    // StrictMode's initial probe.
    // requestAnimationFrame 让 CSS 先完成布局；也可避免 React StrictMode 首轮探测重复创建。
    openFrame = window.requestAnimationFrame(() => {
      void openExternalWebview(url, readHostBounds(host))
        .then(() => {
          if (disposed) {
            void closeExternalWebview();
            return;
          }
          openedRef.current = true;
          scheduleResize();
        })
        .catch(reportError);
    });

    return () => {
      disposed = true;
      openedRef.current = false;
      observer.disconnect();
      window.removeEventListener("resize", scheduleResize);
      window.visualViewport?.removeEventListener("resize", scheduleResize);
      window.cancelAnimationFrame(openFrame);
      window.cancelAnimationFrame(resizeFrame);
    };
  }, [onError, url]);

  /**
   * Remove the native child WebView before revealing the reader preserved underneath.
   * 先移除原生子 WebView，再露出保持在背后的正文页。
   */
  const close = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await closeExternalWebview();
      onClose();
    } catch (error) {
      setClosing(false);
      onError(error);
    }
  };

  /**
   * Prefer the system share sheet; copy the original article link when sharing is unsupported.
   * 优先使用系统分享面板，不支持时复制原文链接。
   */
  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: domain, url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        onToast("原文链接已复制");
      } else {
        onToast("当前环境不支持分享");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        onToast("分享失败，请稍后重试");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <section className="external-browser-page" aria-label="应用内原文浏览页">
      <header className="external-browser-header">
        <button type="button" className="reader-back-button external-browser-back-button" onClick={() => void close()} disabled={closing} aria-label="关闭原文并返回正文">
          <ChevronLeft size={24}/>
        </button>
        <div className="external-browser-origin" title={url}>
          <Globe2 size={16} aria-hidden="true"/>
          <span>{domain}</span>
        </div>
        <button type="button" className="external-browser-share-button" onClick={() => void share()} disabled={sharing} aria-label="分享原文" title="分享原文">
          <Share2 size={20}/>
        </button>
      </header>
      <div ref={hostRef} className="external-browser-host" aria-label={`正在访问 ${domain}`}/>
    </section>
  );
}
