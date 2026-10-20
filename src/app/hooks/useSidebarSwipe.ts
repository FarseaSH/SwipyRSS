import { useEffect, useRef, type RefObject } from "react";
import { markBlockedHorizontalWheel } from "@/components/blockedHorizontalWheel";
import { reportGestureDebug } from "../gestureDebug";

const NATIVE_HORIZONTAL_SCROLL_SELECTOR = "[data-native-horizontal-scroll]";
const DESKTOP_SIDEBAR_MEDIA_QUERY = "(min-width: 1024px)";
const SIDEBAR_WHEEL_OPEN_DISTANCE = 72;
const SIDEBAR_WHEEL_IDLE_MS = 80;
const SIDEBAR_WHEEL_TAIL_DELTA = 3;
const READER_WHEEL_REOPEN_DISTANCE = 72;
const SIDEBAR_TOUCH_CLOSE_DISTANCE = 84;
const HORIZONTAL_GESTURE_QUIET_MS = 120;

/**
 * Check whether a gesture starts in feed navigation that must retain native horizontal scrolling.
 * 判断手势是否起始于应保留原生横向滚动的来源标签区域。
 */
function isNativeHorizontalScrollTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(NATIVE_HORIZONTAL_SCROLL_SELECTOR));
}

/**
 * Manage two horizontal list gestures: swipe right to open the sidebar and left to restore the
 * recently closed reader. Navigation marked data-native-horizontal-scroll takes priority so swiping
 * its tabs cannot trigger global page actions.
 *
 * 管理列表页的两种横向手势：右滑打开侧边栏、左滑恢复刚关闭的正文。
 *
 * 带 `data-native-horizontal-scroll` 的来源导航拥有更高优先级，确保在标签
 * 列表上横滑时不会触发全局页面动作。
 */
