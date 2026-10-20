import { useEffect } from "react";
import { shouldSuppressTouchPress } from "@/components/touchPressFeedback";

const TOUCH_DRAG_SLOP = 6;
const TOUCH_PRESS_FEEDBACK_MS = 180;
const PRESSABLE_SELECTOR = "button:not(:disabled), a[href]";

type ActivePress = {
  target: HTMLElement;
  startX: number;
  startY: number;
  cancelled: boolean;
};

/**
 * Add controlled touch press feedback to native buttons and links. CSS :active ends immediately on
 * release, making quick taps hard to see; briefly retain touch-pressed after pointerup and clear it
 * immediately on dragging or system cancellation. Article cards manage their own delayed press
 * feedback and paging gestures, so exclude them here.
 *
 * 为原生按钮和链接补充可控的触屏按压反馈。
 *
 * CSS :active 会在抬手时立刻失效，快速点击时几乎看不到颜色变化。这里在
 * pointerup 后短暂保留 touch-pressed；一旦识别到拖动或系统取消手势则立即清除。
 * 文章卡片有自己的延迟按压与翻页手势判定，因此不在这里重复处理。
 */
export function useTouchPressFeedback(): void {
  useEffect(() => {
    const activePresses = new Map<number, ActivePress>();
    const lingerTimers = new Map<HTMLElement, number>();
    const suppressedTargets = new Set<HTMLElement>();
    const clearSuppressedTargets = () => {
      for (const target of suppressedTargets) target.removeAttribute("data-touch-feedback-suppressed");
      suppressedTargets.clear();
    };

    const clearLinger = (target: HTMLElement) => {
      const timer = lingerTimers.get(target);
      if (timer !== undefined) window.clearTimeout(timer);
      lingerTimers.delete(target);
    };

    const clearPressed = (target: HTMLElement) => {
      clearLinger(target);
      target.classList.remove("touch-pressed");
    };

    const findPressable = (eventTarget: EventTarget | null): HTMLElement | null => {
      if (!(eventTarget instanceof Element)) return null;
      const target = eventTarget.closest<HTMLElement>(PRESSABLE_SELECTOR);
      if (!target || target.closest(".article-card") === target) return null;
      if (target.getAttribute("aria-disabled") === "true") return null;
      return target;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      // Keep suppression until the next independent press so the same touch sequence cannot show
      // native :active after collapsing.
      // 保留到下一次独立按下，避免收缩后的同一轮触摸又显示原生 :active。
      clearSuppressedTargets();
      if (event.pointerType === "mouse") return;
      if (shouldSuppressTouchPress(event.target)) {
        const target = event.target instanceof Element
          ? event.target.closest<HTMLElement>(".article-card, button, a") : null;
        if (target) {
          target.setAttribute("data-touch-feedback-suppressed", "");
          suppressedTargets.add(target);
          clearPressed(target);
          for (const child of target.querySelectorAll<HTMLElement>(".touch-pressed")) clearPressed(child);
        }
        return;
      }
      const target = findPressable(event.target);
      if (!target) return;

      clearLinger(target);
      target.classList.add("touch-pressed");
      activePresses.set(event.pointerId, {
        target,
        startX: event.clientX,
        startY: event.clientY,
        cancelled: false,
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      const press = activePresses.get(event.pointerId);
      if (!press || press.cancelled) return;
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < TOUCH_DRAG_SLOP) return;

      press.cancelled = true;
      clearPressed(press.target);
    };

    const finishPress = (event: PointerEvent) => {
      const press = activePresses.get(event.pointerId);
      if (!press) return;
      activePresses.delete(event.pointerId);

      if (event.type !== "pointerup" || press.cancelled || shouldSuppressTouchPress(press.target)) {
        clearPressed(press.target);
        return;
      }

      clearLinger(press.target);
      const timer = window.setTimeout(() => {
        press.target.classList.remove("touch-pressed");
        lingerTimers.delete(press.target);
      }, TOUCH_PRESS_FEEDBACK_MS);
      lingerTimers.set(press.target, timer);
    };

    const clearAll = () => {
      clearSuppressedTargets();
      for (const press of activePresses.values()) clearPressed(press.target);
      activePresses.clear();
      for (const target of lingerTimers.keys()) clearPressed(target);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", finishPress, true);
    document.addEventListener("pointercancel", finishPress, true);
    window.addEventListener("blur", clearAll);

    return () => {
      clearAll();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", finishPress, true);
      document.removeEventListener("pointercancel", finishPress, true);
      window.removeEventListener("blur", clearAll);
    };
  }, []);
}
