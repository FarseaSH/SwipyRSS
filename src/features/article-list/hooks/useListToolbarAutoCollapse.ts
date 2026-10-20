import { useCallback, useEffect, useRef, type RefObject } from "react";

export const LIST_TOOLBAR_IDLE_MS = 4000;

/**
 * Use one timer for the active expanded toolbar; timer and pointer state do not participate in list
 * rendering.
 * 活动的展开工具栏统一计时；计时和指针状态不参与列表渲染。
 */
export function useListToolbarAutoCollapse(
  toolbarRef: RefObject<HTMLElement | null>, enabled: boolean, paused: boolean, collapse: () => void,
) {
  const latest = useRef({ enabled, paused, collapse });
  latest.current = { enabled, paused, collapse };
  const restartRef = useRef<(() => void) | null>(null);
  const bumpActivity = useCallback(() => restartRef.current?.(), []);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    let timer = 0;
    // Record interaction while collapsed so waking can pause correctly, without updating React
    // state.
    // 收起期间仍记录交互，以便唤醒时正确暂停，但不更新 React 状态。
    let hovered = false;
    let pressed = false;
    const hasKeyboardFocus = () => document.activeElement instanceof Element
      && toolbar.contains(document.activeElement) && document.activeElement.matches(":focus-visible");
    let keyboardFocused = hasKeyboardFocus();
    let focusFrame = 0;
    const restart = () => {
      window.clearTimeout(timer);
      timer = 0;
      const state = latest.current;
      if (!state.enabled || state.paused || hovered || pressed || keyboardFocused || document.hidden) return;
      timer = window.setTimeout(() => {
        timer = 0;
        latest.current.collapse();
      }, LIST_TOOLBAR_IDLE_MS);
    };
    restartRef.current = restart;
    const enter = (event: PointerEvent) => { if (event.pointerType === "mouse") { hovered = true; restart(); } };
    const leave = (event: PointerEvent) => { if (event.pointerType === "mouse") { hovered = false; restart(); } };
    const down = (event: PointerEvent) => {
      hovered = event.pointerType === "mouse";
      pressed = true; keyboardFocused = false; restart();
    };
    const up = () => { if (pressed) { pressed = false; restart(); } };
    const focus = () => {
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => { keyboardFocused = hasKeyboardFocus(); restart(); });
    };
    const key = () => { keyboardFocused = hasKeyboardFocus(); restart(); };
    document.addEventListener("visibilitychange", restart);
    toolbar.addEventListener("pointerenter", enter);
    toolbar.addEventListener("pointerleave", leave);
    toolbar.addEventListener("pointerdown", down);
    toolbar.addEventListener("focusin", focus);
    toolbar.addEventListener("focusout", focus);
    toolbar.addEventListener("keydown", key);
    toolbar.addEventListener("click", bumpActivity, true);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    restart();
    return () => {
      restartRef.current = null;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("visibilitychange", restart);
      toolbar.removeEventListener("pointerenter", enter);
      toolbar.removeEventListener("pointerleave", leave);
      toolbar.removeEventListener("pointerdown", down);
      toolbar.removeEventListener("focusin", focus);
      toolbar.removeEventListener("focusout", focus);
      toolbar.removeEventListener("keydown", key);
      toolbar.removeEventListener("click", bumpActivity, true);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [toolbarRef, bumpActivity]);

  // Restart the full four-second delay after page changes or pauses so an old timer cannot collapse
  // the toolbar early.
  // 页面切换或暂停结束后重启完整四秒，不让旧计时器提前收起。
  useEffect(() => { bumpActivity(); }, [enabled, paused, bumpActivity]);
  return { bumpActivity };
}