export function useSidebarSwipe(
  mainRef: RefObject<HTMLElement | null>,
  drawerRef: RefObject<HTMLElement | null>,
  backdropRef: RefObject<HTMLButtonElement | null>,
  enabled: boolean,
  sidebarOpen: boolean,
  horizontalBlockKey: number,
  open: () => void,
  close: () => void,
  canReopenReader: boolean,
  reopenReader: () => void,
) {
  const horizontalGestureBlockedRef = useRef(false);
  const horizontalGestureQuietTimerRef = useRef(0);
  const lastHorizontalBlockKeyRef = useRef(horizontalBlockKey);
  const suppressNextClickRef = useRef(false);
  const suppressClickTimerRef = useRef(0);

  useEffect(() => {
    const suppressClick = (event: MouseEvent) => {
      if (!suppressNextClickRef.current) return;
      suppressNextClickRef.current = false;
      window.clearTimeout(suppressClickTimerRef.current);
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("click", suppressClick, true);
    return () => {
      window.clearTimeout(horizontalGestureQuietTimerRef.current);
      window.clearTimeout(suppressClickTimerRef.current);
      window.removeEventListener("click", suppressClick, true);
    };
  }, []);

  useEffect(() => {
    if (lastHorizontalBlockKeyRef.current === horizontalBlockKey) return;
    lastHorizontalBlockKeyRef.current = horizontalBlockKey;
    horizontalGestureBlockedRef.current = true;
    window.clearTimeout(horizontalGestureQuietTimerRef.current);
    horizontalGestureQuietTimerRef.current = window.setTimeout(() => {
      horizontalGestureBlockedRef.current = false;
    }, HORIZONTAL_GESTURE_QUIET_MS);
  }, [horizontalBlockKey]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main || !enabled) return;
    const armHorizontalGestureBlock = () => {
      horizontalGestureBlockedRef.current = true;
      window.clearTimeout(horizontalGestureQuietTimerRef.current);
      horizontalGestureQuietTimerRef.current = window.setTimeout(() => {
        horizontalGestureBlockedRef.current = false;
      }, HORIZONTAL_GESTURE_QUIET_MS);
    };
    const consumeBlockedHorizontalGesture = (event: WheelEvent) => {
      if (!horizontalGestureBlockedRef.current) return false;
      event.preventDefault();
      markBlockedHorizontalWheel(event);
      armHorizontalGestureBlock();
      return true;
    };
    const suppressNextClick = () => {
      suppressNextClickRef.current = true;
      window.clearTimeout(suppressClickTimerRef.current);
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 400);
    };
    // Wait until pointer movement exceeds the threshold before choosing between sidebar navigation
    // and reader restoration.
    // 指针手势在移动超过阈值后才决定交给侧边栏还是正文恢复。
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastTime = 0;
    let velocity = 0;
    let tracking = false;
    let direction: "sidebar" | "reader" | null = null;
    // Trackpad left swipes use only the restoration distance; touch and pen input retain the reader
    // preview that follows the gesture.
    // 触控板左滑只识别恢复距离；触摸与触控笔仍保留正文跟手预览。
    let forwardOffset = 0;
    let forwardLastTime = 0;
    let forwardIdleTimer = 0;
    let forwardAnimationTimer = 0;
    let forwardSettleFrame = 0;
    let forwardSettling = false;
    // Trackpad right swipes use only the trigger distance, then reuse the button's full opening
    // animation.
    // 触控板右滑只识别触发距离；达到阈值后复用按钮的完整打开动画。
    let sidebarOffset = 0;
    let sidebarLastTime = 0;
    let sidebarIdleTimer = 0;
    let sidebarTriggered = false;
    let wheelDirection: "sidebar" | "reader" | null = null;

    // Reuse the mounted but closed reader panel for the reader preview.
    // 正文预览沿用已挂载但处于关闭状态的 reader panel。
    const readerPanel = () => main.querySelector<HTMLElement>(".reader-panel");

    const clearReaderPreview = () => {
      const panel = readerPanel();
      if (!panel) return;
      panel.style.transition = "";
      panel.style.transform = "";
    };

    const sidebarAvailable = () => !window.matchMedia(DESKTOP_SIDEBAR_MEDIA_QUERY).matches;

    const settleReader = (accepted: boolean) => {
      const panel = readerPanel();
      window.clearTimeout(forwardIdleTimer);
      window.clearTimeout(forwardAnimationTimer);
      window.cancelAnimationFrame(forwardSettleFrame);
      forwardSettling = true;
      if (!panel) {
        forwardSettling = false;
        wheelDirection = null;
        if (accepted) reopenReader();
        return;
      }
      forwardSettleFrame = window.requestAnimationFrame(() => {
        forwardSettleFrame = 0;
        const duration = accepted ? 340 : 260;
        panel.style.transition = `transform ${duration}ms cubic-bezier(.22,.61,.36,1)`;
        panel.style.transform = accepted ? "translate3d(0, 0, 0)" : `translate3d(${main.clientWidth}px, 0, 0)`;
        forwardAnimationTimer = window.setTimeout(() => {
          forwardOffset = 0;
          forwardSettling = false;
          wheelDirection = null;
          if (accepted) reopenReader();
          window.requestAnimationFrame(clearReaderPreview);
        }, duration);
      });
    };

    const resetPreview = () => {
      const drawer = drawerRef.current;
      const backdrop = backdropRef.current;
      if (drawer) {
        drawer.style.transition = "";
        drawer.style.transform = "";
      }
      if (backdrop) {
        backdrop.style.transition = "";
        backdrop.style.opacity = "";
        backdrop.style.pointerEvents = "";
      }
    };

    // When the sidebar is open, a left swipe triggers its existing close action without an extra
    // drag-follow animation.
    // 侧边栏打开时，左滑只负责触发现有关闭动作，不制作额外跟手动画。
    let dismissPointerId: number | null = null;
    let dismissStartX = 0;
    let dismissStartY = 0;
    let dismissTracking = false;
    let dismissDirectionLocked = false;
    let dismissWheelDistance = 0;
    let dismissWheelLastTime = 0;
    let dismissWheelDirection: -1 | 0 | 1 = 0;
    let dismissWheelIdleTimer = 0;
    let dismissTriggered = false;

    const triggerSidebarClose = (suppressClickAfterClose: boolean) => {
      if (dismissTriggered) return;
      dismissTriggered = true;
      armHorizontalGestureBlock();
      if (suppressClickAfterClose) suppressNextClick();
      close();
    };
    const dismissPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      dismissPointerId = event.pointerId;
      dismissStartX = event.clientX;
      dismissStartY = event.clientY;
      dismissTracking = true;
      dismissDirectionLocked = false;
    };
    const dismissPointerMove = (event: PointerEvent) => {
      if (!dismissTracking || event.pointerId !== dismissPointerId) return;
      const dx = event.clientX - dismissStartX;
      const dy = event.clientY - dismissStartY;
      if (!dismissDirectionLocked && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
        if (Math.abs(dx) <= Math.abs(dy) || dx >= 0) {
          dismissTracking = false;
          return;
        }
        dismissDirectionLocked = true;
        suppressNextClick();
      }
      if (!dismissDirectionLocked) return;
      event.preventDefault();
      if (-dx >= SIDEBAR_TOUCH_CLOSE_DISTANCE) {
        dismissTracking = false;
        dismissPointerId = null;
        triggerSidebarClose(true);
      }
    };
    const dismissPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== dismissPointerId) return;
      dismissPointerId = null;
      dismissTracking = false;
      dismissDirectionLocked = false;
    };
    const dismissWheel = (event: WheelEvent) => {
      const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.1
        && Math.abs(event.deltaX) > 1;
      if (!horizontalIntent || event.deltaX === 0) return;
      if (dismissTriggered) {
        event.preventDefault();
        armHorizontalGestureBlock();
        return;
      }

      const now = performance.now();
      if (now - dismissWheelLastTime > 180) {
        dismissWheelDistance = 0;
        dismissWheelDirection = 0;
      }
      if (Math.abs(event.deltaX) <= SIDEBAR_WHEEL_TAIL_DELTA) return;
      const eventDirection = event.deltaX > 0 ? 1 : -1;
      if (!dismissWheelDirection) dismissWheelDirection = eventDirection;
      dismissWheelLastTime = now;
      window.clearTimeout(dismissWheelIdleTimer);
      dismissWheelIdleTimer = window.setTimeout(() => {
        dismissWheelDistance = 0;
        dismissWheelDirection = 0;
      }, SIDEBAR_WHEEL_IDLE_MS);
      // Do not mistake reverse momentum in the same right-swipe sequence for a new left-swipe close
      // action.
      // 同一串右滑事件的反向惯性不能被误认为新的左滑关闭动作。
      if (dismissWheelDirection !== eventDirection || dismissWheelDirection < 0) return;

      event.preventDefault();
      dismissWheelDistance += event.deltaX;
      if (dismissWheelDistance >= SIDEBAR_WHEEL_OPEN_DISTANCE) {
        triggerSidebarClose(false);
      }
    };
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      if (isNativeHorizontalScrollTarget(event.target)) {
        reportGestureDebug("忽略：来源标签保留原生横向滚动");
        return;
      }
      reportGestureDebug("收到 pointerdown，开始跟踪");
      tracking = true;
      direction = null;
      startX = lastX = event.clientX;
      startY = event.clientY;
      lastTime = performance.now();
      velocity = 0;
    };
    const move = (event: PointerEvent) => {
      if (!tracking) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!direction && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
        if (Math.abs(dx) <= Math.abs(dy)) { reportGestureDebug("停止：判定为纵向手势"); tracking = false; return; }
        if (dx > 0) {
          if (sidebarAvailable()) { direction = "sidebar"; reportGestureDebug("识别右滑，预览侧边栏"); }
          else { reportGestureDebug("停止：桌面布局不支持侧栏右滑"); tracking = false; return; }
        } else if (canReopenReader) direction = "reader";
        else { reportGestureDebug("停止：左滑且没有可恢复正文"); tracking = false; return; }
      }
      if (!direction) return;
      event.preventDefault();
      const now = performance.now();
      velocity = (event.clientX - lastX) / Math.max(1, now - lastTime);
      lastX = event.clientX;
      lastTime = now;
      if (direction === "reader") {
        forwardOffset = Math.max(0, Math.min(main.clientWidth, -dx));
        const panel = readerPanel();
        if (panel) {
          panel.style.transition = "none";
          panel.style.transform = `translate3d(${main.clientWidth - forwardOffset}px, 0, 0)`;
        }
        return;
      }
      const progress = Math.max(0, Math.min(1, dx / 284));
      const drawer = drawerRef.current;
      const backdrop = backdropRef.current;
      if (drawer) drawer.style.transform = `translateX(${(progress - 1) * 100}%)`;
      if (backdrop) {
        backdrop.style.opacity = String(progress);
        backdrop.style.pointerEvents = "auto";
      }
    };
    const up = (event: PointerEvent) => {
      if (!tracking) return;
      const dx = event.clientX - startX;
      reportGestureDebug(event.type === "pointercancel"
        ? `pointercancel · 方向=${direction ?? "未确定"}`
        : `${event.type} · 方向=${direction ?? "未确定"} · dx=${Math.round(dx)} · 速度=${velocity.toFixed(2)}`);
      if (direction === "reader") {
        settleReader(event.type === "pointerup" && (-dx > 84 || velocity < -0.55));
      } else if (direction === "sidebar" && event.type === "pointerup" && (dx > 84 || velocity > 0.55)) {
        reportGestureDebug("达到阈值，调用打开侧边栏");
        open();
        window.requestAnimationFrame(resetPreview);
      } else { reportGestureDebug("撤销预览：手势取消或未达到阈值"); resetPreview(); }
      tracking = false;
      direction = null;
    };

    const wheel = (event: WheelEvent) => {
      const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.1;
      if (!horizontalIntent || event.deltaX === 0) return;
      // The same momentum after closing the drawer must not trigger the list's left-swipe reader
      // restoration.
      // 抽屉关闭后的同一段惯性不能继续触发列表的“左滑恢复正文”。
      if (consumeBlockedHorizontalGesture(event)) return;
      // Apply momentum protection even to tiny trailing events; keep the existing thresholds for
      // independent gestures.
      // 极小尾部也需要先经过惯性保护；独立手势仍沿用原有识别阈值。
      if (Math.abs(event.deltaX) <= 1) return;
      if (isNativeHorizontalScrollTarget(event.target)) return;
      // After the sidebar triggers or while the reader snaps into place, consume remaining trackpad
      // momentum without navigating again.
      // 已触发侧边栏或正文正在吸附时，剩余触控板惯性只消费、不再导航。
      if (forwardSettling || sidebarTriggered) {
        event.preventDefault();
        return;
      }
      const now = performance.now();
      const lastEventTime = Math.max(forwardLastTime, sidebarLastTime);
      if (wheelDirection && now - lastEventTime > 180) {
        wheelDirection = null;
        forwardOffset = 0;
        sidebarOffset = 0;
      }
      const nextDirection = event.deltaX < 0 ? "sidebar" : "reader";
      // Small reverse events after direction locking are system momentum rebound and still belong
      // to the current gesture.
      // 已锁定方向后的少量反向事件属于系统惯性回弹，仍应由当前手势消费。
      if (wheelDirection && wheelDirection !== nextDirection) {
        event.preventDefault();
        return;
      }
      if (nextDirection === "sidebar" && !sidebarAvailable()) return;
      if (nextDirection === "reader" && !canReopenReader) return;

      event.preventDefault();
      if (!wheelDirection) wheelDirection = nextDirection;
      // Do not change the navigation target for reverse rebound within the same event sequence.
      // 同一事件串中的反向回弹不切换导航目标。
      if (wheelDirection !== nextDirection) return;

      if (wheelDirection === "sidebar") {
        const delta = -event.deltaX;
        // Treat low-amplitude events as trailing system momentum: consume them without accumulating
        // distance or postponing recognition.
        // 低幅事件视为系统惯性尾部：消费但不累计，也不延后本次识别。
        if (delta <= SIDEBAR_WHEEL_TAIL_DELTA) return;
        sidebarLastTime = now;
        sidebarOffset = Math.max(0, Math.min(284, sidebarOffset + delta));
        window.clearTimeout(sidebarIdleTimer);
        if (sidebarOffset >= SIDEBAR_WHEEL_OPEN_DISTANCE) {
          sidebarTriggered = true;
          open();
          return;
        }
        sidebarIdleTimer = window.setTimeout(() => {
          sidebarOffset = 0;
          wheelDirection = null;
        }, SIDEBAR_WHEEL_IDLE_MS);
        return;
      }

      if (event.deltaX <= SIDEBAR_WHEEL_TAIL_DELTA) return;
      forwardLastTime = now;
      forwardOffset += event.deltaX;
      window.clearTimeout(forwardIdleTimer);
      if (forwardOffset >= READER_WHEEL_REOPEN_DISTANCE) {
        forwardOffset = 0;
        wheelDirection = null;
        reopenReader();
        return;
      }
      forwardIdleTimer = window.setTimeout(() => {
        forwardOffset = 0;
        wheelDirection = null;
      }, SIDEBAR_WHEEL_IDLE_MS);
    };

    if (sidebarOpen) {
      const drawer = drawerRef.current;
      if (!drawer || !sidebarAvailable()) return;
      drawer.addEventListener("pointerdown", dismissPointerDown);
      window.addEventListener("pointermove", dismissPointerMove, { passive: false });
      window.addEventListener("pointerup", dismissPointerEnd);
      window.addEventListener("pointercancel", dismissPointerEnd);
      drawer.addEventListener("wheel", dismissWheel, { passive: false });
      return () => {
        window.clearTimeout(dismissWheelIdleTimer);
        drawer.removeEventListener("pointerdown", dismissPointerDown);
        window.removeEventListener("pointermove", dismissPointerMove);
        window.removeEventListener("pointerup", dismissPointerEnd);
        window.removeEventListener("pointercancel", dismissPointerEnd);
        drawer.removeEventListener("wheel", dismissWheel);
      };
    }

    main.addEventListener("pointerdown", down);
    main.addEventListener("pointermove", move, { passive: false });
    main.addEventListener("pointerup", up);
    main.addEventListener("pointercancel", up);
    main.addEventListener("wheel", wheel, { passive: false });
    return () => {
      window.clearTimeout(forwardIdleTimer);
      window.clearTimeout(forwardAnimationTimer);
      window.clearTimeout(sidebarIdleTimer);
      window.cancelAnimationFrame(forwardSettleFrame);
      resetPreview();
      clearReaderPreview();
      main.removeEventListener("pointerdown", down);
      main.removeEventListener("pointermove", move);
      main.removeEventListener("pointerup", up);
      main.removeEventListener("pointercancel", up);
      main.removeEventListener("wheel", wheel);
    };
  }, [backdropRef, canReopenReader, close, drawerRef, enabled, mainRef, open, reopenReader, sidebarOpen]);
}
