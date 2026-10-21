import { ArrowUpToLine, CheckCheck, ChevronsRight, CornerLeftUp, Inbox, Menu, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getBottomToolbar } from "@/components/toolbarGeometry";
import { useListToolbarDismiss } from "../hooks/useListToolbarDismiss";
import { ToolbarAnchor } from "@/components/ToolbarAnchor";
import { FeedIcon } from "@/components/FeedIcon";
import { ReadStateIcon } from "@/components/ReadStateIcon";
import { SessionReadCountBadge, SessionStarredCountBadge, UnreadCountBadge } from "@/components/UnreadCountBadge";
import type { Article, ArticleCardLayout, ArticleMode, Feed, FeedFolder, LoadMoreReason, NextListTarget, SwipeMarkReadMode, ToolbarPosition } from "@/types";
import { useArticlePages, type ArticlePage } from "../hooks/useArticlePages";
import { useArticlePaging, type ForwardPageResolution } from "../hooks/useArticlePaging";
import { useListToolbarAutoCollapse } from "../hooks/useListToolbarAutoCollapse";
import { getArticleTextRects } from "../hooks/articleVisibility";
import { getReturnAnchor, getReturnVisibleArticleIds } from "../hooks/returnArticlePlacement";
import { ArticleCard } from "./ArticleCard";
import { useListDate } from "../hooks/useListDate";
import { shouldMarkAboveRead } from "../markReadAction";
import { unreadIdsThroughArticle } from "../contextMenu";
import { useArticleContextMenu } from "../hooks/useArticleContextMenu";
import { ArticleContextMenu, FeedReadConfirmation } from "./ArticleContextMenu";

/**
 * Inputs and interactive controls retain their own keyboard behavior.
 * 输入区域与交互控件保留自身按键行为。
 */
function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable], a, button, [role='button'], [data-native-horizontal-scroll]",
  ));
}

const EMPTY_PAGE: ArticlePage = {
  articles: [],
  startOffset: 0,
  contentHeight: 0,
  snapOffset: 0,
  bottomMaskOffset: 0,
};

