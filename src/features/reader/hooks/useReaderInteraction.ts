import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const MAX_MARKER_HEIGHT_RATIO = 0.36;
const READER_SCROLL_RATIO = 0.78;
const READER_SCROLL_DURATION_MS = 520;
const CONTINUITY_MARKER_DELAY_MS = 220;
const POSITION_TOP_OFFSET = 80;
const POSITION_MARKER_HOLD_MS = 350;
const TOUCH_DOUBLE_TAP_DELAY_MS = 300;
const TOUCH_DOUBLE_TAP_DISTANCE = 24;
const POINTER_AXIS_SLOP = 6;
const TRACKPAD_NAVIGATION_DISTANCE = 72;
const TRACKPAD_GESTURE_IDLE_MS = 80;
const TRACKPAD_TAIL_DELTA = 3;

/**
 * Content links, controls, and code blocks retain their own keyboard and double-click behavior.
 * 正文链接、控件和代码块保留自己的键盘及双击操作。
 */
export function isInteractiveReaderTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "a, button, input, textarea, select, option, [contenteditable]:not([contenteditable='false']), [role='button'], [data-reader-horizontal-scroll]",
  ));
}

/**
 * Clear the word selection created by a double-click only after confirming a positioning gesture;
 * preserve long-press text selection.
 * 仅在定位手势确认后清除双击产生的单词选区，不影响长按选择文字。
 */
function clearTransientTextSelection(): void {
  window.getSelection()?.removeAllRanges();
}

/**
 * Coordinate native vertical content scrolling, keyboard paging, double-click positioning, and
 * swipe-right return. Leave vertical wheel, trackpad, and touch scrolling to the WebView; handle
 * only explicit keyboard paging, desktop/mobile double taps, and horizontal touch or trackpad
 * return gestures.
 *
 * 协调正文原生纵向滚动、键盘辅助翻屏、双击定位和右滑返回。
 *
 * 纵向滚轮、触控板和触摸拖动交还给 WebView；Hook 只接管明确的键盘
 * 翻屏、桌面/移动端双击，以及触摸或触控板的横向返回手势。
 */
