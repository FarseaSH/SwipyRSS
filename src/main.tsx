import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ArticleTimeProvider } from "@/lib/time/ArticleTimeProvider";
import App from "@/app/App";
import { platform } from "@platform";
import "@platform/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("SwipyRSS 无法启动：页面中缺少 #root 挂载节点。");
}

createRoot(rootElement).render(
  <StrictMode>
    <ArticleTimeProvider>
      <HostHandshake />
      <App platform={platform}/>
    </ArticleTimeProvider>
  </StrictMode>,
);

platform.initialize?.();

// The host checks React mounting independently of RSS/API availability.
// 宿主只确认 React 已挂载，不把 RSS 网络错误当成程序启动失败。
function HostHandshake() {
  useEffect(() => {
    const buildId = import.meta.env.VITE_SWIPY_BUILD_ID || import.meta.env.VITE_VALIDATION_BUILD_ID;
    if (buildId) window.dispatchEvent(new CustomEvent("swipyrss:ready", { detail: { buildId } }));
  }, []);
  return null;
}
