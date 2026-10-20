import { shouldSuppressTouchPress } from "@/components/touchPressFeedback";
import { getBottomToolbar } from "@/components/toolbarGeometry";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { getFocusedArticleIds } from "./articleVisibility";

const DRAG_SLOP = 6;
const TOUCH_PRESS_DELAY_MS = 60;
const TOUCH_PRESS_FEEDBACK_MS = 180;
const PAGE_SETTLE_MS = 520;
const CONTINUOUS_PAGE_SETTLE_MS = 420;
const WHEEL_MEANINGFUL_IDLE_MS = 110;
const WHEEL_EVENT_MIN_DELTA = 4;
const WHEEL_GESTURE_ACTIVATION_DISTANCE = 22;
const WHEEL_SINGLE_EVENT_DISTANCE = 32;
const WHEEL_TAIL_EVENTS_TO_REARM = 3;
const WHEEL_FRESH_INTENT_WINDOW_MS = 120;
const PAGE_SETTLE_FALLBACK_MS = 80;
const TOP_EDGE_MASK_HEIGHT = 49;
const SYSTEM_GESTURE_BUFFER_PX = 12;
const PAGE_EASING = "cubic-bezier(.22,.61,.36,1)";

type MaskGeometry = {
  topHeight: number;
  bottomTop: number;
};

type WheelGesturePhase = "initial" | "consumed" | "armed";

export type ForwardPageResolution =
  | { kind: "anchor"; articleId: string }
  | { kind: "end" }
  | { kind: "unavailable" };

/**
 * Editable controls retain their arrow-key behavior; list paging must not take over input focus.
 * 编辑控件保留自己的方向键语义，不让列表翻组抢走输入焦点。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement;
}

/**
 * Exclude the bottom exit gesture in iOS home-screen apps from list paging; ordinary browsers and
 * mouse input are unaffected.
 * iOS 主屏幕应用底部的退出手势不参与列表翻页；普通浏览器和鼠标不受影响。
 */
function startsInSystemGestureArea(event: PointerEvent, viewport: HTMLElement): boolean {
  if (event.pointerType !== "touch") return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!ios || !standalone) return false;

  const safeBottom = Number.parseFloat(getComputedStyle(viewport).getPropertyValue("--list-safe-area-bottom")) || 0;
  const visualViewport = window.visualViewport;
  const bottom = visualViewport
    ? visualViewport.offsetTop + visualViewport.height
    : window.innerHeight;
  return event.clientY >= bottom - safeBottom - SYSTEM_GESTURE_BUFFER_PX;
}

/**
 * Read mask fallbacks from precomputed groups; recalculate using the final track offset when the actual
 * DOM is available.
 * 读取静态分组的遮罩兜底；真实 DOM 可用时会按最终轨道偏移重新解析。
 */
function getMaskGeometry(
  viewport: HTMLDivElement,
  page: number,
  pageCount: number,
  bottomMaskOffsets: readonly number[],
): MaskGeometry {
  return {
    topHeight: page > 0 ? TOP_EDGE_MASK_HEIGHT : 0,
    bottomTop: page < pageCount - 1
      ? (bottomMaskOffsets[page] ?? viewport.clientHeight)
      : viewport.clientHeight,
  };
}

/**
 * Synchronize both viewport masks at constant opacity, moving their boundaries with the same timing
 * as the track.
 * 同步两块视口遮罩；透明度恒定，只让边界与轨道采用相同节奏移动。
 */
function applyMaskGeometry(
  viewport: HTMLDivElement,
  geometry: MaskGeometry,
  duration = 0,
) {
  const topMask = viewport.querySelector<HTMLElement>(".article-edge-control.previous");
  const bottomMask = viewport.querySelector<HTMLElement>(".article-edge-control.next");
  const transition = duration > 0
    ? `height ${duration}ms ${PAGE_EASING}`
    : "none";
  const bottomTransition = duration > 0
    ? `top ${duration}ms ${PAGE_EASING}`
    : "none";

  if (topMask) {
    topMask.style.transition = transition;
    topMask.style.height = `${geometry.topHeight}px`;
  }
  if (bottomMask) {
    bottomMask.style.transition = bottomTransition;
    bottomMask.style.top = `${geometry.bottomTop}px`;
  }
}

/**
 * Map article groups to a vertical track that advances one page per gesture. Pointer dragging snaps
 * according to distance and speed; trackpad wheel input consumes one gesture and waits to rearm,
 * preventing strong momentum from turning two pages while allowing a quick independent next
 * gesture.
 *
 * 将文章组映射为一次一页的垂直手势轨道。
 *
 * 指针拖动根据距离和速度吸附；触控板滚轮使用“消费一次、等待重新武装”
 * 的状态机，防止一次强惯性连续翻两页，又允许用户快速发起下一次手势。
 */