type Props = {
  articles: Article[];
  feeds: Feed[];
  refreshKey: number;
  mode: ArticleMode;
  isStarredList: boolean;
  swipeMarkReadMode: SwipeMarkReadMode;
  toolbarPosition: ToolbarPosition;
  autoCollapsePaused: boolean;
  sidebarOpen: boolean;
  sideToolbarCollapsedRef: RefObject<boolean>;
  selectedFeed: Feed | null;
  selectedFolder: FeedFolder | null;
  folderFeeds: Feed[];
  feedUnreadCounts: Record<string, number>;
  feedReadMarkedAt: Record<string, number>;
  active: boolean;
  readingArticleId: string | null;
  returnHighlight: { id: string; sequence: number } | null;
  onReturnHighlightHandled: (sequence: number) => void;
  unreadCount: number;
  sessionReadCount: number;
  sessionStarredCount: number;
  nextListTarget: NextListTarget | null;
  previousListTarget: NextListTarget | null;
  canReopenReader: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  markAllReadScopeName: string;
  onModeChange: (mode: ArticleMode) => void;
  onSelectFeed: (feedId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onNextList: () => NextListTarget | null;
  onPreviousList: () => NextListTarget | null;
  onReopenReader: () => void;
  onLoadMore: (reason: LoadMoreReason) => Promise<void>;
  onRefreshList: () => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onMarkAboveRead: (ids: string[]) => Promise<void>;
  onMarkFeedRead: (feedId: string) => Promise<void>;
  onOpenSidebar: () => void;
  onOpenArticle: (id: string) => void;
  onOpenExternal: (url: string) => void;
  onMarkRead: (ids: string[]) => void;
  onToggleRead: (id: string) => void;
  onToggleStar: (id: string) => void;
};

/**
 * Prioritize feeds with unread articles; among them, show never-marked feeds first, then those
 * least recently marked as read.
 * 有未读的来源优先；其中从未标记已读、最久未标记已读的来源排在前面。
 */
function orderFolderFeeds(
  feeds: Feed[],
  unreadCounts: Readonly<Record<string, number>>,
  readMarkedAt: Readonly<Record<string, number>>,
): Feed[] {
  return feeds
    .map((feed, originalIndex) => ({ feed, originalIndex }))
    .sort((left, right) => {
      const leftUnread = unreadCounts[left.feed.id] ?? left.feed.unreadCount ?? 0;
      const rightUnread = unreadCounts[right.feed.id] ?? right.feed.unreadCount ?? 0;
      if ((leftUnread > 0) !== (rightUnread > 0)) return leftUnread > 0 ? -1 : 1;

      if (leftUnread > 0 && rightUnread > 0) {
        const leftMarkedAt = readMarkedAt[left.feed.id];
        const rightMarkedAt = readMarkedAt[right.feed.id];
        if ((leftMarkedAt === undefined) !== (rightMarkedAt === undefined)) {
          return leftMarkedAt === undefined ? -1 : 1;
        }
        if (leftMarkedAt !== undefined && rightMarkedAt !== undefined && leftMarkedAt !== rightMarkedAt) {
          return leftMarkedAt - rightMarkedAt;
        }
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ feed }) => feed);
}

/**
 * Manage scope navigation, page-group navigation, and continuation loading on the article list
 * page.
 * 文章列表页，负责列表范围导航、翻组和 continuation 加载更多。
 */
export function ArticleListPage(props: Props) {
  const listNow = useListDate();
  const markAboveRead = shouldMarkAboveRead(props.mode, props.swipeMarkReadMode);
  const feedHomepage = useMemo(() => {
    if (props.isStarredList || !props.selectedFeed?.siteUrl) return undefined;
    try {
      const url = new URL(props.selectedFeed.siteUrl);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  }, [props.isStarredList, props.selectedFeed?.siteUrl]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const markReadPopoverRef = useRef<HTMLDivElement>(null);
  const markReadTriggerRef = useRef<HTMLButtonElement>(null);
  const markReadConfirmationPageRef = useRef(0);
  const sourceNavigationRef = useRef<HTMLElement>(null);
  const listScopeKey = `${props.isStarredList ? "starred" : "reading"}:${props.mode}:${props.selectedFolder?.id ?? "all-folders"}:${props.selectedFeed?.id ?? "all-feeds"}`;
  const listKey = `${listScopeKey}:${props.refreshKey}`;
  const [bottomToolbarDimmed, setBottomToolbarDimmed] = useState(false);
  const [sideToolbarCollapsed, setSideToolbarCollapsed] = useState(() => props.sideToolbarCollapsedRef.current);
  const switchDimmed = props.toolbarPosition === "bottom" ? bottomToolbarDimmed : sideToolbarCollapsed;
  const setSwitchDimmed = useCallback((collapsed: boolean) => {
    if (props.toolbarPosition === "bottom") setBottomToolbarDimmed(collapsed);
    else {
      props.sideToolbarCollapsedRef.current = collapsed;
      setSideToolbarCollapsed(collapsed);
    }
  }, [props.toolbarPosition, props.sideToolbarCollapsedRef]);
  const toolbarNavigationOriginRef = useRef<{
    listKey: string; scopeKey: string; position: ToolbarPosition; reason: "navigation" | "confirmation" | "header";
  } | null>(null);
  const [articleNumbersVisible, setArticleNumbersVisible] = useState(false);
  const [highlightCue, setHighlightCue] = useState<{ id: string; sequence: number; listKey: string } | null>(null);
  const [returnSelection, setReturnSelection] = useState<{
    id: string; sequence: number; listKey: string; phase: "reading" | "holding" | "releasing";
  } | null>(null);
  const finishReturnHighlight = useCallback((sequence: number) => {
    setReturnSelection((selection) => selection?.sequence === sequence ? null : selection);
  }, []);
  const readingArticleId = props.readingArticleId;
  const visibleReturnSelection = props.active && returnSelection?.listKey === listKey
    && props.articles.some((article) => article.id === returnSelection.id) ? returnSelection : null;
  const hoverLocked = Boolean(readingArticleId || visibleReturnSelection || (props.active && props.returnHighlight));
  const returnRouteRef = useRef(false);
  const returnedPageIdsRef = useRef(new Map<number, string[]>());
  const handledReturnSequenceRef = useRef(0);
  const [toolbarNotice, setToolbarNotice] = useState("");
  const [refreshingList, setRefreshingList] = useState(false);
  const [markReadConfirmationOpen, setMarkReadConfirmationOpen] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const [confirmFeed, setConfirmFeed] = useState<{ id: string; name: string } | null>(null);
  const [markingFeed, setMarkingFeed] = useState(false);
  const markingFeedRef = useRef(false);
  const [feedReadError, setFeedReadError] = useState("");
  const contextEnabled = props.active && !props.sidebarOpen && !props.autoCollapsePaused
    && !hoverLocked && !markReadConfirmationOpen && !markingRead && !confirmFeed && !refreshingList;
  const contextMenu = useArticleContextMenu(contextEnabled, listKey);
  const contextArticle = contextMenu.menu ? props.articles.find((article) => article.id === contextMenu.menu!.articleId) : undefined;
  const contextAboveIds = contextArticle ? unreadIdsThroughArticle(props.articles, contextArticle.id) : [];
  useEffect(() => {
    setConfirmFeed(null);
    setFeedReadError("");
  }, [listKey, props.active, props.sidebarOpen]);
  const markReadSubmittingRef = useRef(false);
  const [markReadError, setMarkReadError] = useState("");
  const [pendingAboveReadIds, setPendingAboveReadIds] = useState<string[]>([]);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [articleLayouts, setArticleLayouts] = useState<Record<string, ArticleCardLayout>>({});
  const [orderedFolderFeedIds, setOrderedFolderFeedIds] = useState<string[]>([]);
  const [sourceNavigationDragging, setSourceNavigationDragging] = useState(false);
  const sourceOrderContextRef = useRef({ listKey: "", active: false });
  const sourceMouseDragRef = useRef({ pointerId: -1, startX: 0, startScrollLeft: 0, dragging: false });
  const suppressSourceClickRef = useRef(false);
  const feedsById = useMemo(() => new Map(props.feeds.map((feed) => [feed.id, feed])), [props.feeds]);
  const collapseSideToolbar = useCallback(() => setSwitchDimmed(true), [setSwitchDimmed]);
  const { bumpActivity: bumpToolbarActivity } = useListToolbarAutoCollapse(
    toolbarRef, props.active && props.toolbarPosition !== "bottom" && !switchDimmed,
    props.autoCollapsePaused || props.sidebarOpen || refreshingList || markReadConfirmationOpen || markingRead || Boolean(contextMenu.menu) || Boolean(confirmFeed),
    collapseSideToolbar,
  );
  const wakeListToolbar = useCallback(() => {
    bumpToolbarActivity();
    setSwitchDimmed(false);
  }, [bumpToolbarActivity, setSwitchDimmed]);
  const previousListActiveRef = useRef(props.active);
  useEffect(() => {
    const returnedToList = !previousListActiveRef.current && props.active;
    previousListActiveRef.current = props.active;
    if (returnedToList && props.toolbarPosition !== "bottom" && !switchDimmed) bumpToolbarActivity();
  }, [props.active, props.toolbarPosition, switchDimmed, bumpToolbarActivity]);


  useLayoutEffect(() => {
    const previous = sourceOrderContextRef.current;
    const contextChanged = previous.listKey !== listKey;
    const becameActive = !previous.active && props.active;
    sourceOrderContextRef.current = { listKey, active: props.active };

    if (!props.selectedFolder || props.selectedFeed) return;
    // Update order in advance while hidden; reorder a visible list only when entering a scope or
    // returning from the reader.
    // 隐藏期间可预先更新；可见列表只在进入范围或从正文返回时换序。
    if (props.active && !contextChanged && !becameActive) return;

    const nextIds = orderFolderFeeds(
      props.folderFeeds,
      props.feedUnreadCounts,
      props.feedReadMarkedAt,
    ).map((feed) => feed.id);
    setOrderedFolderFeedIds((current) => (
      current.length === nextIds.length && current.every((feedId, index) => feedId === nextIds[index])
        ? current
        : nextIds
    ));
  }, [listKey, props.active, props.feedReadMarkedAt, props.feedUnreadCounts, props.folderFeeds, props.selectedFeed, props.selectedFolder]);

  const orderedFolderFeeds = useMemo(() => {
    const feedsById = new Map(props.folderFeeds.map((feed) => [feed.id, feed]));
    const ordered = orderedFolderFeedIds.flatMap((feedId) => feedsById.get(feedId) ?? []);
    const orderedIdSet = new Set(ordered.map((feed) => feed.id));
    const remaining = orderFolderFeeds(
      props.folderFeeds.filter((feed) => !orderedIdSet.has(feed.id)),
      props.feedUnreadCounts,
      props.feedReadMarkedAt,
    );
    return [...ordered, ...remaining];
  }, [orderedFolderFeedIds, props.feedReadMarkedAt, props.feedUnreadCounts, props.folderFeeds]);

  useLayoutEffect(() => {
    // Return to the queue's start when the new order takes effect so the highest-priority feed is
    // immediately visible.
    // 新顺序生效时回到队列起点，确保最高优先级来源立即可见。
    if (sourceNavigationRef.current) sourceNavigationRef.current.scrollLeft = 0;
  }, [listKey, orderedFolderFeedIds]);

  useEffect(() => {
    /**
     * Take over mouse dragging only after it exceeds the threshold; retain native scrolling for
     * touch and trackpad input.
     * 鼠标拖动超过阈值后才接管，触摸与触控板仍使用浏览器原生滚动。
     */
    const moveSourceNavigation = (event: PointerEvent) => {
      const drag = sourceMouseDragRef.current;
      const navigation = sourceNavigationRef.current;
      if (!navigation || event.pointerId !== drag.pointerId) return;

      const offset = event.clientX - drag.startX;
      if (!drag.dragging && Math.abs(offset) < 6) return;
      if (!drag.dragging) {
        drag.dragging = true;
        suppressSourceClickRef.current = true;
        setSourceNavigationDragging(true);
        window.getSelection()?.removeAllRanges();
      }

      event.preventDefault();
      navigation.scrollLeft = drag.startScrollLeft - offset;
    };

    const finishSourceNavigationDrag = (event: PointerEvent) => {
      const drag = sourceMouseDragRef.current;
      if (event.pointerId !== drag.pointerId) return;

      const wasDragging = drag.dragging;
      drag.pointerId = -1;
      drag.dragging = false;
      if (!wasDragging) return;

      setSourceNavigationDragging(false);
      // A synthetic click follows pointerup immediately; release suppression in the next task.
      // 合成 click 会紧随 pointerup 到达，下一任务再解除抑制。
      window.setTimeout(() => { suppressSourceClickRef.current = false; }, 0);
    };

    window.addEventListener("pointermove", moveSourceNavigation, { passive: false });
    window.addEventListener("pointerup", finishSourceNavigationDrag);
    window.addEventListener("pointercancel", finishSourceNavigationDrag);
    return () => {
      window.removeEventListener("pointermove", moveSourceNavigation);
      window.removeEventListener("pointerup", finishSourceNavigationDrag);
      window.removeEventListener("pointercancel", finishSourceNavigationDrag);
    };
  }, []);

  /**
   * Save article measurements without creating a new object for unchanged layouts, avoiding
   * repeated pagination.
   * 保存文章测量结果；相同布局不创建新对象，避免引发重复分页。
   */
  const recordArticleLayout = useCallback((articleId: string, layout: ArticleCardLayout) => {
    setArticleLayouts((current) => {
      const previous = current[articleId];
      if (previous?.heightClass === layout.heightClass && previous.titleFitsOneLine === layout.titleFitsOneLine) return current;
      return { ...current, [articleId]: layout };
    });
  }, []);

  const pages = useArticlePages(viewportRef, props.articles, articleLayouts);
  const safePages = pages.length ? pages : [EMPTY_PAGE];
  const pageOffsets = useMemo(
    () => safePages.map((page) => page.snapOffset),
    [safePages],
  );
  const bottomMaskOffsets = useMemo(
    () => safePages.map((page) => page.bottomMaskOffset),
    [safePages],
  );
  /**
   * Determine the next screen's first article from the actual view. Repeat the last article if the
   * opaque toolbar obscures half a line; ignore an untouched dormant toolbar. Do not use the precomputed
   * group's last article, which may be wrong after repositioning.
   *
   * 从当前真实画面计算下一屏首篇：不透明工具栏遮住末篇半行时重复它，
   * 未交互的休眠工具栏不算遮挡。不能用静态分组末篇，避免重复置顶后错位。
   */
  const resolveForwardPageStart = useCallback((): ForwardPageResolution => {
    const toolbar = toolbarRef.current;
    const viewport = viewportRef.current;
    if (!toolbar || !viewport) return { kind: "unavailable" };

    const cards = Array.from(viewport.querySelectorAll<HTMLElement>("[data-article-id]"));
    const bottomMask = viewport.querySelector<HTMLElement>(".article-edge-control.next");
    const topMask = viewport.querySelector<HTMLElement>(".article-edge-control.previous");
    if (!cards.length || !bottomMask || !topMask) return { kind: "unavailable" };

    const focusTop = topMask.getBoundingClientRect().bottom;
    const focusBottom = bottomMask.getBoundingClientRect().top;

    // An article counts as focused on this screen only when at least half a text line lies between
    // the two masks.
    // 至少有半行文字落在两块遮罩之间，才算这一屏真正聚焦过的文章。
    let candidateIndex = -1;
    let candidateRects: DOMRect[] = [];
    cards.forEach((card, index) => {
      const bounds = card.getBoundingClientRect();
      if (bounds.top >= focusBottom || bounds.bottom <= focusTop) return;
      const rects = getArticleTextRects(card);
      const hasReadableLine = rects.some((lineRect) => {
        const visibleHeight = Math.min(lineRect.bottom, focusBottom)
          - Math.max(lineRect.top, focusTop);
        return visibleHeight >= Math.max(10, lineRect.height * 0.5);
      });
      if (hasReadableLine) {
        candidateIndex = index;
        candidateRects = rects;
      }
    });
    if (candidateIndex < 0) return { kind: "unavailable" };

    const resolveArticle = (articleId: string | undefined): ForwardPageResolution => (
      articleId ? { kind: "anchor", articleId } : { kind: "end" }
    );

    // Ignore an untouched dormant toolbar as an obstruction; use its actual rectangle again on
    // hover or keyboard focus.
    // 未交互的休眠工具栏不算遮挡；悬停或键盘聚焦时恢复按真实矩形判断。
    const toolbarIsPassive = toolbar.classList.contains("dimmed")
      && !toolbar.matches(":hover, :focus-within");
    if (!getBottomToolbar(toolbar) || toolbarIsPassive) {
      return resolveArticle(cards[candidateIndex + 1]?.dataset.articleId);
    }

    const toolbarRect = toolbar.getBoundingClientRect();
    // Capsule corners are not fully filled; inset the horizontal bounds slightly when checking text
    // overlap.
    // 胶囊圆角处不是完整填充区，左右略微内收后再判断真实文字交叠。
    const opaqueLeft = toolbarRect.left + 8;
    const opaqueRight = toolbarRect.right - 8;
    for (const lineRect of candidateRects) {
      const overlapWidth = Math.min(lineRect.right, opaqueRight)
        - Math.max(lineRect.left, opaqueLeft);
      const overlapHeight = Math.min(lineRect.bottom, toolbarRect.bottom)
        - Math.max(lineRect.top, toolbarRect.top);
      const halfLineThreshold = Math.max(10, lineRect.height * 0.5);
      if (overlapWidth >= 12 && overlapHeight >= halfLineThreshold) {
        return resolveArticle(cards[candidateIndex]?.dataset.articleId);
      }
    }

    return resolveArticle(cards[candidateIndex + 1]?.dataset.articleId);
  }, []);
  const handlePageDirection = useCallback((direction: 1 | -1) => {
    setSwitchDimmed(props.toolbarPosition !== "bottom" || direction > 0);
    if (props.toolbarPosition !== "bottom" && !markingRead) setMarkReadConfirmationOpen(false);
    // Only vertical paging confirmed by the pager interrupts highlighting; ignore horizontal return
    // momentum and minor jitter. Use functional state updates to keep callbacks stable and avoid
    // rebuilding paging listeners when the highlight phase changes.
    // 仅由分页器确认的纵向翻页打断高亮；横向返回惯性和微小抖动不参与。
    // 使用函数式更新保持回调稳定，避免高亮阶段变化重建分页监听器。
    setHighlightCue(null);
    setReturnSelection((selection) => selection && selection.phase !== "releasing"
      ? { ...selection, phase: "releasing" } : selection);
  }, [props.toolbarPosition, setSwitchDimmed, markingRead]);
  const requestContextMenu = useCallback((articleId: string, x: number, y: number): boolean => {
    if (!contextEnabled || viewportRef.current?.classList.contains("is-paging")) return false;
    const card = Array.from(viewportRef.current?.querySelectorAll<HTMLElement>(".article-card") ?? [])
      .find((element) => element.dataset.articleId === articleId);
    if (!card || card.inert || card.closest("[inert]")) return false;
    if (props.toolbarPosition !== "bottom" && !switchDimmed) {
      collapseSideToolbar();
      return true;
    }
    contextMenu.open(articleId, x, y);
    return true;
  }, [contextEnabled, props.toolbarPosition, switchDimmed, collapseSideToolbar, contextMenu.open]);
  const { trackRef, currentPage, settledPage, leadingArticleId, hasNextPage, focusedArticleIds, lastReadArticleId, suppressClickRef, repositionToPage, stepPage } = useArticlePaging(viewportRef, pageOffsets, bottomMaskOffsets, listKey, handlePageDirection, resolveForwardPageStart, props.articles.length > 0, {
    enabled: contextEnabled, onLongPress: requestContextMenu, onPagingStart: contextMenu.close,
  });
  /**
   * Replace the precomputed group start with the actual first article so current-group actions match the
   * articles in focus.
   * 用真实首篇替换静态分组起点，使当前组操作与屏幕中的聚焦文章一致。
   */
  const resolvePageArticles = useCallback((pageIndex: number, pageStartArticleId: string | null) => {
    const returnedIds = returnRouteRef.current ? returnedPageIdsRef.current.get(pageIndex) : undefined;
    if (returnedIds) {
      const ids = new Set(returnedIds);
      return props.articles.filter((article) => ids.has(article.id));
    }
    const nominalArticles = safePages[pageIndex]?.articles ?? [];
    if (!pageStartArticleId || nominalArticles[0]?.id === pageStartArticleId) return nominalArticles;

    const startIndex = props.articles.findIndex((article) => article.id === pageStartArticleId);
    if (startIndex < 0) return nominalArticles;
    return pageIndex >= safePages.length - 1
      ? props.articles.slice(startIndex)
      : props.articles.slice(startIndex, startIndex + nominalArticles.length);
  }, [props.articles, safePages]);
  const pageIsSettled = currentPage === settledPage;
  const currentPageArticles = useMemo(() => {
    if (!pageIsSettled || focusedArticleIds === null) return resolvePageArticles(currentPage, leadingArticleId);
    const ids = new Set(focusedArticleIds);
    return props.articles.filter((article) => ids.has(article.id));
  }, [currentPage, focusedArticleIds, leadingArticleId, pageIsSettled, props.articles, resolvePageArticles]);
  /**
   * The Read Above boundary ends at the last article on the current full screen, excluding the
   * translucent next-screen preview below.
   * “上方已读”的边界固定在当前完整屏末篇，不包含底部半透明的下一屏预览。
   */
  const aboveUnreadArticleIds = useMemo(() => {
    if (!pageIsSettled) return [];
    const currentPageLastId = lastReadArticleId;
    const currentPageLastIndex = currentPageLastId
      ? props.articles.findIndex((article) => article.id === currentPageLastId)
      : -1;
    if (currentPageLastIndex < 0) return [];
    return props.articles
      .slice(0, currentPageLastIndex + 1)
      .filter((article) => !article.isRead)
      .map((article) => article.id);
  }, [lastReadArticleId, pageIsSettled, props.articles]);
  const closeMarkReadConfirmation = useCallback(() => {
    if (markingRead) return;
    setMarkReadConfirmationOpen(false);
    setMarkReadError("");
    setPendingAboveReadIds([]);
  }, [markingRead]);
  useListToolbarDismiss({
    toolbarRef, popoverRef: markReadPopoverRef,
    enabled: props.active && !props.autoCollapsePaused && !props.sidebarOpen && !contextMenu.menu && !confirmFeed && props.toolbarPosition !== "bottom",
    expanded: !switchDimmed, confirmationOpen: markReadConfirmationOpen, submitting: markingRead,
    collapse: collapseSideToolbar, closeConfirmation: closeMarkReadConfirmation,
  });
  useEffect(() => {
    if (props.toolbarPosition !== "bottom" && props.sidebarOpen) closeMarkReadConfirmation();
  }, [props.sidebarOpen, props.toolbarPosition, closeMarkReadConfirmation]);
  const previousPageRef = useRef(currentPage);
  const previousLeadingArticleIdRef = useRef(leadingArticleId);
  const previousLayoutRef = useRef({ listKey, pages: safePages });
  const layoutRepositionTargetRef = useRef<number | null>(null);
  const prefetchContextRef = useRef(listKey);
  const loadAttemptPageRef = useRef<string | null>(null);
  const localLoadInFlightRef = useRef(false);

  /**
   * Move one group when clicking an edge-mask hot zone; ignore synthetic clicks generated by
   * dragging.
   * 点击边缘遮罩热区时只翻动一组；拖动结束产生的合成 click 会被忽略。
   */
  const activateAdjacentPage = (direction: 1 | -1) => {
    if (suppressClickRef.current) return;
    stepPage(direction);
  };

  /**
   * Share automatic preloading and manual end-of-list retries. A local synchronous lock covers the
   * gap before the parent's loading state takes effect, preventing duplicate continuation requests
   * from one gesture or rapid clicks. Automatic failures only update the end state without a global
   * notification.
   *
   * 统一执行自动预加载和末尾手动重试。
   *
   * 本地同步锁覆盖父组件 loading 状态生效前的短窗口，避免一次手势或快速
   * 点击提交两个相同 continuation。自动失败只改变末尾状态，不弹全局提示。
   */
  const requestMoreArticles = useCallback(async (reason: LoadMoreReason) => {
    if (!props.hasMore || props.loadingMore || localLoadInFlightRef.current) return;

    localLoadInFlightRef.current = true;
    try {
      await props.onLoadMore(reason);
      setLoadMoreFailed(false);
    } catch {
      setLoadMoreFailed(true);
      if (reason === "manual") setToolbarNotice("加载失败，请点击重试");
    } finally {
      localLoadInFlightRef.current = false;
    }
  }, [props.hasMore, props.loadingMore, props.onLoadMore]);

  useLayoutEffect(() => {
    const previousLayout = previousLayoutRef.current;

    if (previousLayout.listKey !== listKey) {
      // Start a new scope from its first group so the previous scope's page cannot flash in the
      // first frame.
      // 新范围总是从第一组开始，避免旧范围页码在首帧短暂露出。
      if (currentPage !== 0) layoutRepositionTargetRef.current = 0;
      repositionToPage(0);
      previousLayoutRef.current = { listKey, pages: safePages };
      return;
    }

    // After regrouping for height-tier or viewport changes, continue showing the original page's
    // first article.
    // 高度档位或视口变化导致重新分组时，继续显示原页面的第一篇文章。
    const anchorArticleId = previousLayout.pages[currentPage]?.articles[0]?.id;
    if (anchorArticleId) {
      const anchoredPage = safePages.findIndex((page) =>
        page.articles.some((article) => article.id === anchorArticleId));
      if (anchoredPage >= 0 && anchoredPage !== currentPage) {
        layoutRepositionTargetRef.current = anchoredPage;
        repositionToPage(anchoredPage);
      }
    }
    previousLayoutRef.current = { listKey, pages: safePages };
  }, [currentPage, listKey, repositionToPage, safePages]);

  // App consumes each return event once; remounting the list must not replay old notifications.
  // 返回事件由 App 消费一次，列表重新挂载不会再播放旧提示。
  useLayoutEffect(() => {
    const cue = props.returnHighlight;
    if (!props.active || !cue || handledReturnSequenceRef.current === cue.sequence) return;
    handledReturnSequenceRef.current = cue.sequence;
    setReturnSelection({ ...cue, listKey, phase: "reading" });
    setHighlightCue({ ...cue, listKey });
    props.onReturnHighlightHandled(cue.sequence);
  }, [props.active, props.returnHighlight, props.onReturnHighlightHandled, listKey]);

  useEffect(() => {
    if (!highlightCue) return;
    if (!props.active || highlightCue.listKey !== listKey) {
      setReturnSelection(null);
      setHighlightCue(null);
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;
    let frame = 0;
    let cancelled = false;
    let previousGeometry = "";
    let stableFrames = 0;
    let positioned = false;
    const cancel = () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      setReturnSelection(null);
      setHighlightCue(null);
    };
    const prepare = () => {
      if (cancelled) return;
      const card = Array.from(viewport.querySelectorAll<HTMLElement>("[data-article-id]"))
        .find((element) => element.dataset.articleId === highlightCue.id);
      if (!card) { cancel(); return; }
      const reader = viewport.closest("main")?.querySelector(".reader-panel")
        ?? viewport.closest("#root")?.querySelector(".reader-panel");
      const toolbarBounds = toolbarRef.current?.getBoundingClientRect();
      const geometry = `${viewport.clientHeight}:${toolbarBounds?.top}:${toolbarBounds?.height}:` +
        Array.from(viewport.querySelectorAll<HTMLElement>("[data-article-id]"))
          .map((element) => `${element.offsetTop}:${element.offsetHeight}`).join(",");
      stableFrames = geometry === previousGeometry ? stableFrames + 1 : 0;
      previousGeometry = geometry;
      if (stableFrames < 2 || viewport.classList.contains("is-paging")) {
        frame = window.requestAnimationFrame(prepare);
        return;
      }
      if (!positioned) {
        let page = currentPage;
        if (card.inert || !getReturnVisibleArticleIds(viewport, toolbarRef.current).includes(highlightCue.id)) {
          const anchorId = getReturnAnchor(viewport, toolbarRef.current, highlightCue.id);
          if (!anchorId) { cancel(); return; }
          page = safePages.findIndex((group) => group.articles.some((article) => article.id === anchorId));
          // Keep access to the previous screen for a non-first article even if it still belongs to
          // the first precomputed group.
          // 非首篇需要保留“上一屏”的入口，即使它仍属于静态第一组。
          if (page === 0 && anchorId !== props.articles[0]?.id) page = Math.min(1, safePages.length - 1);
          layoutRepositionTargetRef.current = page;
          page = repositionToPage(page, anchorId);
          // Resolve the actual return page using the new route; it may differ from the precomputed group
          // index.
          // 实际返回页码由新路线决定，不一定等于静态分组页码。
          layoutRepositionTargetRef.current = page;
          returnRouteRef.current = true;
          returnedPageIdsRef.current.clear();
        }
        positioned = true;
      }
      const readerGone = !reader || reader.getBoundingClientRect().left >= viewport.getBoundingClientRect().right - 1;
      const exitTransition = reader?.getAnimations().find((animation) =>
        "transitionProperty" in animation && animation.transitionProperty === "transform");
      const elapsed = exitTransition?.currentTime;
      const duration = exitTransition?.effect?.getComputedTiming().duration;
      // Time the actual exit animation, using its remaining duration after touch release. If there
      // is no exit animation or reduced motion is enabled, start the hold timer as soon as the
      // panel exits.
      // 按实际退场动画的时间进度计时；触摸松手后的剩余动画也使用自身时长。
      // 无退场动画或减少动态效果时，面板退出即可开始保持计时。
      const exitIsLate = typeof elapsed === "number" && typeof duration === "number"
        && elapsed >= duration * 0.65;
      // Start the 400ms steady highlight hold once positioning is stable and the reader exit
      // reaches 65%.
      // 定位稳定且正文退场达到 65% 后，开始 400ms 常亮保持计时。
      if (!readerGone && !exitIsLate) {
        frame = window.requestAnimationFrame(prepare);
        return;
      }
      setReturnSelection((selection) => selection?.sequence === highlightCue.sequence && selection.phase === "reading"
        ? { ...selection, phase: "holding" } : selection);
      setHighlightCue(null);
    };
    frame = window.requestAnimationFrame(prepare);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [highlightCue, props.active, listKey, currentPage, safePages, repositionToPage, props.articles]);

  // Discard the old lifecycle immediately when reading or entering a new scope; data updates do not
  // restart the timer.
  // 阅读时与新列表范围立即丢弃旧生命周期；数据回写不重启计时。
  useLayoutEffect(() => {
    if (!props.active || (returnSelection && (returnSelection.listKey !== listKey
      || !props.articles.some((article) => article.id === returnSelection.id)))) {
      setReturnSelection(null);
      setHighlightCue(null);
    }
  }, [props.active, listKey, props.articles, returnSelection]);

  useEffect(() => {
    if (!returnSelection || returnSelection.phase === "reading") return;
    const { sequence, phase } = returnSelection;
    const timer = window.setTimeout(() => {
      if (phase === "holding") {
        setReturnSelection((selection) => selection?.sequence === sequence
          ? { ...selection, phase: "releasing" } : selection);
      } else finishReturnHighlight(sequence); // Prefer the ordinary hover-out transition's completion event; use the timer only as a
      // fallback.
      // 普通 Hover 移出过渡结束事件优先，计时器仅作兜底。
    }, phase === "holding" ? 400 : 320);
    return () => window.clearTimeout(timer);
  }, [returnSelection, finishReturnHighlight]);

  useLayoutEffect(() => {
    if (returnRouteRef.current && pageIsSettled && focusedArticleIds !== null) {
      returnedPageIdsRef.current.set(currentPage, focusedArticleIds);
    }
  }, [currentPage, focusedArticleIds, pageIsSettled]);
  useLayoutEffect(() => {
    returnRouteRef.current = false;
    returnedPageIdsRef.current.clear();
  }, [listKey]);

  useEffect(() => {
    const origin = toolbarNavigationOriginRef.current;
    toolbarNavigationOriginRef.current = null;
    // The original navigation flag preserves only the bottom toolbar's behavior.
    // 原来的导航标记仅用于保留底部工具栏行为。
    const preserveExpandedToolbar = origin !== null && origin.listKey !== listKey
      && origin.position === props.toolbarPosition
      && (origin.reason !== "confirmation" || origin.scopeKey === listScopeKey);
    bumpToolbarActivity();
    // All side navigation inherits session state; the bottom toolbar retains the original reset
    // rules.
    // 侧边所有导航继承会话状态；底部工具栏仍采用原来的重置规则。
    if (props.toolbarPosition === "bottom" && !preserveExpandedToolbar) setSwitchDimmed(false);
    setToolbarNotice("");
    setMarkReadConfirmationOpen(false);
    setMarkReadError("");
    setPendingAboveReadIds([]);
  }, [listKey, listScopeKey, props.toolbarPosition, bumpToolbarActivity, setSwitchDimmed]);
  useEffect(() => {
    // Let a list refresh in the same commit consume the preservation flag first; clear it after
    // failure or no refresh so it cannot affect later actions.
    // 同一提交中的列表刷新先消费保留标记；失败或未刷新时再清除，避免影响后续操作。
    if (!markingRead && toolbarNavigationOriginRef.current?.reason === "confirmation") {
      toolbarNavigationOriginRef.current = null;
    }
  }, [markingRead]);
  useEffect(() => {
    if (!markReadConfirmationOpen) return;
    markReadPopoverRef.current?.focus({ preventScroll: true });
    const viewport = viewportRef.current;

    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (props.toolbarPosition !== "bottom" || !(target instanceof Node)) return;
      if (markReadPopoverRef.current?.contains(target) || markReadTriggerRef.current?.contains(target)) return;
      closeMarkReadConfirmation();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (props.toolbarPosition !== "bottom") event.stopPropagation();
      closeMarkReadConfirmation();
      markReadTriggerRef.current?.focus({ preventScroll: true });
    };
    const dismissOnPagingGesture = () => { if (props.toolbarPosition === "bottom") closeMarkReadConfirmation(); };

    document.addEventListener("pointerdown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    viewport?.addEventListener("wheel", dismissOnPagingGesture, { passive: true });
    viewport?.addEventListener("touchmove", dismissOnPagingGesture, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
      viewport?.removeEventListener("wheel", dismissOnPagingGesture);
      viewport?.removeEventListener("touchmove", dismissOnPagingGesture);
    };
  }, [closeMarkReadConfirmation, markReadConfirmationOpen, props.toolbarPosition]);
  useEffect(() => {
    if (!markReadConfirmationOpen || markingRead) return;
    if (currentPage === markReadConfirmationPageRef.current) return;
    closeMarkReadConfirmation();
  }, [closeMarkReadConfirmation, currentPage, markReadConfirmationOpen, markingRead]);
  useEffect(() => {
    // Failures and preload records from the old scope must stop applying after switching scopes.
    // 切换列表范围后，旧范围的失败和预加载记录不应继续生效。
    if (prefetchContextRef.current === listKey) return;
    prefetchContextRef.current = listKey;
    loadAttemptPageRef.current = null;
    localLoadInFlightRef.current = false;
    setLoadMoreFailed(false);
  }, [listKey]);
  useEffect(() => {
    const previousPage = previousPageRef.current;
    const previousLeadingArticleId = previousLeadingArticleIdRef.current;
    previousPageRef.current = currentPage;
    previousLeadingArticleIdRef.current = leadingArticleId;
    if (layoutRepositionTargetRef.current === currentPage) {
      // Responsive regrouping is not a user swipe down and must not trigger marking the previous
      // group as read.
      // 响应式重新分组不是用户下滑，不能误触发“上一组全部已读”。
      layoutRepositionTargetRef.current = null;
      return;
    }
    const markOnSwipe = props.swipeMarkReadMode === "both" || props.swipeMarkReadMode === props.mode;
    if (!markOnSwipe || currentPage <= previousPage) return;
    const previousPageIds = resolvePageArticles(previousPage, previousLeadingArticleId)
      .map((article) => article.id)
      .filter((articleId) => articleId !== leadingArticleId);
    if (previousPageIds.length) props.onMarkRead(previousPageIds);
  }, [currentPage, leadingArticleId, props.mode, props.swipeMarkReadMode, props.onMarkRead, resolvePageArticles]);
  useEffect(() => {
    if (!toolbarNotice) return;
    const timer = window.setTimeout(() => setToolbarNotice(""), 1600);
    return () => window.clearTimeout(timer);
  }, [toolbarNotice]);
  useEffect(() => {
    // Preload only after the user has moved down at least one group and at most two groups remain
    // after the current group.
    // 只在用户至少向下翻过一组、且当前组之后最多剩两组时预加载。
    if (prefetchContextRef.current !== listKey || currentPage <= 0) return;
    if (!props.hasMore || props.loadingMore || loadMoreFailed) return;

    const lastVisibleIndex = props.articles.findIndex((article) => article.id === currentPageArticles.at(-1)?.id);
    // Return positioning produces different page indices from precomputed grouping; estimate preload
    // distance from articles after the current screen.
    // 返回定位生成的页码与静态分组不同，按当前屏之后的文章估算预加载距离。
    const remainingPages = returnRouteRef.current && lastVisibleIndex >= 0
      ? Math.ceil((props.articles.length - lastVisibleIndex - 1) / Math.max(1, currentPageArticles.length))
      : safePages.length - currentPage - 1;
    if (remainingPages < 0 || remainingPages > 2) return;

    // Automatically trigger at most once per group within a scope; appending data must not
    // recursively load another page in place.
    // 同一范围的同一组最多自动触发一次；追加数据不会在原地递归加载下一页。
    const attemptKey = `${listKey}:${currentPage}`;
    if (loadAttemptPageRef.current === attemptKey) return;
    loadAttemptPageRef.current = attemptKey;
    void requestMoreArticles("prefetch");
  }, [currentPage, listKey, loadMoreFailed, props.hasMore, props.loadingMore, requestMoreArticles, safePages.length, currentPageArticles, props.articles]);

  /**
   * When the toolbar is dormant, the first action only wakes it; the second actually switches list
   * mode.
   * 工具栏休眠时第一次操作只唤醒，第二次才真正切换列表模式。
   */
  const selectMode = (mode: ArticleMode) => {
    if (switchDimmed) { wakeListToolbar(); return; }
    bumpToolbarActivity();
    if (mode !== props.mode && props.toolbarPosition !== "bottom") {
      toolbarNavigationOriginRef.current = { listKey, scopeKey: listScopeKey, position: props.toolbarPosition, reason: "navigation" };
    }
    props.onModeChange(mode);
  };
  /**
   * The header is independent of toolbar dormancy; one click switches mode directly while
   * preserving toolbar state.
   * Header 独立于工具栏休眠状态，一次点击直接切换并保留工具栏状态。
   */
  const toggleHeaderMode = () => {
    toolbarNavigationOriginRef.current = { listKey, scopeKey: listScopeKey, position: props.toolbarPosition, reason: "header" };
    props.onModeChange(props.mode === "all" ? "unread" : "all");
  };
  /**
   * Reuse the same accidental-touch protection for toolbar actions without arguments.
   * 为不带参数的工具栏动作复用同一套防误触规则。
   */
  const runToolbarAction = (action: () => void) => {
    if (switchDimmed) { wakeListToolbar(); return; }
    bumpToolbarActivity();
    action();
  };
  /**
   * Open in-app confirmation; Read Above freezes the current screen boundary so the scope cannot
   * drift during confirmation.
   * 打开应用内确认层；上方已读会冻结当前屏边界，避免确认期间范围漂移。
   */
  const requestMarkRead = () => {
    if (markingRead) return;
    if (markReadConfirmationOpen) {
      closeMarkReadConfirmation();
      return;
    }
    if (markAboveRead) {
      if (!pageIsSettled) return;
      if (!aboveUnreadArticleIds.length) {
        setToolbarNotice("当前屏及上方没有未读文章");
        return;
      }
      setPendingAboveReadIds(aboveUnreadArticleIds);
    } else {
      setPendingAboveReadIds([]);
    }
    setToolbarNotice("");
    setMarkReadError("");
    markReadConfirmationPageRef.current = currentPage;
    bumpToolbarActivity();
    setMarkReadConfirmationOpen(true);
  };
  /**
   * Mark All handles the full scope; Read Above submits only the exact article IDs through the
   * current screen's last article.
   * 全部已读处理整个范围；上方已读只提交当前屏末篇之前的精确 ID。
   */
  const confirmMarkRead = async () => {
    if (markReadSubmittingRef.current) return;
    markReadSubmittingRef.current = true;
    setMarkReadError("");
    setMarkingRead(true);
    const origin = props.toolbarPosition !== "bottom"
      ? { listKey, scopeKey: listScopeKey, position: props.toolbarPosition, reason: "confirmation" as const }
      : null;
    if (origin) toolbarNavigationOriginRef.current = origin;
    try {
      if (markAboveRead) {
        await props.onMarkAboveRead(pendingAboveReadIds);
        setToolbarNotice(`当前屏及上方 ${pendingAboveReadIds.length} 篇已标记为已读`);
      } else {
        await props.onMarkAllRead();
        setToolbarNotice("当前列表已全部标记为已读");
      }
      setMarkReadConfirmationOpen(false);
      setPendingAboveReadIds([]);
    } catch {
      setMarkReadError("操作没有完成，请检查连接后重试。");
    } finally {
      markReadSubmittingRef.current = false;
      setMarkingRead(false);
    }
  };
  /**
   * Switch scopes in stable sidebar ID order and show the result.
   * 按侧边栏的稳定 ID 顺序切换范围，并展示切换结果。
   */
  const goToNextList = () => {
    if (props.toolbarPosition !== "bottom") {
      toolbarNavigationOriginRef.current = { listKey, scopeKey: listScopeKey, position: props.toolbarPosition, reason: "navigation" };
    }
    const target = props.onNextList();
    // Reaching the end does not change the list; do not leave the preservation flag for an
    // unrelated navigation.
    // 到达末尾时没有列表变化，不能把保留标记留给下一次无关导航。
    if (!target) toolbarNavigationOriginRef.current = null;
    setToolbarNotice(target
      ? `已切换到${target.kind === "folder" ? "文件夹组 " : " "}${target.name}`
      : `已经是最后一个${props.selectedFeed ? " Feed" : "文件夹组"}`);
  };

  /**
   * Re-enter the list on an explicit user action and prevent concurrent requests from repeated
   * clicks.
   * 用户明确触发时重新进入当前列表，并防止重复点击产生并发请求。
   */
  const refreshList = async () => {
    if (refreshingList) return;
    setRefreshingList(true);
    try {
      await props.onRefreshList();
    } finally {
      setRefreshingList(false);
    }
  };

  // Track held keys independently; preserve Alt during paging and regrouping, and clear it on page
  // changes or blur.
  // 独立监听按住状态，翻屏重新分组时保留 Alt，切换页面或失焦时清理。
  useEffect(() => {
    const reset = () => setArticleNumbersVisible(false);
    reset();
    if (!props.active || markReadConfirmationOpen || markingRead) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Alt") return;
      if (event.defaultPrevented || event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.shiftKey || event.getModifierState("AltGraph")) return;
      if (document.querySelector(".article-context-menu, .feed-read-confirm") || isInteractiveShortcutTarget(event.target) || viewportRef.current?.closest("[inert]")) return;
      setArticleNumbersVisible(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt" || !event.altKey) reset();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isInteractiveShortcutTarget(event.target)) reset();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      reset();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [props.active, markReadConfirmationOpen, markingRead, listKey]);

  useEffect(() => {
    if (!props.active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.metaKey || event.ctrlKey) return;
      if (document.querySelector(".article-context-menu, .feed-read-confirm") || markReadConfirmationOpen || markingRead || viewportRef.current?.closest("[inert]")) return;
      if (isInteractiveShortcutTarget(event.target)) return;

      // Option plus a number can produce special characters on macOS, so identify shortcuts by
      // physical key.
      // Option + 数字在 macOS 上可能生成特殊字符，因此组合键按物理键识别。
      const digit = event.altKey
        ? !event.shiftKey && !event.getModifierState("AltGraph") && /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1]
        : /^[1-9]$/.exec(event.key)?.[0];
      if (digit) {
        if (!pageIsSettled) return;
        const article = currentPageArticles[Number(digit) - 1];
        if (!article) return;
        event.preventDefault();
        setArticleNumbersVisible(false);
        props.onOpenArticle(article.id);
        return;
      }
      if (event.altKey) return;
      const key = event.key.toLowerCase();
      if (["/", "m", "r", "[", "]"].includes(key)) bumpToolbarActivity();
      if (event.key === "/") {
        event.preventDefault();
        setSwitchDimmed(false);
        const nextMode = props.mode === "all" ? "unread" : "all";
        if (props.toolbarPosition !== "bottom") {
          toolbarNavigationOriginRef.current = { listKey, scopeKey: listScopeKey, position: props.toolbarPosition, reason: "navigation" };
        }
        props.onModeChange(nextMode);
        setToolbarNotice(nextMode === "all" ? "已切换到所有文章" : "已切换到未读文章");
      } else if (key === "m") {
        event.preventDefault();
        wakeListToolbar();
        requestMarkRead();
      } else if (key === "r") {
        event.preventDefault();
        void refreshList();
      } else if (event.key === "ArrowRight" || key === "l") {
        if (!props.canReopenReader) return;
        event.preventDefault();
        props.onReopenReader();
      } else if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        const target = event.key === "[" ? props.onPreviousList() : props.onNextList();
        if (target) {
          setToolbarNotice(`已切换到${target.kind === "folder" ? "文件夹组 " : " "}${target.name}`);
        } else {
          setToolbarNotice(`已经是${event.key === "[" ? "第一" : "最后"}个${props.selectedFeed ? " Feed" : "文件夹组"}`);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPageArticles, markReadConfirmationOpen, markingRead, pageIsSettled, props.active, props.canReopenReader, props.onNextList, props.onOpenArticle, props.onPreviousList, props.onReopenReader, props.selectedFeed, props.mode, props.onModeChange, props.toolbarPosition, listKey, listScopeKey, wakeListToolbar, requestMarkRead, refreshList, bumpToolbarActivity, setSwitchDimmed]);

  const hasPreviousGroup = settledPage > 0;
  const hasNextGroup = hasNextPage;
  const currentStartIndex = currentPageArticles[0]
    ? props.articles.findIndex((article) => article.id === currentPageArticles[0]?.id)
    : -1;
  const previousPreviewArticle = currentStartIndex > 0
    ? props.articles[currentStartIndex - 1]
    : undefined;
  const nextPreviewArticle = currentStartIndex >= 0
    ? props.articles[currentStartIndex + currentPageArticles.length]
    : undefined;
  // Follow the target page as soon as paging starts so rapid input cannot leave the previous group
  // active.
  // 翻页开始后立刻跟随目标页，避免快速连续输入时仍把上一组作为活动区域。
  const activeArticleIds = new Set(currentPageArticles.map((article) => article.id));
  const articleShortcutNumbers = new Map(
    currentPageArticles.slice(0, 9).map((article, index) => [article.id, index + 1]),
  );

  return (
    <section data-list-confirmation-open={props.toolbarPosition !== "bottom" && markReadConfirmationOpen ? "true" : undefined} className="relative flex h-dvh min-w-0 flex-col bg-canvas">
      {contextMenu.menu && contextArticle ? <ArticleContextMenu
        anchor={contextMenu.menu} article={contextArticle} feed={feedsById.get(contextArticle.feedId)}
        mixed={!props.selectedFeed} canMarkAbove={contextAboveIds.length > 0} menuRef={contextMenu.menuRef}
        onClose={contextMenu.close}
        onStar={() => props.onToggleStar(contextArticle.id)}
        onMarkAbove={() => {
          void props.onMarkAboveRead(contextAboveIds).then(() => setToolbarNotice(`该条及上方 ${contextAboveIds.length} 篇已标记为已读`)).catch(() => setToolbarNotice("标记已读失败，已恢复原状态"));
        }}
        onMarkFeed={() => { setFeedReadError(""); setConfirmFeed({ id: contextArticle.feedId, name: feedsById.get(contextArticle.feedId)?.title ?? contextArticle.feedTitle }); }}
        onSelectFeed={() => props.onSelectFeed(contextArticle.feedId)}
      /> : null}
      {confirmFeed ? <FeedReadConfirmation name={confirmFeed.name} busy={markingFeed} error={feedReadError}
        onCancel={() => { if (!markingFeedRef.current) setConfirmFeed(null); }}
        onConfirm={() => {
          if (markingFeedRef.current) return;
          markingFeedRef.current = true;
          setMarkingFeed(true);
          setFeedReadError("");
          void props.onMarkFeedRead(confirmFeed.id).then(() => setConfirmFeed(null)).catch(() => setFeedReadError("操作未完成，请检查连接后重试。")).finally(() => { markingFeedRef.current = false; setMarkingFeed(false); });
        }}/>: null}
      <header className="app-header sticky top-0 z-30 grid h-[52px] grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-x-2 border-b px-4 backdrop-blur-xl sm:h-16 sm:grid-cols-[1fr_auto_1fr] sm:gap-x-0 sm:px-6">
        <div className="justify-self-start"><button className="icon-button lg:hidden" onClick={props.onOpenSidebar} aria-label="打开侧边栏"><Menu size={20}/></button></div>
        <div className="flex w-full min-w-0 max-w-[60vw] items-center justify-center justify-self-center gap-2 sm:w-auto sm:max-w-[45vw]">
          <h1 className="m-0 min-w-0 truncate text-[16px] font-bold tracking-[-.02em]">
            {feedHomepage ? (
              <a className="list-feed-homepage block truncate" href={feedHomepage} target="_blank" rel="noopener noreferrer" title="打开来源主页" aria-label={`打开来源主页：${props.selectedFeed?.title}`} data-preserve-list-toolbar onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                props.onOpenExternal(feedHomepage);
              }}>{props.selectedFeed?.title}</a>
            ) : props.isStarredList ? "星标文章" : props.selectedFeed?.title ?? props.selectedFolder?.name ?? (props.mode === "all" ? "所有文章" : "未读文章")}
          </h1>
          <UnreadCountBadge count={props.unreadCount}/>
          <SessionReadCountBadge count={props.sessionReadCount}/>
          <SessionStarredCountBadge count={props.sessionStarredCount}/>
        </div>
        <div className="flex justify-self-end gap-1">
          <button className="icon-button toolbar-mode-option header-mode-button" data-article-mode={props.mode} data-preserve-list-toolbar aria-label={props.mode === "all" ? "切换到未读文章" : "切换到所有文章"} title={props.mode === "all" ? "切换到未读文章" : "切换到所有文章"} onClick={toggleHeaderMode}>
            {props.mode === "all" ? <Inbox size={18}/> : <ReadStateIcon className="unread-mode-icon" isRead={false} size={18}/>}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 w-full flex-1 flex-col px-3 pt-3 sm:px-6 sm:pt-5">
        {props.selectedFolder && !props.selectedFeed ? (
          <nav
            ref={sourceNavigationRef}
            className={`source-navigation ${sourceNavigationDragging ? "is-mouse-dragging" : ""}`}
            data-native-horizontal-scroll
            aria-label={`${props.selectedFolder.name}中的来源`}
            onPointerDown={(event) => {
              if (event.pointerType !== "mouse" || event.button !== 0) return;
              sourceMouseDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startScrollLeft: event.currentTarget.scrollLeft,
                dragging: false,
              };
            }}
            onClickCapture={(event) => {
              if (!suppressSourceClickRef.current) return;
              suppressSourceClickRef.current = false;
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragStart={(event) => event.preventDefault()}
          >
            {orderedFolderFeeds.map((feed) => (
              <button key={feed.id} className="source-navigation-button" onClick={() => props.onSelectFeed(feed.id)}>
                <FeedIcon iconUrl={feed.iconUrl}/>
                <span>{feed.title}</span>
                <UnreadCountBadge count={props.feedUnreadCounts[feed.id] ?? feed.unreadCount ?? 0}/>
              </button>
            ))}
          </nav>
        ) : null}
        {props.selectedFolder && props.selectedFeed ? (
          <nav className="source-navigation" data-native-horizontal-scroll aria-label="所属文件夹">
            <button className="parent-folder-button" onClick={() => props.onSelectFolder(props.selectedFolder!.id)}><CornerLeftUp size={16} aria-hidden="true"/><span>{props.selectedFolder.name}</span></button>
          </nav>
        ) : null}
        {props.articles.length === 0 ? (
          <div data-list-toolbar-body data-list-feedback-suppressed={props.toolbarPosition !== "bottom" && (!switchDimmed || markReadConfirmationOpen) ? "true" : undefined} className="article-empty-state grid min-h-0 flex-1 place-items-center text-sm text-muted">没有未读文章，稍后再来看看吧</div>
        ) : (
          <div ref={viewportRef} data-list-toolbar-body data-list-feedback-suppressed={props.toolbarPosition !== "bottom" && (!switchDimmed || markReadConfirmationOpen) ? "true" : undefined} className={`article-viewport ${hoverLocked ? "article-hover-locked" : ""}`} tabIndex={0} aria-label="文章列表，可上下滑动切换">
            <div ref={trackRef} className="article-track">
              {props.articles.map((article) => (
                <ArticleCard
                  listNow={listNow}
                  key={article.id}
                  article={article}
                  feedIconUrl={feedsById.get(article.feedId)?.iconUrl}
                  active={activeArticleIds.has(article.id)}
                  contextMenuActive={contextMenu.menu?.articleId === article.id}
                  onContextMenu={(x, y) => { requestContextMenu(article.id, x, y); }}
                  shortcutNumber={props.active && articleNumbersVisible && pageIsSettled && !markReadConfirmationOpen && !markingRead ? articleShortcutNumbers.get(article.id) : undefined}
                  highlightPhase={readingArticleId === article.id ? "reading"
                    : visibleReturnSelection?.id === article.id ? visibleReturnSelection.phase : "idle"}
                  onHighlightEnd={() => {
                    if (visibleReturnSelection?.id === article.id && visibleReturnSelection.phase === "releasing") {
                      finishReturnHighlight(visibleReturnSelection.sequence);
                    }
                  }}
                  feedLinkEnabled={Boolean(props.selectedFolder || props.selectedFeed)}
                  isCurrentFeed={props.selectedFeed?.id === article.feedId}
                  suppressClick={() => suppressClickRef.current}
                  onOpen={() => {
                    setReturnSelection(null);
                    setHighlightCue(null);
                    props.onOpenArticle(article.id);
                  }}
                  onSelectFeed={() => props.onSelectFeed(article.feedId)}
                  onToggleRead={() => props.onToggleRead(article.id)}
                  onToggleStar={() => props.onToggleStar(article.id)}
                  onLayoutChange={recordArticleLayout}
                />
              ))}
              <button type="button" className="article-end" tabIndex={hasNextGroup ? -1 : 0} aria-hidden={hasNextGroup} onClick={() => { loadAttemptPageRef.current = `${listKey}:${currentPage}`; void requestMoreArticles("manual"); }} disabled={!props.hasMore || props.loadingMore} aria-label={loadMoreFailed ? "重新加载更多文章" : props.hasMore ? "加载更多文章" : "已加载全部可用文章"}>
                <span className="article-end-title">{props.loadingMore ? "正在加载更多…" : loadMoreFailed ? "加载失败，点击重试" : props.hasMore ? "继续下滑将自动加载" : "已加载全部可用文章"}</span>
                <span className="article-end-next">{props.hasMore ? "获取 FreshRSS 中更早的文章" : "当前列表没有更多文章"}</span>
              </button>
            </div>
            <button type="button" className="article-edge-control previous" tabIndex={hasPreviousGroup ? 0 : -1} aria-hidden={!hasPreviousGroup} disabled={!hasPreviousGroup} onClick={() => activateAdjacentPage(-1)} aria-label={`切换到上一组${previousPreviewArticle ? `，相邻文章：${previousPreviewArticle.title}` : ""}`}/>
            <button type="button" className="article-edge-control next" tabIndex={hasNextGroup ? 0 : -1} aria-hidden={!hasNextGroup} disabled={!hasNextGroup} onClick={() => activateAdjacentPage(1)} aria-label={`切换到下一组${nextPreviewArticle ? `，相邻文章：${nextPreviewArticle.title}` : ""}`}/>
          </div>
        )}
      </div>

      <ToolbarAnchor position={props.toolbarPosition}>
        <div ref={toolbarRef} data-toolbar-position={props.toolbarPosition} className={`floating-switch ${props.toolbarPosition !== "bottom" ? "side-toolbar" : ""} ${switchDimmed ? "dimmed" : ""}`} role="group" aria-label={switchDimmed ? "列表工具栏已休眠，点击唤醒" : "列表工具栏"} onClick={() => { if (switchDimmed) wakeListToolbar(); }}>
          {markReadConfirmationOpen ? (
            <div
              ref={markReadPopoverRef}
              id="mark-read-confirm-popover"
              className="mark-read-confirm-popover"
              role="dialog"
              aria-label={markAboveRead ? "确认上方已读" : "确认全部已读"}
              aria-describedby="mark-read-confirm-description"
              aria-busy={markingRead}
              tabIndex={-1}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
                // When the button has focus, let its native Enter click handle the action to avoid
                // duplicate submissions.
                // 按钮聚焦时由原生 Enter 点击处理，避免重复提交。
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                if (!markingRead) void confirmMarkRead();
              }}
            >
              <button
                type="button"
                className="mark-read-confirm-submit"
                disabled={markingRead}
                onClick={() => void confirmMarkRead()}
              >
                {markingRead
                  ? <RefreshCw className="animate-spin" size={16}/>
                  : markAboveRead ? <ArrowUpToLine size={16}/> : <CheckCheck size={16}/>}
                <span>{markingRead ? "正在处理…" : markAboveRead ? "确认上方已读" : "确认全部已读"}</span>
              </button>
              <div className="mark-read-confirm-copy">
                <p id="mark-read-confirm-description">
                  {markAboveRead
                    ? `将当前屏及其上方的 ${pendingAboveReadIds.length} 篇未读文章标记为已读？下方文章不受影响。`
                    : `将“${props.markAllReadScopeName}”中的所有未读文章标记为已读？包括尚未加载的文章。`}
                </p>
                <p className="mark-read-confirm-warning">此操作无法一键撤销。</p>
                {markReadError ? <div className="mark-read-confirm-error" role="alert">{markReadError}</div> : null}
              </div>
            </div>
          ) : null}
          <div className={`floating-switch-notice ${toolbarNotice ? "visible" : ""}`} role="status">{toolbarNotice}</div>
          <button
            ref={markReadTriggerRef}
            className={`floating-switch-option ${markAboveRead && !pageIsSettled ? "is-settling" : ""}`}
            disabled={markingRead || (markAboveRead && !pageIsSettled && !(props.toolbarPosition !== "bottom" && switchDimmed))}
            onClick={(event) => { event.stopPropagation(); runToolbarAction(requestMarkRead); }}
            aria-label={markAboveRead ? "将当前屏及上方文章标记为已读" : "将当前列表全部标记为已读"}
            aria-expanded={markReadConfirmationOpen}
            aria-controls="mark-read-confirm-popover"
            title={markAboveRead ? "将当前屏及上方文章标记为已读" : "将当前列表全部标记为已读"}
          >
            {markAboveRead ? <ArrowUpToLine size={19}/> : <CheckCheck size={19}/>}
            <span className="floating-switch-label">{markAboveRead ? "上方已读" : "全部已读"}</span>
          </button>
          <button className="floating-switch-option" onClick={(event) => { event.stopPropagation(); runToolbarAction(goToNextList); }} aria-label={`切换到下一个${props.nextListTarget?.kind === "folder" ? "文件夹组" : " Feed"}`}>
            <ChevronsRight size={19}/><span className="floating-switch-label">{props.nextListTarget?.kind === "folder" ? "下一组" : "下一 Feed"}</span>
          </button>
          <button className="floating-switch-option toolbar-mode-option" data-article-mode={props.mode} aria-label={props.mode === "all" ? "当前显示所有文章，点击切换到未读文章" : "当前显示未读文章，点击切换到所有文章"} onClick={(event) => { event.stopPropagation(); selectMode(props.mode === "all" ? "unread" : "all"); }}>
            {props.mode === "all" ? <Inbox size={19}/> : <ReadStateIcon className="unread-mode-icon" isRead={false} size={19}/>}<span className="floating-switch-label">{props.mode === "all" ? "所有文章" : "未读文章"}</span>
          </button>
        </div>
      </ToolbarAnchor>
    </section>
  );
}
