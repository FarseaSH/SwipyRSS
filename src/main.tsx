import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/app/App";
import { platform } from "@platform";
import "@platform/styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("SwipyRSS 无法启动：页面中缺少 #root 挂载节点。");
}

createRoot(rootElement).render(
  <StrictMode>
    <App platform={platform}/>
  </StrictMode>,
);

platform.initialize?.();