export function useArticlePaging(viewportRef: RefObject<HTMLDivElement | null>, pageOffsets: number[], bottomMaskOffsets: number[], resetKey?: string | number, onPageDirection?: (direction: 1 | -1) => void, resolveForwardPageStart?: () => ForwardPageResolution, enabled = true) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(0);
  const settledPageRef = useRef(0);
  const pageOffsetsRef = useRef(pageOffsets);
  const bottomMaskOffsetsRef = useRef(bottomMaskOffsets);
  const pageAnchorArticleIdsRef = useRef(new Map<number, string>());
  const resetKeyRef = useRef(resetKey);
  const suppressClickRef = useRef(false);
  const stepPageRef = useRef<(direction: 1 | -1) => boolean>(() => false);
  const [currentPage, setCurrentPage] = useState(0);
  const [settledPage, setSettledPage] = useState(0);
  const [leadingArticleId, setLeadingArticleId] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(pageOffsets.length > 1);
  const [visiblePage, setVisiblePage] = useState<{
    page: number;
    articleIds: string[];
    lastReadArticleId: string | null;
  } | null>(null);
  const [returnPageCapacity, setReturnPageCapacity] = useState(0);

  // Group measurement and preloading update offsets, but must not recreate listeners and lose
  // gesture state.
  // 分组测量和预加载会更新偏移，但不能因此重建监听器并丢失手势状态。
  pageOffsetsRef.current = pageOffsets;
  bottomMaskOffsetsRef.current = bottomMaskOffsets;

  const pageCount = Math.max(pageOffsets.length, returnPageCapacity);
  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  /**
   * The optional handoff article reuses its existing DOM on the continuous track instead of
   * duplicating the card.
   * 可选的接力文章直接复用连续轨道中的原 DOM，不复制卡片。
   */
  const resolvedPageOffset = useCallback((page: number) => {
    const articleId = pageAnchorArticleIdsRef.current.get(page);
    const track = trackRef.current;
    if (articleId && track) {
      const card = Array.from(track.querySelectorAll<HTMLElement>("[data-article-id]"))
        .find((element) => element.dataset.articleId === articleId);
      if (card) return Math.max(0, card.offsetTop - TOP_EDGE_MASK_HEIGHT);
    }
    return pageOffsetsRef.current[page] ?? 0;
  }, []);

  /**
   * Use the target page's final track offset to locate the last article in the viewport and start
   * the bottom mask there. Dynamic first-article anchors, mixed article heights, and masks then
   * share the same coordinates.
   *
   * 使用目标页最终轨道偏移寻找视口内最后一个条目，并让底部遮罩从它开始。
   * 这样动态首篇锚点、混合条目高度和遮罩始终共享同一套坐标。
   */
  const resolvedMaskGeometry = useCallback((
    viewport: HTMLDivElement,
    page: number,
    pageCount: number,
  ): MaskGeometry => {
    const fallback = getMaskGeometry(
      viewport,
      page,
      pageCount,
      bottomMaskOffsetsRef.current,
    );
    if (page >= pageCount - 1) return fallback;

    const track = trackRef.current;
    if (!track) return fallback;

    const offset = resolvedPageOffset(page);
    const visibleTrackEnd = offset + viewport.clientHeight;
    let previewOffset: number | null = null;
    let hasFollowingCard = false;
    const cards = track.querySelectorAll<HTMLElement>("[data-article-id]");
    for (const card of cards) {
      if (card.offsetTop >= visibleTrackEnd) {
        hasFollowingCard = true;
        break;
      }
      if (card.offsetTop >= offset) previewOffset = card.offsetTop;
    }
    if (previewOffset === null) return fallback;

    // If all remaining articles already fit in the viewport, do not preemptively treat the last one
    // as a next-screen preview. Actual text measurements when downward intent is confirmed
    // determine whether toolbar obstruction requires another screen.
    // 所有剩余文章都已经进入当前视口时，不预先把最后一篇当成下一屏预览。
    // 是否需要因工具栏遮挡再翻一屏，由向下意图确认时的正文测量决定。
    if (!hasFollowingCard) {
      return { ...fallback, bottomTop: viewport.clientHeight };
    }

    return {
      ...fallback,
      bottomTop: Math.max(0, Math.min(viewport.clientHeight, previewOffset - offset)),
    };
  }, [resolvedPageOffset]);

  /**
   * Synchronize masks, paging entry points, and reading boundaries on a stable view instead of
   * inferring scope from an old last-screen flag.
   * 在稳定画面上同步遮罩、翻屏入口和阅读边界，不使用旧的末屏标志推断范围。
   */
  const refreshLayout = useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track || viewport.classList.contains("is-paging")) return;
    const page = pageRef.current;
    track.style.transition = "none";
    track.style.transform = `translate3d(0, ${-resolvedPageOffset(page)}px, 0)`;
    applyMaskGeometry(viewport, resolvedMaskGeometry(viewport, page, pageCountRef.current));
    const resolution = resolveForwardPageStart?.() ?? { kind: "unavailable" };
    setHasNextPage(page < pageCountRef.current - 1 && resolution.kind !== "end");
    const articleIds = getFocusedArticleIds(viewport);
    // If the toolbar obscures the final article, repeat it on the next screen; it remains clickable
    // but cannot yet count as fully read.
    // 工具栏遮住末篇时，下一屏会重复这篇；可点击，但不能提前算作已经完整阅读。
    const nextAnchorIndex = resolution.kind === "anchor" ? articleIds.indexOf(resolution.articleId) : -1;
    const readIds = nextAnchorIndex >= 0 ? articleIds.slice(0, nextAnchorIndex) : articleIds;
    const lastReadArticleId = readIds.at(-1) ?? null;
    setVisiblePage((previous) => previous?.page === page
      && previous.lastReadArticleId === lastReadArticleId
      && previous.articleIds.length === articleIds.length
      && previous.articleIds.every((id, index) => id === articleIds[index])
      ? previous : { page, articleIds, lastReadArticleId });
  }, [resolveForwardPageStart, resolvedMaskGeometry, resolvedPageOffset, viewportRef]);

  /**
   * After regrouping by height, move without animation to the page containing the original anchor
   * article. This corrects layout only and preserves wheel-consumption and momentum state.
   *
   * 页面重新按高度分组后，无动画移动到仍包含原锚点文章的页面。
   * 这个操作只修正布局位置，不重置滚轮的消费和惯性状态。
   */
  const repositionToPage = useCallback((requestedPage: number, anchorArticleId?: string) => {
    let nextPage = Math.max(
      0,
      Math.min(Math.max(0, pageCountRef.current - 1), requestedPage),
    );
    if (anchorArticleId) {
      const viewport = viewportRef.current;
      const cards = Array.from(trackRef.current?.querySelectorAll<HTMLElement>("[data-article-id]") ?? []);
      const targetIndex = cards.findIndex((card) => card.dataset.articleId === anchorArticleId);
      if (viewport && targetIndex >= 0) {
        const toolbar = getBottomToolbar(viewport.closest("section")?.querySelector<HTMLElement>(".floating-switch") ?? null);
        const readingHeight = Math.max(TOP_EDGE_MASK_HEIGHT + cards[targetIndex].offsetHeight,
          toolbar
            ? Math.min(viewport.clientHeight, toolbar.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 8)
            : viewport.clientHeight);
        // Build adjacent screens forward from the return anchor, leaving each next screen's first
        // article in the preview area so the old route cannot skip articles.
        // 从返回首篇向前生成相邻屏：每屏把下一屏首篇留在预览区，避免旧路线跳过文章。
        const starts = [targetIndex];
        let index = targetIndex;
        while (index > 0) {
          const minimumTop = cards[index].offsetTop - readingHeight + TOP_EDGE_MASK_HEIGHT + 1;
          const candidate = cards.findIndex((card) => card.offsetTop >= minimumTop);
          index = Math.max(0, Math.min(index - 1, candidate));
          starts.unshift(index);
        }
        pageAnchorArticleIdsRef.current.clear();
        starts.forEach((start, page) => pageAnchorArticleIdsRef.current.set(page, cards[start].dataset.articleId!));
        nextPage = starts.length - 1;
        // Advance later screens using actual text boundaries; reserve enough page indices so the
        // precomputed page count cannot truncate this route.
        // 后续屏仍按真实文字边界推进；预留足够页码，不让静态页数提前截断这条路线。
        const capacity = Math.max(pageOffsetsRef.current.length, nextPage + cards.length - targetIndex);
        pageCountRef.current = capacity;
        setReturnPageCapacity(capacity);
      }
    }
    pageRef.current = nextPage;
    settledPageRef.current = nextPage;
    setCurrentPage(nextPage);
    setSettledPage(nextPage);

    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return nextPage;
    track.style.transition = "none";
    track.style.transform = `translate3d(0, ${-resolvedPageOffset(nextPage)}px, 0)`;
    setLeadingArticleId(pageAnchorArticleIdsRef.current.get(nextPage) ?? null);
    applyMaskGeometry(viewport, resolvedMaskGeometry(viewport, nextPage, pageCountRef.current));
    refreshLayout();
    return nextPage;
  }, [refreshLayout, resolvedMaskGeometry, resolvedPageOffset, viewportRef]);

  /**
   * Let page controls such as edge-mask hot zones reuse the gesture state machine's current paging
   * implementation. A ref keeps the public callback stable so page changes do not recreate native
   * event listeners.
   *
   * 让边缘遮罩热区等页面控件复用手势状态机当前生效的翻组实现。
   * ref 保证公开回调稳定，不会因为页码变化重建原生事件监听器。
   */
  const stepPage = useCallback((direction: 1 | -1) => (
    stepPageRef.current(direction)
  ), []);

  useEffect(() => {
    if (!enabled) return;
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    // Pointer drag state handles touch, pen, and mouse dragging.
    // 指针拖动状态：负责触摸、触控笔和鼠标拖拽。
    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let dragging = false;
    let reportedDirection = 0;
    let forwardBlocked = false;
    let pointerId: number | null = null;
    let touchPressTimer = 0;
    let suppressClickTimer = 0;
    let touchPressedCard: HTMLElement | null = null;
    // Wheel state excludes trailing momentum after consuming a page, then rearms for the next
    // deliberate gesture.
    // 滚轮状态：消费一页后先排除惯性尾部，再重新武装下一次明确发力。
    let wheelGesturePhase: WheelGesturePhase = "initial";
    let wheelIdleTimer = 0;
    let wheelCandidateDirection: 1 | -1 | 0 = 0;
    let wheelCandidateDistance = 0;
    let wheelCandidateEvents = 0;
    let wheelCandidateStartedAt = 0;
    let wheelTailEvents = 0;
    let pendingWheelDirection: 1 | -1 | 0 = 0;
    let pagingSettleTimer = 0;
    let forwardAvailabilityFrame = 0;
    let paging = false;
    let pagingSequence = 0;
    let finishPagingAnimation: (() => void) | null = null;

    // Read track layout consistently from pageRef to avoid page jumps caused by delayed React
    // state.
    // 轨道布局统一从 pageRef 读取，避免 React state 延迟造成跳页。
    const height = () => viewport.clientHeight;
    const pageOffset = (page = pageRef.current) => resolvedPageOffset(page);
    const pageMask = (page = pageRef.current) => resolvedMaskGeometry(
      viewport,
      page,
      pageCountRef.current,
    );
    const moveMaskToPage = (page = pageRef.current, duration = 0) => {
      applyMaskGeometry(viewport, pageMask(page), duration);
    };
    const interpolateMasks = (fromPage: number, toPage: number, progress: number) => {
      const from = pageMask(fromPage);
      const to = pageMask(toPage);
      applyMaskGeometry(viewport, {
        topHeight: from.topHeight + (to.topHeight - from.topHeight) * progress,
        bottomTop: from.bottomTop + (to.bottomTop - from.bottomTop) * progress,
      });
    };
    const setPaging = (value: boolean) => {
      paging = value;
      viewport.classList.toggle("is-paging", value);
    };
    const clearTouchPress = () => {
      window.clearTimeout(touchPressTimer);
      touchPressTimer = 0;
      touchPressedCard?.classList.remove("touch-pressed");
      touchPressedCard = null;
    };
    const scheduleTouchPress = (event: PointerEvent) => {
      clearTouchPress();
      if (event.pointerType === "mouse" || !(event.target instanceof Element) || shouldSuppressTouchPress(event.target)) return;
      if (event.target.closest("button, a")) return;
      const card = event.target.closest<HTMLElement>(".article-card");
      if (!card || !viewport.contains(card)) return;
      touchPressedCard = card;
      touchPressTimer = window.setTimeout(() => {
        touchPressTimer = 0;
        if (touchPressedCard && !shouldSuppressTouchPress(touchPressedCard)) touchPressedCard.classList.add("touch-pressed");
      }, TOUCH_PRESS_DELAY_MS);
    };
    const releaseTouchPress = (linger: boolean) => {
      window.clearTimeout(touchPressTimer);
      touchPressTimer = 0;
      if (!touchPressedCard) return;
      if (!linger || shouldSuppressTouchPress(touchPressedCard)) {
        clearTouchPress();
        return;
      }
      touchPressedCard.classList.add("touch-pressed");
      touchPressTimer = window.setTimeout(clearTouchPress, TOUCH_PRESS_FEEDBACK_MS);
    };
    const translate = (offset = 0, duration = 0) => {
      track.style.transition = duration > 0 ? `transform ${duration}ms ${PAGE_EASING}` : "none";
      track.style.transform = `translate3d(0, ${-pageOffset() + offset}px, 0)`;
    };

    /**
     * Lock the next screen's first article using actual content boundaries; distinguish the end of
     * content from temporarily unavailable measurements.
     * 根据真实内容边界锁定下一屏首篇，并明确区分到底与暂时无法测量。
     */
    const preparePageAnchor = (direction: 1 | -1): boolean => {
      if (direction < 0) return true;
      const targetPage = Math.min(pageCountRef.current - 1, pageRef.current + 1);
      if (targetPage === pageRef.current) return false;
      const resolution = resolveForwardPageStart?.() ?? { kind: "unavailable" };
      if (resolution.kind === "end") {
        setHasNextPage(false);
        return false;
      }
      if (resolution.kind === "anchor") {
        pageAnchorArticleIdsRef.current.set(targetPage, resolution.articleId);
      } else {
        pageAnchorArticleIdsRef.current.delete(targetPage);
      }
      setHasNextPage(true);
      return true;
    };

    /**
     * Align the next-group hot zone with actual text boundaries once the page is stable.
     * 在页面稳定后让下一组热区与真实正文边界保持一致。
     */
    const refreshForwardAvailability = () => {
      window.cancelAnimationFrame(forwardAvailabilityFrame);
      forwardAvailabilityFrame = window.requestAnimationFrame(() => {
        forwardAvailabilityFrame = 0;
        refreshLayout();
      });
    };

    /**
     * Clear the candidate offset for the next page turn.
     * 清空下一次翻页的位移候选。
     */
    function resetWheelCandidate() {
      wheelCandidateDirection = 0;
      wheelCandidateDistance = 0;
      wheelCandidateEvents = 0;
      wheelCandidateStartedAt = 0;
    }

    /**
     * Rearm after trailing momentum ends; confirm a new gesture using multiple events.
     * 尾部结束后重新武装；新动作需要多个事件共同确认。
     */
    function armWheelGesture() {
      window.clearTimeout(wheelIdleTimer);
      wheelGesturePhase = "armed";
      wheelTailEvents = 0;
      resetWheelCandidate();
    }

    /**
     * Schedule rearming only for meaningful movement so tiny momentum cannot postpone it
     * indefinitely.
     * 只按有效位移安排重新武装，微小惯性不再无限推迟计时。
     */
    function scheduleWheelIdle() {
      window.clearTimeout(wheelIdleTimer);
      wheelIdleTimer = window.setTimeout(() => {
        if (wheelGesturePhase === "consumed") armWheelGesture();
        else resetWheelCandidate();
      }, WHEEL_MEANINGFUL_IDLE_MS);
    }

    /**
     * Lock the completed page turn and initially treat subsequent events as trailing momentum.
     * 锁定刚完成的翻页，后续事件先作为惯性尾部处理。
     */
    function consumeWheelGesture() {
      wheelGesturePhase = "consumed";
      wheelTailEvents = 0;
      resetWheelCandidate();
      scheduleWheelIdle();
    }

    /**
     * After snapping finishes, dequeue a page confirmed by an independent gesture and recheck its
     * boundaries.
     * 当吸附完成时取出一个由独立手势确认的缓冲页，并重新校验边界。
     */
    function flushPendingWheelPage(): boolean {
      if (!pendingWheelDirection) return false;
      const direction = pendingWheelDirection;
      pendingWheelDirection = 0;
      return beginWheelPage(direction, CONTINUOUS_PAGE_SETTLE_MS);
    }

    /**
     * Cancel the old animation completion handler so interrupted snapping cannot later release or
     * overwrite newer state.
     * 取消旧的动画完成器，避免被中断的吸附稍后释放或覆盖新状态。
     */
    function cancelPagingCompletion() {
      pagingSequence += 1;
      window.clearTimeout(pagingSettleTimer);
      finishPagingAnimation = null;
    }

    /**
     * Snap the track to the target page; transitionend and the timeout fallback share one
     * completion path.
     * 将轨道吸附到目标页；transitionend 与超时兜底共用唯一完成出口。
     */
    function settle(next: number, duration = PAGE_SETTLE_MS) {
      cancelPagingCompletion();
      const sequence = pagingSequence;
      setPaging(true);
      pageRef.current = Math.max(0, Math.min(Math.max(0, pageCountRef.current - 1), next));
      setCurrentPage(pageRef.current);
      setLeadingArticleId(pageAnchorArticleIdsRef.current.get(pageRef.current) ?? null);
      translate(0, duration);
      moveMaskToPage(pageRef.current, duration);

      const complete = () => {
        if (sequence !== pagingSequence) return;
        window.clearTimeout(pagingSettleTimer);
        finishPagingAnimation = null;
        settledPageRef.current = pageRef.current;
        setSettledPage(pageRef.current);
        setLeadingArticleId(pageAnchorArticleIdsRef.current.get(pageRef.current) ?? null);
        // Commit the page already reached before calculating the buffered gesture's next first
        // article from stable geometry.
        // 先提交已经到达的页面，再从稳定几何位置计算缓冲手势的下一屏首篇。
        if (flushPendingWheelPage()) return;
        setPaging(false);
        refreshForwardAvailability();
      };
      finishPagingAnimation = complete;
      pagingSettleTimer = window.setTimeout(complete, duration + PAGE_SETTLE_FALLBACK_MS);
    }

    /**
     * Give non-wheel input higher priority so an old buffered page cannot execute afterward.
     * 非滚轮输入拥有更高优先级，避免稍后又执行旧的缓冲页。
     */
    function cancelPendingWheelPage() {
      pendingWheelDirection = 0;
      window.clearTimeout(wheelIdleTimer);
      resetWheelGesture();
    }

    /**
     * Request one-group movement from buttons or the keyboard with consistent direction and
     * snapping animation.
     * 从按钮或键盘请求移动一组，并统一发送方向和吸附动画。
     */
    const requestPageStep = (direction: 1 | -1, allowDuringPaging = false): boolean => {
      cancelPendingWheelPage();
      const next = Math.max(0, Math.min(pageCountRef.current - 1, pageRef.current + direction));
      if (next === pageRef.current || (!allowDuringPaging && paging)) return false;
      if (!preparePageAnchor(direction)) return false;
      onPageDirection?.(direction);
      settle(next);
      return true;
    };
    stepPageRef.current = requestPageStep;
    /**
     * Restore the full initial gesture state for non-wheel interaction.
     * 非滚轮交互重新建立完整的初始手势状态。
     */
    function resetWheelGesture() {
      wheelGesturePhase = "initial";
      wheelTailEvents = 0;
      resetWheelCandidate();
    }

    /**
     * Consume a confirmed gesture, changing the page index by exactly one.
     * 消费一个已确认手势，每次只把页码增减一。
     */
    function beginWheelPage(direction: 1 | -1, duration = PAGE_SETTLE_MS): boolean {
      const next = Math.max(0, Math.min(pageCountRef.current - 1, pageRef.current + direction));
      if (next === pageRef.current) {
        resetWheelCandidate();
        return false;
      }
      if (!preparePageAnchor(direction)) {
        resetWheelCandidate();
        return false;
      }
      consumeWheelGesture();
      onPageDirection?.(direction);
      settle(next, duration);
      return true;
    }
    /**
     * Accumulate meaningful wheel movement in the same direction until it reaches the gesture
     * confirmation distance. Reset on direction changes so small trackpad rebound cannot add to the
     * original movement.
     *
     * 累计同方向的有效滚轮位移，直到达到一次明确手势的确认距离。
     * 方向改变时从零开始，避免把触控板的细小回弹与原方向位移相加。
     */
    const accumulateWheelIntent = (direction: 1 | -1, magnitude: number, now: number, allowSingleEvent: boolean): boolean => {
      const candidateExpired = wheelCandidateStartedAt > 0
        && now - wheelCandidateStartedAt > WHEEL_FRESH_INTENT_WINDOW_MS;
      if (direction !== wheelCandidateDirection || candidateExpired) {
        wheelCandidateDirection = direction;
        wheelCandidateDistance = 0;
        wheelCandidateEvents = 0;
        wheelCandidateStartedAt = now;
      }
      wheelCandidateDistance += magnitude;
      wheelCandidateEvents += 1;
      const enoughEvents = wheelGesturePhase === "initial"
        || allowSingleEvent
        || wheelCandidateEvents >= 2;
      return enoughEvents && wheelCandidateDistance >= WHEEL_GESTURE_ACTIVATION_DISTANCE;
    };

    /**
     * During animation, accept only newly rearmed gestures and verify their target before queuing
     * them.
     * 动画中只接收已重新武装的新手势，并在入队前确认目标仍然有效。
     */
    function queueWheelPage(direction: 1 | -1): boolean {
      if (pendingWheelDirection) return false;
      const next = Math.max(0, Math.min(pageCountRef.current - 1, pageRef.current + direction));
      if (next === pageRef.current) {
        resetWheelCandidate();
        return false;
      }
      pendingWheelDirection = direction;
      consumeWheelGesture();
      return true;
    }
    const releasePointer = () => {
      const previousPointerId = pointerId;
      pointerId = null;
      dragging = false;
      forwardBlocked = false;
      reportedDirection = 0;
      velocity = 0;
      if (previousPointerId !== null && viewport.hasPointerCapture(previousPointerId)) {
        viewport.releasePointerCapture(previousPointerId);
      }
      window.clearTimeout(suppressClickTimer);
      suppressClickTimer = window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    };
    /**
     * System takeover and blur only cancel drag-follow movement; they must not commit paging or
     * mark articles as read automatically.
     * 系统接管和失焦只撤销跟手位移，不能提交翻页或自动已读。
     */
    const cancelPointerGesture = () => {
      if (pointerId === null) return;
      clearTouchPress();
      suppressClickRef.current = true;
      if (dragging) {
        cancelPagingCompletion();
        translate();
        moveMaskToPage();
        setPaging(false);
      }
      releasePointer();
    };
    // Pointer phase: determine vertical intent, then capture the pointer and move the track with
    // the drag.
    // 指针阶段：先判定纵向意图，再捕获指针并跟手移动轨道。
    const onPointerDown = (event: PointerEvent) => {
      if (document.hidden || event.button !== 0 || pointerId !== null || paging) return;
      // Decide only from the starting point; moving into the list from the protected area does not
      // transfer control of this touch.
      // 只按起点判定；从保护区滑入列表后也不会重新接管这次触摸。
      if (startsInSystemGestureArea(event, viewport)) return;
      cancelPendingWheelPage();
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = lastY = event.clientY;
      lastTime = performance.now();
      velocity = 0;
      dragging = false;
      reportedDirection = 0;
      forwardBlocked = false;
      window.clearTimeout(suppressClickTimer);
      suppressClickRef.current = false;
      scheduleTouchPress(event);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const dy = event.clientY - startY;
      const dx = event.clientX - startX;
      if (Math.hypot(dx, dy) >= DRAG_SLOP) clearTouchPress();
      if (!dragging) {
        if (Math.abs(dy) < DRAG_SLOP || Math.abs(dy) <= Math.abs(dx)) return;
        dragging = true;
        suppressClickRef.current = true;
        cancelPagingCompletion();
        setPaging(true);
        viewport.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      const now = performance.now();
      velocity = (event.clientY - lastY) / Math.max(1, now - lastTime);
      lastY = event.clientY;
      lastTime = now;
      const atStart = pageRef.current === 0 && dy > 0;
      const direction = dy < 0 ? 1 : -1;
      const atStaticEnd = pageRef.current === pageCountRef.current - 1 && direction > 0;
      if (!atStart && !atStaticEnd && direction !== reportedDirection) {
        reportedDirection = direction;
        forwardBlocked = !preparePageAnchor(direction);
        if (!forwardBlocked) onPageDirection?.(direction);
      }
      const atEnd = atStaticEnd || (direction > 0 && forwardBlocked);
      const dragOffset = atStart || atEnd ? dy * 0.22 : dy;
      translate(dragOffset);
      const targetPage = Math.max(
        0,
        Math.min(pageCountRef.current - 1, pageRef.current + (atEnd ? 0 : direction)),
      );
      const targetDistance = Math.abs(pageOffset(targetPage) - pageOffset(pageRef.current));
      interpolateMasks(
        pageRef.current,
        targetPage,
        targetDistance > 0 ? Math.min(1, Math.abs(dragOffset) / targetDistance) : 0,
      );
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      releaseTouchPress(event.type === "pointerup" && !dragging);
      const dy = event.clientY - startY;
      if (dragging) {
        const direction = dy < 0 ? 1 : -1;
        const shouldMove = Math.abs(dy) > height() * 0.12 || Math.abs(velocity) > 0.55;
        settle(shouldMove && !forwardBlocked ? pageRef.current + direction : pageRef.current);
      }
      releasePointer();
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) cancelPointerGesture();
    };
    const onLostPointerCapture = (event: PointerEvent) => {
      // Touch is implicitly captured by children such as titles before passing to the list. A
      // child's lost-capture event bubbles during this normal handoff; cancel dragging only when
      // the list itself truly loses capture.
      // 触摸先由标题等子元素隐式捕获，再交给列表。子元素的丢失事件会冒泡，
      // 这是正常交接；只有列表自身真正丢失捕获时才撤销拖动。
      if (event.target === viewport && event.pointerId === pointerId
        && !viewport.hasPointerCapture(event.pointerId)) cancelPointerGesture();
    };
    /**
     * Keep pages committed on release; discard only unfinished dragging and buffered subsequent
     * page turns.
     * 已松手提交的页保留，只丢弃未完成拖动和缓冲的后续翻页。
     */
    const suspendInteraction = () => {
      cancelPendingWheelPage();
      cancelPointerGesture();
      clearTouchPress();
      finishPagingAnimation?.();
      cancelPagingCompletion();
      translate();
      moveMaskToPage();
      setPaging(false);
    };
    const onVisibilityChange = () => {
      if (document.hidden) suspendInteraction();
    };
    // Wheel phase: consume one page per actual gesture and buffer at most one subsequent gesture
    // during animation.
    // 滚轮阶段：每个真实手势只消费一页，动画期间最多缓冲一个后续手势。
    const onWheel = (event: WheelEvent) => {
      if (document.hidden) return;
      const magnitude = Math.abs(event.deltaY);
      const horizontalMagnitude = Math.abs(event.deltaX);

      // Consume diagonal gestures only when vertical intent dominates so horizontal momentum cannot
      // be mistaken for upward paging.
      // 斜向手势只在纵向意图占主导时才由列表消费，避免横向惯性被当成向上翻组。
      if (magnitude < 1 || magnitude <= horizontalMagnitude * 1.1) return;
      event.preventDefault();
      const now = performance.now();
      const direction: 1 | -1 = event.deltaY > 0 ? 1 : -1;

      if (magnitude < WHEEL_EVENT_MIN_DELTA) {
        // Tiny momentum does not extend the timeout; consecutive low-amplitude events can confirm
        // that the previous gesture has ended early.
        // 微小惯性不续期；连续低幅尾部可提前确认上一手势已经释放。
        if (wheelGesturePhase === "consumed") {
          wheelTailEvents += 1;
          if (wheelTailEvents >= WHEEL_TAIL_EVENTS_TO_REARM) armWheelGesture();
        }
        return;
      }

      // Do not queue a third page when the buffer is full, but keep tracking meaningful momentum to
      // schedule rearming correctly.
      // 缓冲已满时不堆积第三页，但仍跟踪有效惯性，以正确安排下一次重新武装。
      scheduleWheelIdle();
      if (pendingWheelDirection) {
        wheelGesturePhase = "consumed";
        wheelTailEvents = 0;
        resetWheelCandidate();
        return;
      }
      if (wheelGesturePhase === "consumed") {
        wheelTailEvents = 0;
        return;
      }

      const allowSingleEvent = event.deltaMode !== 0 || magnitude >= WHEEL_SINGLE_EVENT_DISTANCE;
      if (accumulateWheelIntent(direction, magnitude, now, allowSingleEvent)) {
        if (paging) {
          queueWheelPage(direction);
        } else {
          beginWheelPage(direction);
        }
      }
    };
    const onTrackTransitionEnd = (event: TransitionEvent) => {
      if (event.target !== track || event.propertyName !== "transform") return;
      finishPagingAnimation?.();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.hidden) return;
      if (event.defaultPrevented || event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (viewport.closest("[inert]") || document.getElementById("mark-read-confirm-popover") || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const direction = event.key === "ArrowDown" || event.key === "PageDown" || key === "j"
        ? 1
        : event.key === "ArrowUp" || event.key === "PageUp" || key === "k"
          ? -1
          : 0;
      if (!direction) return;
      event.preventDefault();
      // Arrow keys, Page keys, and J/K share the same paging path as buttons and dragging.
      // 方向键、Page 键和 J/K 共用按钮、拖动相同的翻组出口。
      requestPageStep(direction);
    };
    const onResize = () => {
      translate();
      moveMaskToPage();
      refreshForwardAvailability();
    };

    // Return to the first page when the scope changes; preserve the nearest possible page when only
    // the article count changes.
    // 范围变化回到第一页；仅文章数量变化时保留尽可能接近的页码。
    if (resetKeyRef.current !== resetKey) {
      setReturnPageCapacity(0);
      pageRef.current = 0;
      settledPageRef.current = 0;
      pageAnchorArticleIdsRef.current.clear();
      resetKeyRef.current = resetKey;
    } else {
      pageRef.current = Math.min(pageRef.current, Math.max(0, pageCountRef.current - 1));
      settledPageRef.current = Math.min(settledPageRef.current, Math.max(0, pageCountRef.current - 1));
    }
    setCurrentPage(pageRef.current);
    setSettledPage(settledPageRef.current);
    setLeadingArticleId(pageAnchorArticleIdsRef.current.get(settledPageRef.current) ?? null);
    translate();
    moveMaskToPage();
    refreshForwardAvailability();
    // Register all native listeners in the same effect and clean them up in matching pairs.
    // 所有原生监听都在同一个 effect 中注册和成对清理。
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove, { passive: false });
    viewport.addEventListener("pointerup", onPointerEnd);
    viewport.addEventListener("pointercancel", onPointerCancel);
    viewport.addEventListener("lostpointercapture", onLostPointerCapture);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    track.addEventListener("transitionend", onTrackTransitionEnd);
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", suspendInteraction);
    window.addEventListener("pagehide", suspendInteraction);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stepPageRef.current = () => false;
      window.clearTimeout(wheelIdleTimer);
      window.cancelAnimationFrame(forwardAvailabilityFrame);
      clearTouchPress();
      cancelPointerGesture();
      window.clearTimeout(suppressClickTimer);
      suppressClickRef.current = false;
      cancelPagingCompletion();
      setPaging(false);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerEnd);
      viewport.removeEventListener("pointercancel", onPointerCancel);
      viewport.removeEventListener("lostpointercapture", onLostPointerCapture);
      viewport.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
      track.removeEventListener("transitionend", onTrackTransitionEnd);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", suspendInteraction);
      window.removeEventListener("pagehide", suspendInteraction);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, onPageDirection, refreshLayout, resetKey, resolveForwardPageStart, resolvedMaskGeometry, resolvedPageOffset, viewportRef]);

  useLayoutEffect(() => {
    const maximumPage = Math.max(0, pageCount - 1);
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    if (pageRef.current > maximumPage) {
      // Clamp the target and stable page when articles are removed; preserve position when
      // preloading adds pages.
      // 文章减少时夹紧目标和稳定页；预加载增加页数时保留当前位置。
      pageRef.current = maximumPage;
      settledPageRef.current = maximumPage;
      setCurrentPage(maximumPage);
      setSettledPage(maximumPage);
    }

    // Enter or leave toolbar dormancy when paging starts. Continue the track's original animation
    // while the mask follows the new capsule's actual height, avoiding excessive masking followed
    // by a jump when motion stops.
    // 工具栏在翻组开始时进入或退出休眠；轨道继续原动画，遮罩单独追随
    // 新胶囊的实际高度，避免先按完整工具栏遮住一大片、停止后再跳变。
    if (viewport.classList.contains("is-paging")) {
      applyMaskGeometry(
        viewport,
        resolvedMaskGeometry(viewport, pageRef.current, pageCount),
        CONTINUOUS_PAGE_SETTLE_MS,
      );
      return;
    }

    // Synchronize the group's updated snap offset when measurements change even if the anchor
    // remains in the same group.
    // 测量结果改变但锚点仍在同组时，也要同步该组新的真实吸附偏移。
    refreshLayout();
  }, [bottomMaskOffsets, pageCount, pageOffsets, refreshLayout, resolvedMaskGeometry, viewportRef]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!enabled || !viewport || !track) return;
    let frame = 0;
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refreshLayout);
    };
    // Height-tier changes use CSS transitions; completing React measurement does not mean the
    // actual cards have stopped resizing.
    // 高度档位变化带有 CSS 过渡。React 测量结束不代表真实卡片已经停止变化。
    const observer = new ResizeObserver(schedule);
    observer.observe(viewport);
    const toolbar = getBottomToolbar(viewport.closest("section")?.querySelector<HTMLElement>(".floating-switch") ?? null);
    if (toolbar) observer.observe(toolbar);
    track.querySelectorAll<HTMLElement>("[data-article-id]").forEach((card) => observer.observe(card));
    track.addEventListener("transitionend", schedule);
    track.addEventListener("transitioncancel", schedule);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      track.removeEventListener("transitionend", schedule);
      track.removeEventListener("transitioncancel", schedule);
    };
  }, [enabled, pageOffsets, refreshLayout, viewportRef]);

  return { viewportRef, trackRef, currentPage, settledPage, leadingArticleId, hasNextPage,
    focusedArticleIds: visiblePage?.page === currentPage ? visiblePage.articleIds : null,
    lastReadArticleId: visiblePage?.page === currentPage ? visiblePage.lastReadArticleId : null,
    suppressClickRef, repositionToPage, stepPage };
}
