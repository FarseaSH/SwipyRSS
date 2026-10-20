import { useEffect, useRef, type RefObject } from "react";

type Options = {
  toolbarRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  expanded: boolean;
  confirmationOpen: boolean;
  submitting: boolean;
  collapse: () => void;
  closeConfirmation: () => void;
};

/**
 * Apply list-specific click priorities; observe gestures without blocking pointerdown, pointermove,
 * or pointerup.
 * 列表专属点击优先级；只观察手势，不阻断 pointerdown/move/up。
 */
export function useListToolbarDismiss(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!options.enabled) return;
    let pointer: { id: number; x: number; y: number; body: boolean; direction: "x" | "y" | null } | null = null;
    let dragged = false;
    const consume = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const click = (event: MouseEvent) => {
      const state = latest.current;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Prevent a recognized gesture's synthetic click from passing through after state changes.
      // 不让已识别手势生成的合成 click 在状态变化之后穿透。
      if (dragged && event.detail > 0) { consume(event); return; }
      if (state.confirmationOpen) {
        if (state.popoverRef.current?.contains(target)) return;
        consume(event);
        if (!state.submitting) state.closeConfirmation();
        return;
      }
      if (state.expanded && target.closest("[data-list-toolbar-body]")
        && !state.toolbarRef.current?.contains(target)) {
        consume(event);
        state.collapse();
      }
    };
    const vertical = () => {
      const state = latest.current;
      if (state.submitting) return;
      if (state.confirmationOpen) state.closeConfirmation();
      if (state.expanded) state.collapse();
    };
    const down = (event: PointerEvent) => {
      dragged = false;
      pointer = {
        id: event.pointerId, x: event.clientX, y: event.clientY,
        body: event.target instanceof Element && Boolean(event.target.closest("[data-list-toolbar-body]")),
        direction: null,
      };
    };
    const move = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = Math.abs(event.clientX - pointer.x);
      const dy = Math.abs(event.clientY - pointer.y);
      if (Math.max(dx, dy) < 12) return;
      dragged = true;
      pointer.direction ??= dx > dy ? "x" : "y";
      if (pointer.body && pointer.direction === "y") vertical();
    };
    const up = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = null;
    };
    const wheel = (event: WheelEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-list-toolbar-body]")) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && Math.abs(event.deltaY) >= 4) vertical();
    };
    document.addEventListener("click", click, true);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, { capture: true, passive: true });
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("wheel", wheel, { capture: true, passive: true });
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("wheel", wheel, true);
    };
  }, [options.enabled]);
}