export function useReaderInteraction(
  viewportRef: RefObject<HTMLDivElement | null>,
  continuityMarkerRef: RefObject<HTMLDivElement | null>,
  positionMarkerRef: RefObject<HTMLDivElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  onSwipeRight?: () => void,
  onKeyboardBack?: () => void,
  keyboardEnabled = true,
  sideToolbar = false,
) {
  const [toolbarDimmed, setToolbarDimmed] = useState(sideToolbar);
  const animationRef = useRef<number | null>(null);
  const continuityMarkerTimerRef = useRef<number | null>(null);
  const positionMarkerTimerRef = useRef<number | null>(null);
  const assistDelayTimerRef = useRef<number | null>(null);

  const setDimmed = useCallback((value: boolean) => {
    setToolbarDimmed(value);
  }, []);

  /**
   * Hide the range anchor used by keyboard paging downward.
   * 隐藏键盘向下翻屏使用的区间锚点。
   */
  const hideContinuityMarker = useCallback((delay = 0) => {
    window.clearTimeout(continuityMarkerTimerRef.current ?? undefined);
    if (delay <= 0) {
      continuityMarkerRef.current?.classList.remove("visible");
      return;
    }
    continuityMarkerTimerRef.current = window.setTimeout(
      () => continuityMarkerRef.current?.classList.remove("visible"),
      delay,
    );
  }, [continuityMarkerRef]);

  /**
   * Hide the double-tap positioning line; CSS performs the 900ms fade-out.
   * 隐藏双击定位线；CSS 负责执行 900ms 淡出。
   */
  const hidePositionMarker = useCallback((delay = 0) => {
    window.clearTimeout(positionMarkerTimerRef.current ?? undefined);
    if (delay <= 0) {
      positionMarkerRef.current?.classList.remove("visible");
      return;
    }
    positionMarkerTimerRef.current = window.setTimeout(
      () => positionMarkerRef.current?.classList.remove("visible"),
      delay,
    );
  }, [positionMarkerRef]);

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
  }, []);

  /**
   * Stop any ongoing assistive animations and markers when waking the toolbar.
   * 唤醒工具栏时同步停止仍在执行的辅助动画与标记。
   */
  const wakeToolbar = useCallback(() => {
    window.clearTimeout(assistDelayTimerRef.current ?? undefined);
    assistDelayTimerRef.current = null;
    stopAnimation();
    hideContinuityMarker();
    hidePositionMarker();
    setDimmed(false);
  }, [hideContinuityMarker, hidePositionMarker, setDimmed, stopAnimation]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // Touch pointers handle only horizontal return and mobile double taps; the WebView handles
    // vertical movement natively.
    // 触摸指针只负责横向返回和移动端双击识别；纵向移动由 WebView 原生处理。
    let pointerId: number | null = null;
    let pointerStartX = 0;
    let pointerStartY = 0;
    let pointerStartScrollTop = 0;
    let pointerLastX = 0;
    let pointerLastTime = 0;
    let horizontalVelocity = 0;
    let pointerAxis: "horizontal" | "code" | "native" | null = null;
    let pointerCodeBlock: HTMLElement | null = null;
    let pointerCodeBlockStartScrollLeft = 0;
    let touchTapEligible = false;
    let lastTouchTapTime = 0;
    let lastTouchTapX = 0;
    let lastTouchTapY = 0;
    let lastTouchTapScrollTop = 0;
    let lastTouchJumpTime = 0;
    let lastScrollTop = viewport.scrollTop;

    // Trackpad gestures use only navigation distance; touch and pen input retain drag-follow
    // movement.
    // 触控板只识别导航距离；手机与触控笔仍保留跟手拖动。
    let swipeAnimationTimer = 0;
    let swipeSettleFrame = 0;
    let trackpadIdleTimer = 0;
    let trackpadOffset = 0;
    let trackpadLastTime = 0;
    let trackpadDirection: -1 | 0 | 1 = 0;
    let horizontalSettling = false;

    // Part 1: shared vertical animation and the two reading markers.
    // 第一部分：统一的纵向动画和两种阅读标记。
    const maxScroll = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight);

    /**
     * Cancel pending keyboard paging so an old timer cannot restart animation after user input.
     * 取消等待中的键盘翻屏，防止用户输入后旧定时器再次启动动画。
     */
    const clearAssistDelay = () => {
      window.clearTimeout(assistDelayTimerRef.current ?? undefined);
      assistDelayTimerRef.current = null;
    };

    /**
     * Move to the requested scrollTop using the reader's existing easing curve.
     * 使用正文既有缓动曲线移动到指定 scrollTop。
     */
    const animateTo = (target: number, onComplete?: () => void) => {
      stopAnimation();
      const from = viewport.scrollTop;
      const distance = target - from;
      if (Math.abs(distance) < 0.5) {
        viewport.scrollTop = target;
        onComplete?.();
        return;
      }

      const started = performance.now();
      const frame = (now: number) => {
        const progress = Math.min(1, (now - started) / READER_SCROLL_DURATION_MS);
        const eased = progress < 0.5
          ? 4 * progress ** 3
          : 1 - ((-2 * progress + 2) ** 3) / 2;
        viewport.scrollTop = from + distance * eased;
        if (progress < 1) {
          animationRef.current = requestAnimationFrame(frame);
          return;
        }
        animationRef.current = null;
        onComplete?.();
      };
      animationRef.current = requestAnimationFrame(frame);
    };

    /**
     * Show the reading overlap region after keyboard paging downward.
     * 展示键盘向下翻屏后的阅读重叠区间。
     */
    const showContinuityMarker = (top: number, bottom: number) => {
      const marker = continuityMarkerRef.current;
      if (!marker || bottom <= top + 4) return;
      marker.style.top = `${top}px`;
      marker.style.height = `${bottom - top}px`;
      marker.classList.add("visible");
    };

    /**
     * Use four keyboard keys to trigger assisted paging by 78% of the viewport height. Preserve a
     * continuous-reading anchor when moving down; move directly and wake the toolbar when moving
     * up.
     *
     * 由四个键盘按键触发一次 78% 视口高度的辅助翻屏。
     * 向下时保留连续阅读锚点，向上时直接移动并唤醒工具栏。
     */
    const assistByKeyboard = (direction: 1 | -1) => {
      if (animationRef.current !== null || assistDelayTimerRef.current !== null) return;
      hidePositionMarker();
      const current = viewport.scrollTop;
      const target = Math.max(0, Math.min(
        maxScroll(),
        current + direction * viewport.clientHeight * READER_SCROLL_RATIO,
      ));
      if (Math.abs(target - current) < 2) return;

      if (direction < 0) {
        hideContinuityMarker();
        setDimmed(sideToolbar);
        animateTo(target);
        return;
      }

      const markerBottom = current + viewport.clientHeight;
      const markerHeight = markerBottom - target;
      const markerFits = markerHeight > 4
        && markerHeight <= viewport.clientHeight * MAX_MARKER_HEIGHT_RATIO;
      if (!markerFits) {
        hideContinuityMarker();
        animateTo(target);
        return;
      }

      showContinuityMarker(target, markerBottom);
      assistDelayTimerRef.current = window.setTimeout(() => {
        assistDelayTimerRef.current = null;
        animateTo(target, () => hideContinuityMarker(1000));
      }, CONTINUITY_MARKER_DELAY_MS);
    };

    /**
     * Move the desktop double-click or mobile double-tap position to 80px below the viewport top.
     * The positioning line uses content coordinates and therefore scrolls upward naturally with the
     * article.
     *
     * 将桌面双击或移动端双击位置移动到视口顶部下方 80px。
     * 定位线位于正文坐标系中，因此会随正文自然向上移动。
     */
    const jumpDoubleClickPosition = (clientY: number) => {
      clearAssistDelay();
      stopAnimation();
      hideContinuityMarker();

      const viewportRect = viewport.getBoundingClientRect();
      const pointInViewport = Math.max(0, Math.min(
        viewport.clientHeight,
        clientY - viewportRect.top,
      ));
      const pointInDocument = viewport.scrollTop + pointInViewport;
      const target = Math.max(0, Math.min(maxScroll(), pointInDocument - POSITION_TOP_OFFSET));
      const marker = positionMarkerRef.current;
      if (marker) {
        window.clearTimeout(positionMarkerTimerRef.current ?? undefined);
        marker.style.top = `${pointInDocument}px`;
        marker.classList.add("visible");
      }

      animateTo(target, () => hidePositionMarker(POSITION_MARKER_HOLD_MS));
    };

    /**
     * Return control immediately when the user begins another vertical input.
     * 用户开始其他纵向输入时，立即把控制权交还给用户。
     */
    const cancelProgrammaticScroll = () => {
      clearAssistDelay();
      stopAnimation();
      hideContinuityMarker();
      hidePositionMarker();
    };

    // Part 2: horizontal panel animation.
    // 第二部分：横向面板动画。
    const clearPanelMotion = () => {
      const panel = panelRef.current;
      if (!panel) return;
      panel.style.transition = "";
      panel.style.transform = "";
    };

    const settlePanelSwipe = (accepted: boolean) => {
      const panel = panelRef.current;
      window.clearTimeout(swipeAnimationTimer);
      window.cancelAnimationFrame(swipeSettleFrame);
      horizontalSettling = true;
      if (!panel) {
        horizontalSettling = false;
        if (accepted) onSwipeRight?.();
        return;
      }

      swipeSettleFrame = window.requestAnimationFrame(() => {
        swipeSettleFrame = 0;
        const duration = accepted ? 340 : 260;
        panel.style.transition = `transform ${duration}ms cubic-bezier(.22,.61,.36,1)`;
        panel.style.transform = accepted
          ? `translate3d(${viewport.clientWidth}px, 0, 0)`
          : "translate3d(0, 0, 0)";
        // Switch list state immediately after release confirmation so positioning and highlighting
        // align with the remaining exit animation.
        // 松手确认后立即切换列表状态，让定位及高亮与剩余退场动画衔接。
        if (accepted) onSwipeRight?.();
        swipeAnimationTimer = window.setTimeout(() => {
          trackpadOffset = 0;
          trackpadDirection = 0;
          horizontalSettling = false;
          window.requestAnimationFrame(clearPanelMotion);
        }, duration);
      });
    };

    /**
     * Trackpad input only triggers the existing return state; the reader panel's CSS handles its
     * exit animation.
     * 触控板只触发既有返回状态，让 reader-panel 自己的 CSS 动画负责退出。
     */
    const triggerTrackpadReturn = () => {
      window.clearTimeout(trackpadIdleTimer);
      window.clearTimeout(swipeAnimationTimer);
      trackpadOffset = 0;
      trackpadDirection = 0;
      horizontalSettling = true;
      onSwipeRight?.();
      // Keep ReaderPage mounted; briefly lock the old viewport to avoid repeated triggers during
      // animation.
      // ReaderPage 会继续挂载；短暂锁住旧视口，避免动画期间重复触发。
      swipeAnimationTimer = window.setTimeout(() => {
        horizontalSettling = false;
      }, 360);
    };

    // Part 3: native mobile vertical scrolling, double-tap positioning, and horizontal return.
    // 第三部分：移动端原生纵向滚动、双击定位和横向返回。
    const resetPointer = () => {
      pointerId = null;
      pointerAxis = null;
      pointerCodeBlock = null;
      touchTapEligible = false;
    };

    const onPointerDown = (event: PointerEvent) => {
      if ((event.pointerType !== "touch" && event.pointerType !== "pen") || pointerId !== null) return;
      pointerId = event.pointerId;
      pointerStartX = pointerLastX = event.clientX;
      pointerStartY = event.clientY;
      pointerStartScrollTop = viewport.scrollTop;
      pointerLastTime = performance.now();
      horizontalVelocity = 0;
      pointerAxis = null;
      const codeBlock = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-reader-horizontal-scroll]")
        : null;
      pointerCodeBlock = codeBlock && codeBlock.scrollWidth > codeBlock.clientWidth
        ? codeBlock
        : null;
      pointerCodeBlockStartScrollLeft = pointerCodeBlock?.scrollLeft ?? 0;
      touchTapEligible = event.pointerType === "touch" && !isInteractiveReaderTarget(event.target);
      cancelProgrammaticScroll();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - pointerStartX;
      const dy = event.clientY - pointerStartY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= POINTER_AXIS_SLOP) touchTapEligible = false;

      if (!pointerAxis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < POINTER_AXIS_SLOP) return;
        if (pointerCodeBlock && Math.abs(dx) > Math.abs(dy)) {
          pointerAxis = "code";
          viewport.setPointerCapture(event.pointerId);
        } else if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {
          pointerAxis = "horizontal";
          viewport.setPointerCapture(event.pointerId);
        } else {
          // Do not capture or prevent this movement; leave vertical scrolling and momentum to the
          // native system.
          // 不捕获、不阻止：纵向移动继续交给原生滚动和惯性系统。
          pointerAxis = "native";
          return;
        }
      }
      if (pointerAxis === "code" && pointerCodeBlock) {
        event.preventDefault();
        pointerCodeBlock.scrollLeft = pointerCodeBlockStartScrollLeft - dx;
        return;
      }
      if (pointerAxis !== "horizontal") return;

      event.preventDefault();
      const now = performance.now();
      horizontalVelocity = (event.clientX - pointerLastX) / Math.max(1, now - pointerLastTime);
      pointerLastX = event.clientX;
      pointerLastTime = now;
      const panel = panelRef.current;
      if (panel) {
        const offset = Math.max(0, Math.min(viewport.clientWidth, dx));
        panel.style.transition = "none";
        panel.style.transform = `translate3d(${offset}px, 0, 0)`;
      }
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const now = performance.now();
      const dx = event.clientX - pointerStartX;

      if (pointerAxis === "horizontal") {
        const accepted = event.type === "pointerup" && (dx > 84 || horizontalVelocity > 0.55);
        settlePanelSwipe(accepted);
        resetPointer();
        return;
      }

      if (event.type === "pointerup" && touchTapEligible) {
        const interval = now - lastTouchTapTime;
        const distance = Math.hypot(event.clientX - lastTouchTapX, event.clientY - lastTouchTapY);
        const scrollStayedStill = Math.abs(viewport.scrollTop - lastTouchTapScrollTop) < 2
          && Math.abs(viewport.scrollTop - pointerStartScrollTop) < 2;
        const isDoubleTap = interval > 0
          && interval <= TOUCH_DOUBLE_TAP_DELAY_MS
          && distance <= TOUCH_DOUBLE_TAP_DISTANCE
          && scrollStayedStill;

        if (isDoubleTap) {
          event.preventDefault();
          lastTouchTapTime = 0;
          lastTouchJumpTime = now;
          clearTransientTextSelection();
          jumpDoubleClickPosition(event.clientY);
        } else {
          lastTouchTapTime = now;
          lastTouchTapX = event.clientX;
          lastTouchTapY = event.clientY;
          lastTouchTapScrollTop = viewport.scrollTop;
        }
      }
      resetPointer();
    };

    /**
     * Use native dblclick on desktop and deduplicate synthetic touch events by timestamp.
     * 桌面端使用原生 dblclick；触屏合成事件由时间戳去重。
     */
    const onDoubleClick = (event: MouseEvent) => {
      if (event.button !== 0 || performance.now() - lastTouchJumpTime < 700) return;
      if (isInteractiveReaderTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      clearTransientTextSelection();
      jumpDoubleClickPosition(event.clientY);
    };

    // Part 4: retain native vertical wheel scrolling; trigger return animation when horizontal
    // trackpad movement reaches the threshold.
    // 第四部分：垂直 wheel 原生滚动，水平触控板达到阈值后触发返回动画。
    const onWheel = (event: WheelEvent) => {
      const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.1
        && Math.abs(event.deltaX) > 1;
      if (!horizontalIntent) {
        cancelProgrammaticScroll();
        return;
      }

      const codeBlock = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-reader-horizontal-scroll]")
        : null;
      if (codeBlock && codeBlock.scrollWidth > codeBlock.clientWidth) {
        cancelProgrammaticScroll();
        return;
      }

      event.preventDefault();
      cancelProgrammaticScroll();
      if (horizontalSettling) return;
      const now = performance.now();
      const returnDelta = -event.deltaX;
      if (now - trackpadLastTime > 180) {
        trackpadOffset = 0;
        trackpadDirection = 0;
      }
      if (Math.abs(returnDelta) <= TRACKPAD_TAIL_DELTA) return;
      const eventDirection = returnDelta > 0 ? 1 : -1;
      if (!trackpadDirection) trackpadDirection = eventDirection;
      trackpadLastTime = now;
      window.clearTimeout(trackpadIdleTimer);
      trackpadIdleTimer = window.setTimeout(() => {
        trackpadOffset = 0;
        trackpadDirection = 0;
      }, TRACKPAD_GESTURE_IDLE_MS);
      // Do not change navigation direction for reverse rebound within the same event sequence.
      // 同一事件串的反向回弹不切换导航方向。
      if (trackpadDirection !== eventDirection || trackpadDirection < 0) return;

      trackpadOffset += returnDelta;
      if (trackpadOffset < TRACKPAD_NAVIGATION_DISTANCE) return;
      triggerTrackpadReturn();
    };

    /**
     * The four navigation keys share the same assisted paging rules and ignore key-repeat events.
     * 四个导航键复用同一套辅助翻屏规则，并忽略长按重复事件。
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (!keyboardEnabled || event.defaultPrevented || event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isInteractiveReaderTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.key === "Escape" || event.key === "ArrowLeft" || key === "h") {
        event.preventDefault();
        onKeyboardBack?.();
        return;
      }
      const direction = event.key === "ArrowDown" || event.key === "PageDown" || key === "j"
        ? 1
        : event.key === "ArrowUp" || event.key === "PageUp" || key === "k"
          ? -1
          : 0;
      if (!direction) return;
      event.preventDefault();
      assistByKeyboard(direction);
    };

    const onScroll = () => {
      const next = viewport.scrollTop;
      if (next > lastScrollTop + 1) setDimmed(true);
      else if (next < lastScrollTop - 1) setDimmed(sideToolbar);
      lastScrollTop = next;
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove, { passive: false });
    viewport.addEventListener("pointerup", onPointerEnd, { passive: false });
    viewport.addEventListener("pointercancel", onPointerEnd);
    viewport.addEventListener("dblclick", onDoubleClick);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("keydown", onKeyDown);
    viewport.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearAssistDelay();
      stopAnimation();
      window.clearTimeout(continuityMarkerTimerRef.current ?? undefined);
      window.clearTimeout(positionMarkerTimerRef.current ?? undefined);
      window.clearTimeout(swipeAnimationTimer);
      window.clearTimeout(trackpadIdleTimer);
      window.cancelAnimationFrame(swipeSettleFrame);
      clearPanelMotion();
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerEnd);
      viewport.removeEventListener("pointercancel", onPointerEnd);
      viewport.removeEventListener("dblclick", onDoubleClick);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("keydown", onKeyDown);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [continuityMarkerRef, hideContinuityMarker, hidePositionMarker, keyboardEnabled, sideToolbar, onKeyboardBack, onSwipeRight, panelRef, positionMarkerRef, setDimmed, stopAnimation, viewportRef]);

  const resetToolbar = useCallback(() => {
    wakeToolbar();
    setDimmed(sideToolbar);
  }, [sideToolbar, wakeToolbar, setDimmed]);
  const collapseToolbar = useCallback(() => setDimmed(true), [setDimmed]);
  return { toolbarDimmed, wakeToolbar, resetToolbar, collapseToolbar };
}
