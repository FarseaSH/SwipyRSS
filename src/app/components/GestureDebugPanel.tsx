import { useEffect, useRef, useState } from "react";
import { GESTURE_DEBUG_EVENT, isGestureDebugEnabled } from "../gestureDebug";

export function GestureDebugPanel({ view, sidebarOpen }: { view: string; sidebarOpen: boolean }) {
  const [visible, setVisible] = useState(isGestureDebugEnabled);
  const [lines, setLines] = useState<string[]>([]);
  const buffer = useRef<string[]>([]);

  useEffect(() => {
    if (!visible) return;
    let start: { id: number; x: number; y: number } | null = null;
    let moves = 0;
    let lastX = 0;
    let lastY = 0;
    let frame = 0;
    const append = (line: string) => {
      buffer.current = [...buffer.current.slice(-19), line];
    };
    const publish = () => {
      // Update the debug overlay only on release or cancellation to avoid rerendering React on
      // every pointermove.
      // 松手或取消后才更新浮层，避免每个 pointermove 都触发 React 渲染。
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setLines([...buffer.current]));
    };
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-gesture-debug-panel]")) return;
      if (event.type === "pointerdown") {
        if (start) return;
        start = { id: event.pointerId, x: event.clientX, y: event.clientY };
        lastX = event.clientX;
        lastY = event.clientY;
        moves = 0;
        buffer.current = [];
        append(`开始 ${event.pointerType} · ${target?.tagName ?? "未知"}`);
        const viewport = target?.closest(".article-viewport");
        append(`列表 touch-action: ${viewport ? getComputedStyle(viewport).touchAction : "起点在列表外"}`);
        const policies: string[] = [];
        for (let node = target; node && policies.length < 8; node = node.parentElement) {
          const action = getComputedStyle(node).touchAction;
          if (action !== "auto") policies.push(`${node.tagName.toLowerCase()}: ${action}`);
        }
        append(`触摸策略: ${policies.join(" / ") || "auto"}`);
        append(`来源标签: ${Boolean(target?.closest("[data-native-horizontal-scroll]"))} · 桌面布局: ${matchMedia("(min-width: 1024px)").matches}`);
        return;
      }
      if (!start || event.pointerId !== start.id) return;
      if (event.type === "pointermove") {
        moves += 1;
        lastX = event.clientX;
        lastY = event.clientY;
        return;
      }
      // Browser cancellation events may contain zero coordinates; preserve the last movement
      // position for diagnostics.
      // 浏览器的取消事件可能携带零坐标；保留最后一次移动位置供诊断。
      const x = event.type === "pointercancel" ? lastX : event.clientX;
      const y = event.type === "pointercancel" ? lastY : event.clientY;
      append(`${event.type} · dx=${Math.round(x - start.x)} dy=${Math.round(y - start.y)} · move=${moves}${event.type === "pointercancel" ? "（末次移动）" : ""}`);
      start = null;
      publish();
    };
    const decision = (event: Event) => {
      append(`侧栏: ${String((event as CustomEvent<string>).detail)}`);
      if (!start) publish();
    };
    const types = ["pointerdown", "pointermove", "pointerup", "pointercancel"] as const;
    types.forEach(type => window.addEventListener(type, pointer, { capture: true, passive: true }));
    window.addEventListener(GESTURE_DEBUG_EVENT, decision);
    return () => {
      window.cancelAnimationFrame(frame);
      types.forEach(type => window.removeEventListener(type, pointer, true));
      window.removeEventListener(GESTURE_DEBUG_EVENT, decision);
    };
  }, [visible]);

  if (!visible) return null;
  return (
    <aside data-gesture-debug-panel className="pointer-events-none fixed left-2 right-2 top-2 z-[200] rounded-xl bg-slate-950/95 p-3 text-xs text-white shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <strong>手势诊断 · {view} · 侧栏{sidebarOpen ? "已打开" : "已关闭"}</strong>
        <div className="pointer-events-auto flex gap-3">
          <button type="button" onClick={() => { buffer.current = []; setLines([]); }}>清空</button>
          <button type="button" onClick={() => setVisible(false)}>关闭诊断</button>
        </div>
      </div>
      <p className="mt-1 opacity-70">在文章卡片中间右滑，松手后截图。刷新会清除记录。</p>
      <pre className="mt-2 max-h-[35dvh] overflow-hidden whitespace-pre-wrap break-words font-mono">{lines.length ? lines.join("\n") : "等待触摸…"}</pre>
    </aside>
  );
}
