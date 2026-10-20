import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArticleListPage } from "@/features/article-list/components/ArticleListPage";
import { articleMatchesPreviewScope, getScopeKey, getStreamId, type ListScope } from "@/features/article-list/scope";
import { ConnectPage } from "@/features/connection/components/ConnectPage";
import { initialArticles } from "@/features/preview/data/articles";
import { feedFolders as previewFolders, previewFeeds } from "@/features/preview/data/feedFolders";
import { ReaderPage } from "@/features/reader/components/ReaderPage";
import { SettingsPage } from "@/features/settings/components/SettingsPage";
import { Sidebar } from "@/features/subscriptions/components/Sidebar";
import type { AppPlatform } from "@/platform/Platform";
import { normalizeRssError } from "@/services/rss/errors";
import type {
  AppView,
  Article,
  ArticleMode,
  Feed,
  FeedFolder,
  FreshRssConnectionInput,
  LoadMoreReason,
  NextListTarget,
  SavedFreshRssConnection,
  StartupPageMode,
  SwipeMarkReadMode,
  ToolbarPosition,
} from "@/types";
import { useSidebarSwipe } from "./hooks/useSidebarSwipe";
import { GestureDebugPanel } from "./components/GestureDebugPanel";
import { useTouchPressFeedback } from "./hooks/useTouchPressFeedback";
import { KeyboardShortcutHelp } from "@/components/KeyboardShortcutHelp";

const READING_LIST_SCOPE: ListScope = { kind: "reading-list" };
const FEED_READ_ACTIVITY_STORAGE_PREFIX = "swipyrss.feed-read-activity.v1";
const ARTICLE_MODE_STORAGE_PREFIX = "swipyrss.article-mode.v1";
const LIST_SCOPE_STORAGE_PREFIX = "swipyrss.list-scope.v1";
const TOOLBAR_POSITION_STORAGE_KEY = "swipyrss.toolbar-position.v1";
const SWIPE_MARK_READ_STORAGE_KEY = "swipyrss.swipe-mark-read.v1";
const STARTUP_PAGE_STORAGE_KEY = "swipyrss.startup-page.v1";
const UNREAD_REFRESH_THROTTLE_MS = 60_000;

type MutableArticleState = "read" | "starred";

/**
 * Store each account's latest feed read timestamps separately; use a separate namespace for preview
 * data.
 * 不同账号分别保存来源的最近已读标记时间；预览数据使用独立命名空间。
 */
function getFeedReadActivityStorageKey(
  connection: SavedFreshRssConnection | null,
  previewMode: boolean,
): string | null {
  if (previewMode) return `${FEED_READ_ACTIVITY_STORAGE_PREFIX}:preview`;
  if (!connection) return null;
  return `${FEED_READ_ACTIVITY_STORAGE_PREFIX}:${encodeURIComponent(`${connection.apiUrl}|${connection.username}`)}`;
}

/**
 * Store the last All/Unread mode for each article scope separately for each account.
 * 不同账号分别保存每个文章范围最后使用的“所有 / 未读”模式。
 */
function getArticleModeStorageKey(
  connection: SavedFreshRssConnection | null,
  previewMode: boolean,
): string | null {
  if (previewMode) return `${ARTICLE_MODE_STORAGE_PREFIX}:preview`;
  if (!connection) return null;
  return `${ARTICLE_MODE_STORAGE_PREFIX}:${encodeURIComponent(`${connection.apiUrl}|${connection.username}`)}`;
}

/**
 * Store each account's last visited article scope separately; use a separate namespace for preview
 * data.
 * 不同账号分别保存最后访问的文章范围；预览数据使用独立命名空间。
 */
function getListScopeStorageKey(
  connection: SavedFreshRssConnection | null,
  previewMode: boolean,
): string | null {
  if (previewMode) return `${LIST_SCOPE_STORAGE_PREFIX}:preview`;
  if (!connection) return null;
  return `${LIST_SCOPE_STORAGE_PREFIX}:${encodeURIComponent(`${connection.apiUrl}|${connection.username}`)}`;
}

/**
 * Treat localStorage as untrusted; retain only valid scope keys and the two known modes.
 * localStorage 内容不可信，只保留合法范围键和两种已知模式。
 */
function loadArticleModes(storageKey: string | null): Record<string, ArticleMode> {
  if (!storageKey) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(
      ([scopeKey, savedMode]) => scopeKey.length > 0 && (savedMode === "all" || savedMode === "unread"),
    )) as Record<string, ArticleMode>;
  } catch {
    return {};
  }
}

/**
 * Preserve the previous default: swiping up marks articles as read only in unread mode.
 * 沿用旧版行为：未配置时仅在未读页面上滑标记已读。
 */
function loadSwipeMarkReadMode(): SwipeMarkReadMode {
  try {
    const saved = window.localStorage.getItem(SWIPE_MARK_READ_STORAGE_KEY);
    if (saved === "off" || saved === "both" || saved === "unread" || saved === "all") return saved;
  } catch {
    // Keep the default settings when local storage is disabled.
    // 禁用本地存储时仍使用默认设置。
  }
  return "unread";
}

function loadStartupPageMode(): StartupPageMode {
  try {
    const saved = window.localStorage.getItem(STARTUP_PAGE_STORAGE_KEY);
    if (saved === "unread" || saved === "all" || saved === "first-folder"
      || saved === "first-feed" || saved === "last-list") return saved;
  } catch { /*
   * Use the default unread list when storage is unavailable.
   * 存储不可用时使用默认未读列表。
   */ }
  return "unread";
}

function loadToolbarPosition(): ToolbarPosition {
  try {
    const saved = window.localStorage.getItem(TOOLBAR_POSITION_STORAGE_KEY);
    if (saved === "left" || saved === "right") return saved;
  } catch { /*
   * Keep the bottom toolbar when storage is unavailable.
   * 存储不可用时沿用下方工具栏。
   */ }
  return "bottom";
}

/**
 * Scopes without a saved mode show all articles by default.
 * 尚未记录过的列表默认展示所有文章。
 */
function getRememberedArticleMode(
  preferences: Readonly<Record<string, ArticleMode>>,
  scope: ListScope,
): ArticleMode {
  return preferences[getScopeKey(scope)] ?? "all";
}

/**
 * Restore only the supported scope structure from local preferences; reject unknown kinds and
 * invalid IDs.
 * 从本地偏好恢复有限的列表范围结构，拒绝未知 kind 和无效 ID。
 */
function loadListScope(storageKey: string | null): ListScope | null {
  if (!storageKey) return null;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.kind === "reading-list" || record.kind === "starred") {
      return { kind: record.kind };
    }
    if ((record.kind === "folder" || record.kind === "feed")
      && typeof record.id === "string" && record.id.length > 0) {
      return { kind: record.kind, id: record.id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the startup scope and mode in sidebar order; fall back to global unread when no valid
 * target exists.
 * 按侧边栏顺序解析启动范围和模式；无有效目标时回退到全局未读。
 */
function resolveStartupTarget(
  startupPage: StartupPageMode,
  remembered: ListScope | null,
  preferences: Readonly<Record<string, ArticleMode>>,
  feeds: readonly Feed[],
  folders: readonly FeedFolder[],
): { scope: ListScope; mode: ArticleMode } {
  const fallback = { scope: READING_LIST_SCOPE, mode: "unread" as const };
  if (startupPage === "unread" || startupPage === "all") {
    return { scope: READING_LIST_SCOPE, mode: startupPage };
  }

  const feedIds = new Set(feeds.map((feed) => feed.id));
  const validFolders = folders.filter((folder) => folder.feedIds.some((id) => feedIds.has(id)));
  const firstFeedId = folders.flatMap((folder) => folder.feedIds).find((id) => feedIds.has(id))
    ?? feeds[0]?.id;
  let target: ListScope | null = null;
  if (startupPage === "first-folder") {
    if (validFolders[0]) target = { kind: "folder", id: validFolders[0].id };
  } else if (startupPage === "first-feed") {
    if (firstFeedId) target = { kind: "feed", id: firstFeedId };
  } else if (remembered) {
    if (remembered.kind === "reading-list" || remembered.kind === "starred") target = remembered;
    else if (remembered.kind === "feed") {
      target = feedIds.has(remembered.id) ? remembered
        : firstFeedId ? { kind: "feed", id: firstFeedId } : null;
    } else {
      target = validFolders.some((folder) => folder.id === remembered.id) ? remembered
        : validFolders[0] ? { kind: "folder", id: validFolders[0].id } : null;
    }
  }
  return target ? { scope: target, mode: getRememberedArticleMode(preferences, target) } : fallback;
}

/**
 * Save scopes validated against or created from the current subscription tree; storage failures
 * must not block navigation.
 * 保存已校验或由当前订阅树产生的列表范围；写入失败不影响导航。
 */
function saveListScope(storageKey: string | null, scope: ListScope): void {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(scope));
  } catch {
    // Retain the current selection in memory if saving local preferences fails.
    // 本地偏好写入失败时仍保留本次内存中的选中状态。
  }
}

/**
 * Treat localStorage as untrusted; accept only plain objects containing finite numeric timestamps.
 * localStorage 内容不可信，只接受有限数字时间戳组成的普通对象。
 */
function loadFeedReadActivity(storageKey: string | null): Record<string, number> {
  if (!storageKey) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(
      ([feedId, timestamp]) => feedId.length > 0 && typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0,
    ));
  } catch {
    return {};
  }
}

/**
 * Create independently updatable feed unread counts from the startup metadata.
 * 从启动元数据创建可独立更新的 Feed 未读计数。
 */
function createFeedUnreadCounts(feeds: Feed[]): Record<string, number> {
  return Object.fromEntries(feeds.map((feed) => [feed.id, feed.unreadCount ?? 0]));
}

/**
 * Recalculate feed unread counts from all preview articles so bulk actions include articles outside
 * the current view.
 * 从完整的预览文章集合重算 Feed 未读数，避免批量操作遗漏当前不可见的文章。
 */
function createPreviewFeedUnreadCounts(feeds: Feed[], articles: Article[]): Record<string, number> {
  const counts = Object.fromEntries(feeds.map((feed) => [feed.id, 0]));
  for (const article of articles) {
    if (!article.isRead) counts[article.feedId] = (counts[article.feedId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Apply feed count deltas to the current snapshot. Clamp every count at zero so concurrent clicks
 * or stale remote data cannot produce negative sidebar counts.
 *
 * 将一组 Feed 计数增量应用到当前快照。
 *
 * 所有值都在 0 处截断，避免并发点击或远端旧数据使侧边栏出现负数。
 */
function applyFeedUnreadDeltas(
  current: Record<string, number>,
  deltas: ReadonlyMap<string, number>,
): Record<string, number> {
  if (!deltas.size) return current;

  const next = { ...current };
  for (const [feedId, delta] of deltas) {
    next[feedId] = Math.max(0, (next[feedId] ?? 0) + delta);
  }
  return next;
}

/**
 * Coordinate the SwipyRSS application. Compose components here; delegate networking, caching, and
 * credentials to the current runtime's RssClient. This boundary lets preview and live data share
 * page components without exposing FreshRSS protocol details to those pages.
 *
 * SwipyRSS 的应用协调层。
 *
 * 组件只在这里组合；网络、缓存和凭据由当前运行时的 RssClient 负责。这个
 * 边界让预览数据和真实数据共享页面组件，同时避免页面知道 FreshRSS 协议细节。
 */
export default function App({ platform }: { platform: AppPlatform }) {
  const { rssClient, externalArticles } = platform;
  const connectionDefaults = useMemo(() => platform.getConnectionDefaults(), [platform]);
  const ExternalArticleView = externalArticles.kind === "embedded" ? externalArticles.View : null;
  useTouchPressFeedback();
  const [connection, setConnection] = useState<SavedFreshRssConnection | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [starting, setStarting] = useState(true);
  // Preserve session state across list unmounts only; expanding or collapsing the toolbar does not
  // rerender App.
  // 只跨列表卸载保存会话状态；展开/收起不触发 App 渲染。
  const sideListToolbarCollapsedRef = useRef(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [folders, setFolders] = useState<FeedFolder[]>([]);
  const [readingListUnreadCount, setReadingListUnreadCount] = useState(0);
  const [feedUnreadCounts, setFeedUnreadCounts] = useState<Record<string, number>>({});
  const [feedReadMarkedAt, setFeedReadMarkedAt] = useState<Record<string, number>>({});
  const [sessionReadCount, setSessionReadCount] = useState(0);
  const [sessionStarredCount, setSessionStarredCount] = useState(0);
  const [continuation, setContinuation] = useState<string>();
  const [mode, setMode] = useState<ArticleMode>("all");
  const [startupPageMode, setStartupPageMode] = useState<StartupPageMode>(loadStartupPageMode);
  const startupPageModeRef = useRef(startupPageMode);
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition>(loadToolbarPosition);
  const [swipeMarkReadMode, setSwipeMarkReadMode] = useState<SwipeMarkReadMode>(loadSwipeMarkReadMode);
  const [scope, setScope] = useState<ListScope>(READING_LIST_SCOPE);
  const [view, setView] = useState<AppView>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnHighlight, setReturnHighlight] = useState<{ id: string; sequence: number } | null>(null);
  const [readerResetKey, setReaderResetKey] = useState(0);
  const [listRefreshKey, setListRefreshKey] = useState(0);
  const [canReopenReader, setCanReopenReader] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [listHorizontalBlockKey, setListHorizontalBlockKey] = useState(0);
  const [toast, setToast] = useState("");
  const [externalUrl, setExternalUrl] = useState<string | null>(null);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const closeShortcutHelp = useCallback(() => setShortcutHelpOpen(false), []);
  const openSettings = useCallback(() => {
    setCanReopenReader(false);
    setSidebarOpen(false);
    setView("settings");
  }, []);

  const returnHighlightSequenceRef = useRef(0);
  // Recognize reader history only from the current App instance in this tab, avoiding unrelated
  // site history.
  // 同一标签页内的正文历史只认当前 App 实例，避免误消费站点原有历史。
  const readerHistorySessionRef = useRef(`${Date.now()}-${Math.random()}`);
  const readerHistoryActiveRef = useRef(false);
  const readerBackPendingRef = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const requestSequenceRef = useRef(0);
  const loadMoreRequestRef = useRef(0);
  const loadMoreInFlightRef = useRef(false);
  const mutationSequenceRef = useRef(0);
  const unreadMutationVersionRef = useRef(0);
  const unreadRefreshSequenceRef = useRef(0);
  const unreadRefreshRequestedAtRef = useRef(0);
  const latestMutationRef = useRef(new Map<string, number>());
  const feedReadMarkedAtRef = useRef<Record<string, number>>({});
  const feedReadActivityStorageKeyRef = useRef<string | null>(null);
  const articleModesRef = useRef<Record<string, ArticleMode>>({});
  const articleModeStorageKeyRef = useRef<string | null>(null);
  const listScopeStorageKeyRef = useRef<string | null>(null);
  const readingSessionKeyRef = useRef(`${mode}:${getScopeKey(scope)}`);
  const readingSessionVersionRef = useRef(0);
  const sessionReadArticleIdsRef = useRef(new Set<string>());
  const sessionInitiallyReadArticleIdsRef = useRef(new Set<string>());
  const sessionStarredArticleIdsRef = useRef(new Set<string>());
  const sessionInitiallyStarredArticleIdsRef = useRef(new Set<string>());
  const previewArticlesRef = useRef(
    new Map(initialArticles.map((article) => [article.id, { ...article }])),
  );
  const feedReadActivityStorageKey = useMemo(
    () => getFeedReadActivityStorageKey(connection, previewMode),
    [connection, previewMode],
  );
  const articleModeStorageKey = useMemo(
    () => getArticleModeStorageKey(connection, previewMode),
    [connection, previewMode],
  );

  /**
   * Show a global notification that dismisses itself.
   * 展示一个会自动消失的全局轻提示。
   */
  const notify = useCallback((message: string) => setToast(message), []);
  /**
   * After an unread-to-read transition succeeds, record the affected feeds for folder navigation
   * ordering.
   * 成功产生“未读 → 已读”标记后，记录相关来源供文件夹导航排序使用。
   */
  const recordFeedsMarkedRead = useCallback((feedIds: ReadonlySet<string>) => {
    const storageKey = feedReadActivityStorageKey;
    if (!storageKey || feedReadActivityStorageKeyRef.current !== storageKey || !feedIds.size) return;

    const markedAt = Date.now();
    const next = { ...feedReadMarkedAtRef.current };
    for (const feedId of feedIds) next[feedId] = markedAt;
    feedReadMarkedAtRef.current = next;
    setFeedReadMarkedAt(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // A local preference write failure must not affect the FreshRSS mark-as-read operation.
      // 本地偏好写入失败不应影响 FreshRSS 已读操作本身。
    }
  }, [feedReadActivityStorageKey]);
  /**
   * Record the last mode used for a scope; storage failures must not block switching lists.
   * 记录一个列表范围最后使用的模式；写入失败不阻断列表切换。
   */
  const rememberArticleMode = useCallback((nextScope: ListScope, nextMode: ArticleMode) => {
    const storageKey = articleModeStorageKey;
    if (!storageKey || articleModeStorageKeyRef.current !== storageKey) return;

    const scopeKey = getScopeKey(nextScope);
    if (articleModesRef.current[scopeKey] === nextMode) return;
    const next = { ...articleModesRef.current, [scopeKey]: nextMode };
    articleModesRef.current = next;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Apply the current mode switch even if saving local preferences fails.
      // 本地偏好写入失败时，本次切换仍然正常生效。
    }
  }, [articleModeStorageKey]);
  /**
   * Save the last visited article scope for the current account.
   * 按当前账号保存最后访问的列表范围。
   */
  const rememberListScope = useCallback((nextScope: ListScope) => {
    saveListScope(listScopeStorageKeyRef.current, nextScope);
  }, []);
  /**
   * Start a separate reading session for a new scope; opening an article and returning within the
   * same scope preserves progress.
   * 新列表范围建立独立阅读会话；相同范围内打开正文再返回不会清零。
   */
  const beginReadingSession = useCallback((nextScope: ListScope, nextMode: ArticleMode, force = false) => {
    const nextKey = `${nextMode}:${getScopeKey(nextScope)}`;
    if (!force && readingSessionKeyRef.current === nextKey) return;

    readingSessionKeyRef.current = nextKey;
    readingSessionVersionRef.current += 1;
    sessionReadArticleIdsRef.current = new Set();
    sessionInitiallyReadArticleIdsRef.current = new Set();
    sessionStarredArticleIdsRef.current = new Set();
    sessionInitiallyStarredArticleIdsRef.current = new Set();
    setSessionReadCount(0);
    setSessionStarredCount(0);
  }, []);
  /**
   * Open the mobile sidebar; responsive styles keep the desktop sidebar visible.
   * 打开移动端侧边栏；桌面端侧边栏始终由响应式样式展示。
   */
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  /**
   * Close the narrow-screen sidebar while preserving the current list and temporary reader forward
   * history.
   * 关闭窄屏侧边栏，并保留当前列表与临时正文前进历史。
   */
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  /**
   * Add one same-URL history entry when opening the reader; switching articles updates that entry.
   * 列表到正文只增加一条同 URL 历史；正文内换文章更新该条记录。
   */
  const recordReaderHistory = useCallback((articleId: string) => {
    const current = window.history.state;
    const state = current && typeof current === "object" && !Array.isArray(current)
      ? current as Record<string, unknown>
      : {};
    const marker = state.__swipyrssReader as { session?: string } | undefined;
    const nextState = {
      ...state,
      __swipyrssReader: { session: readerHistorySessionRef.current, articleId },
    };
    if (readerHistoryActiveRef.current && marker?.session === readerHistorySessionRef.current) {
      window.history.replaceState(nextState, "");
    } else {
      window.history.pushState(nextState, "");
    }
    readerHistoryActiveRef.current = true;
    readerBackPendingRef.current = false;
  }, []);

  /**
   * Share list restoration and article highlighting across return actions while preserving toolbar
   * state.
   * 各种返回入口共用列表恢复与文章高亮，保留工具栏状态。
   */
  const restoreArticleList = useCallback(() => {
    if (selectedId) {
      returnHighlightSequenceRef.current += 1;
      setReturnHighlight({ id: selectedId, sequence: returnHighlightSequenceRef.current });
    }
    setView("list");
    setCanReopenReader(true);
  }, [selectedId]);
  /**
   * Return to the list and consume the reader history entry so browser and in-app back actions stay
   * consistent.
   * 返回列表并消费正文历史，使浏览器和页面返回保持一致。
   */
  const closeReader = useCallback(() => {
    if (readerBackPendingRef.current) return;
    const marker = window.history.state?.__swipyrssReader as { session?: string } | undefined;
    if (readerHistoryActiveRef.current && marker?.session === readerHistorySessionRef.current) {
      readerBackPendingRef.current = true;
      window.history.back();
      return;
    }
    readerHistoryActiveRef.current = false;
    restoreArticleList();
  }, [restoreArticleList]);
  const consumeReturnHighlight = useCallback((sequence: number) => {
    setReturnHighlight((cue) => cue?.sequence === sequence ? null : cue);
  }, []);
  /**
   * Suppress the remaining trackpad momentum after returning to the list so it cannot immediately
   * open the sidebar.
   * 触控板返回列表后先屏蔽同一段惯性，避免紧接着呼出侧边栏。
   */
  const closeReaderFromSwipe = useCallback(() => {
    setListHorizontalBlockKey((key) => key + 1);
    closeReader();
  }, [closeReader]);
  /**
   * Restore the reader that was just closed and consume this forward navigation opportunity.
   * 恢复刚关闭的正文页，并消费这一次前进导航机会。
   */
  const reopenReader = useCallback(() => {
    if (selectedId) recordReaderHistory(selectedId);
    setCanReopenReader(false);
    setView("reader");
  }, [recordReaderHistory, selectedId]);

  useSidebarSwipe(
    mainRef,
    drawerRef,
    backdropRef,
    (Boolean(connection) || previewMode) && view === "list",
    sidebarOpen,
    listHorizontalBlockKey,
    openSidebar,
    closeSidebar,
    canReopenReader,
    reopenReader,
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const activity = loadFeedReadActivity(feedReadActivityStorageKey);
    feedReadActivityStorageKeyRef.current = feedReadActivityStorageKey;
    feedReadMarkedAtRef.current = activity;
    setFeedReadMarkedAt(activity);
  }, [feedReadActivityStorageKey]);

  useEffect(() => {
    const preferences = loadArticleModes(articleModeStorageKey);
    articleModeStorageKeyRef.current = articleModeStorageKey;
    articleModesRef.current = preferences;
  }, [articleModeStorageKey]);

  const feedsById = useMemo(() => new Map(feeds.map((feed) => [feed.id, feed])), [feeds]);
  const selectedFeed = scope.kind === "feed" ? feedsById.get(scope.id) ?? null : null;
  const selectedFolder = useMemo(() => {
    if (scope.kind === "folder") return folders.find((folder) => folder.id === scope.id) ?? null;
    if (scope.kind === "feed") return folders.find((folder) => folder.feedIds.includes(scope.id)) ?? null;
    return null;
  }, [folders, scope]);
  const folderFeeds = useMemo(
    () => selectedFolder?.feedIds.flatMap((feedId) => feedsById.get(feedId) ?? []) ?? [],
    [feedsById, selectedFolder],
  );
  const currentListUnreadCount = useMemo(() => {
    if (scope.kind === "feed") {
      return feedUnreadCounts[scope.id] ?? selectedFeed?.unreadCount ?? 0;
    }
    if (scope.kind === "folder") {
      return selectedFolder?.feedIds.reduce(
        (count, feedId) => count + (feedUnreadCounts[feedId] ?? 0),
        0,
      ) ?? 0;
    }
    if (scope.kind === "starred") {
      return articles.reduce((count, article) => count + (article.isRead ? 0 : 1), 0);
    }
    return readingListUnreadCount;
  }, [articles, feedUnreadCounts, readingListUnreadCount, scope, selectedFeed, selectedFolder]);
  const markAllReadScopeName = selectedFeed?.title
    ?? selectedFolder?.name
    ?? (scope.kind === "starred" ? "星标文章" : "所有文章");
  const selectedArticle = articles.find((article) => article.id === selectedId) ?? articles[0] ?? null;
  const selectedVisibleIndex = selectedArticle ? articles.findIndex((article) => article.id === selectedArticle.id) : -1;
  const previousArticle = selectedVisibleIndex > 0 ? articles[selectedVisibleIndex - 1] : null;
  const nextArticle = selectedVisibleIndex >= 0 && selectedVisibleIndex < articles.length - 1
    ? articles[selectedVisibleIndex + 1]
    : null;

  const orderedFeeds = useMemo(() => {
    const groupedIds = folders.flatMap((folder) => folder.feedIds);
    const groupedIdSet = new Set(groupedIds);
    const grouped = groupedIds.flatMap((feedId) => feedsById.get(feedId) ?? []);
    return [...grouped, ...feeds.filter((feed) => !groupedIdSet.has(feed.id))];
  }, [feeds, feedsById, folders]);

  const adjacentListTargets = useMemo((): { previous: NextListTarget | null; next: NextListTarget | null } => {
    if (scope.kind === "feed") {
      const currentIndex = orderedFeeds.findIndex((feed) => feed.id === scope.id);
      const previousFeed = currentIndex > 0 ? orderedFeeds[currentIndex - 1] : null;
      const nextFeed = currentIndex >= 0 ? orderedFeeds[currentIndex + 1] : null;
      return {
        previous: previousFeed ? { kind: "feed", id: previousFeed.id, name: previousFeed.title } : null,
        next: nextFeed ? { kind: "feed", id: nextFeed.id, name: nextFeed.title } : null,
      };
    }

    const currentIndex = scope.kind === "folder"
      ? folders.findIndex((folder) => folder.id === scope.id)
      : -1;
    const previousFolder = currentIndex > 0 ? folders[currentIndex - 1] : null;
    const nextFolder = folders[currentIndex + 1];
    return {
      previous: previousFolder ? { kind: "folder", id: previousFolder.id, name: previousFolder.name } : null,
      next: nextFolder ? { kind: "folder", id: nextFolder.id, name: nextFolder.name } : null,
    };
  }, [folders, orderedFeeds, scope]);
  const { previous: previousListTarget, next: nextListTarget } = adjacentListTargets;

  /**
   * Build preview data for the current scope while preserving local article state changes.
   * 生成预览模式当前范围的数据，并保持已有文章的本地状态变化。
   */
  const applyPreviewScope = useCallback((nextScope: ListScope, nextMode: ArticleMode): Article[] => {
    const previewArticles = Array.from(previewArticlesRef.current.values());
    const visibleArticles = previewArticles
      .filter((article) => articleMatchesPreviewScope(article, nextScope, previewFolders))
      .filter((article) => nextMode === "all" || !article.isRead);
    setArticles(visibleArticles);
    setContinuation(undefined);
    return visibleArticles;
  }, []);

  /**
   * Fetch a complete new scope through the current RSS adapter. Sequence checks prevent slow
   * responses from overwriting a feed or folder selected later.
   *
   * 从当前 RSS 适配器获取一个完整的新范围。序号校验保证慢响应不能覆盖用户后来选择
   * 的 Feed 或文件夹。
   */
  const loadRemoteScope = useCallback(async (nextScope: ListScope, nextMode: ArticleMode) => {
    const sequence = ++requestSequenceRef.current;

    // A new scope immediately invalidates old continuation requests and can load independently.
    // 新范围会立即使旧的 continuation 请求失效，并允许新范围独立加载。
    loadMoreRequestRef.current += 1;
    loadMoreInFlightRef.current = false;
    setLoadingMore(false);
    setLoadingList(true);

    try {
      const page = await rssClient.getStream({
        streamId: getStreamId(nextScope),
        unreadOnly: nextMode === "unread",
      });
      if (sequence !== requestSequenceRef.current) return;

      setArticles(page.items);
      setContinuation(page.continuation);
      setSelectedId(page.items[0]?.id ?? null);
    } catch (error) {
      if (sequence === requestSequenceRef.current) notify(normalizeRssError(error).message);
    } finally {
      if (sequence === requestSequenceRef.current) setLoadingList(false);
    }
  }, [notify, rssClient]);

  /**
   * Close the reader when switching scopes and choose the preview or live data source.
   * 切换范围时同步关闭阅读页，并选择预览或真实数据通道。
   */
  const selectScope = useCallback((nextScope: ListScope, nextMode?: ArticleMode) => {
    const resolvedMode = nextMode
      ?? getRememberedArticleMode(articleModesRef.current, nextScope);
    rememberArticleMode(nextScope, resolvedMode);
    rememberListScope(nextScope);
    beginReadingSession(nextScope, resolvedMode);
    setScope(nextScope);
    setMode(resolvedMode);
    setCanReopenReader(false);
    setView("list");

    if (previewMode) applyPreviewScope(nextScope, resolvedMode);
    else void loadRemoteScope(nextScope, resolvedMode);
  }, [applyPreviewScope, beginReadingSession, loadRemoteScope, previewMode, rememberArticleMode, rememberListScope]);

  /**
   * Validate and save the connection, then load the first live list; show the reason in the form on
   * failure.
   * 验证、保存连接并加载第一个真实列表；失败会回到表单展示原因。
   */
  const connect = useCallback(async (input: FreshRssConnectionInput) => {
    // Invalidate pending list requests for the old account before changing the connection.
    // 更换连接前先使旧账号仍在进行的列表请求失效。
    requestSequenceRef.current += 1;
    loadMoreRequestRef.current += 1;
    loadMoreInFlightRef.current = false;
    setLoadingMore(false);

    try {
      const saved = await rssClient.saveConnection(input);
      const modeStorageKey = getArticleModeStorageKey(saved, false);
      const scopeStorageKey = getListScopeStorageKey(saved, false);
      const savedModes = loadArticleModes(modeStorageKey);
      const bootstrap = await rssClient.bootstrapAccount();
      unreadRefreshRequestedAtRef.current = Date.now();
      const { scope: startupScope, mode: restoredMode } = resolveStartupTarget(
        startupPageModeRef.current, loadListScope(scopeStorageKey), savedModes, bootstrap.feeds, bootstrap.folders,
      );
      const firstPage = await rssClient.getStream({
        streamId: getStreamId(startupScope),
        unreadOnly: restoredMode === "unread",
      });

      articleModeStorageKeyRef.current = modeStorageKey;
      listScopeStorageKeyRef.current = scopeStorageKey;
      articleModesRef.current = savedModes;
      setConnection(saved);
      setPreviewMode(false);
      setFeeds(bootstrap.feeds);
      setFolders(bootstrap.folders);
      setReadingListUnreadCount(bootstrap.readingListUnreadCount);
      setFeedUnreadCounts(createFeedUnreadCounts(bootstrap.feeds));
      setArticles(firstPage.items);
      setContinuation(firstPage.continuation);
      setSelectedId(firstPage.items[0]?.id ?? null);
      setScope(startupScope);
      setMode(restoredMode);
      beginReadingSession(startupScope, restoredMode, true);
      setView("list");
      notify("FreshRSS 连接成功");
    } catch (error) {
      throw new Error(normalizeRssError(error).message);
    }
  }, [beginReadingSession, notify, rssClient]);

  /**
   * Load mock data through the standard DTOs so both browsers and native shells can enter preview
   * mode.
   * 用正式 DTO 装载 mock 数据，浏览器和原生壳都可以进入预览。
   */
  const enterPreview = useCallback(() => {
    const previewArticles = initialArticles.map((article) => ({ ...article }));
    const modeStorageKey = getArticleModeStorageKey(null, true);
    const scopeStorageKey = getListScopeStorageKey(null, true);
    const savedModes = loadArticleModes(modeStorageKey);
    const { scope: startupScope, mode: restoredMode } = resolveStartupTarget(
      startupPageModeRef.current, loadListScope(scopeStorageKey), savedModes, previewFeeds, previewFolders,
    );
    previewArticlesRef.current = new Map(previewArticles.map((article) => [article.id, article]));
    articleModeStorageKeyRef.current = modeStorageKey;
    listScopeStorageKeyRef.current = scopeStorageKey;
    articleModesRef.current = savedModes;
    setPreviewMode(true);
    setConnection(null);
    setFeeds(previewFeeds);
    setFolders(previewFolders);
    setReadingListUnreadCount(initialArticles.filter((article) => !article.isRead).length);
    setFeedUnreadCounts(createFeedUnreadCounts(previewFeeds));
    const visibleArticles = previewArticles
      .filter((article) => articleMatchesPreviewScope(article, startupScope, previewFolders))
      .filter((article) => restoredMode === "all" || !article.isRead);
    setArticles(visibleArticles);
    setSelectedId(visibleArticles[0]?.id ?? null);
    setContinuation(undefined);
    setScope(startupScope);
    setMode(restoredMode);
    beginReadingSession(startupScope, restoredMode, true);
    setView("list");
    notify("已进入预览模式");
  }, [beginReadingSession, notify]);

  /**
   * Restore the current runtime's account on startup; the browser's ?preview=1 flag and
   * connection-page button share preview initialization.
   * 启动时恢复当前运行时账号；浏览器 `?preview=1` 与连接页按钮共用同一预览初始化。
   */
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      if (platform.isPreviewRequested()) {
        if (!cancelled) {
          enterPreview();
          setStarting(false);
        }
        return;
      }

      try {
        const saved = await rssClient.loadSavedConnection();
        if (!saved || cancelled) return;

        const modeStorageKey = getArticleModeStorageKey(saved, false);
        const scopeStorageKey = getListScopeStorageKey(saved, false);
        const savedModes = loadArticleModes(modeStorageKey);

        // Load the subscription tree before validating the saved scope or selecting the first valid
        // folder.
        // 必须先得到订阅树，才能校验上次范围或选择第一个有效文件夹。
        const bootstrap = await rssClient.bootstrapAccount();
        unreadRefreshRequestedAtRef.current = Date.now();
        const { scope: startupScope, mode: restoredMode } = resolveStartupTarget(
          startupPageModeRef.current, loadListScope(scopeStorageKey), savedModes, bootstrap.feeds, bootstrap.folders,
        );
        const firstPage = await rssClient.getStream({
          streamId: getStreamId(startupScope),
          unreadOnly: restoredMode === "unread",
        });
        if (cancelled) return;

        articleModeStorageKeyRef.current = modeStorageKey;
        listScopeStorageKeyRef.current = scopeStorageKey;
        articleModesRef.current = savedModes;
        setConnection(saved);
        setFeeds(bootstrap.feeds);
        setFolders(bootstrap.folders);
        setReadingListUnreadCount(bootstrap.readingListUnreadCount);
        setFeedUnreadCounts(createFeedUnreadCounts(bootstrap.feeds));
        setArticles(firstPage.items);
        setContinuation(firstPage.continuation);
        setSelectedId(firstPage.items[0]?.id ?? null);
        setScope(startupScope);
        setMode(restoredMode);
        beginReadingSession(startupScope, restoredMode, true);
      } catch (error) {
        if (!cancelled) notify(normalizeRssError(error).message);
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    void restore();
    return () => { cancelled = true; };
  }, [beginReadingSession, enterPreview, notify, platform, rssClient]);

  /**
   * Reconcile sidebar counts with FreshRSS's unread-count endpoint. Read-state writes during the
   * request may make the returned snapshot stale; use both request sequence numbers and mutation
   * versions to discard outdated responses.
   *
   * 使用 FreshRSS 的 unread-count 端点校准侧边栏数字。
   *
   * 请求期间如果又发生了已读写操作，返回的快照可能早于本地最新意图，
   * 因而通过请求序号和 mutation 版本共同丢弃过期响应。
   */
  const reconcileUnreadCounts = useCallback(async (announceResult: boolean) => {
    if (previewMode) {
      if (announceResult) notify("预览数据无需从 FreshRSS 校准");
      return;
    }

    const requestSequence = ++unreadRefreshSequenceRef.current;
    const mutationVersion = unreadMutationVersionRef.current;
    unreadRefreshRequestedAtRef.current = Date.now();

    try {
      const snapshot = await rssClient.refreshUnreadCounts();
      if (
        requestSequence !== unreadRefreshSequenceRef.current
        || mutationVersion !== unreadMutationVersionRef.current
      ) return;

      setReadingListUnreadCount(snapshot.readingListUnreadCount);
      setFeedUnreadCounts(snapshot.feedUnreadCounts);
      if (announceResult) notify("未读数量已刷新");
    } catch (error) {
      // Keep automatic recovery silent; show an additional error only when a manual refresh fails.
      // 自动恢复时保持静默；手动刷新失败才需要额外提示用户。
      if (announceResult) notify(normalizeRssError(error).message);
    }
  }, [notify, previewMode, rssClient]);

  /**
   * Reconcile unread counts in the background when switching feeds; reuse the snapshot within the
   * same minute.
   * 切换到 Feed 时在后台校准未读数，同一分钟内复用现有快照。
   */
  useEffect(() => {
    if (!connection || previewMode || scope.kind !== "feed") return;
    if (Date.now() - unreadRefreshRequestedAtRef.current < UNREAD_REFRESH_THROTTLE_MS) return;
    void reconcileUnreadCounts(false);
  }, [connection, previewMode, reconcileUnreadCounts, scope]);

  /**
   * Re-enter the current list by fetching the first page and authoritative unread counts
   * concurrently, then rebuild the reading session and pagination. Preserve the old list if
   * fetching articles fails; apply either result only if it still belongs to the current scope.
   *
   * 重新进入当前列表：并发拉取第一页和权威未读计数，成功后重建阅读会话与分页。
   * 文章失败时保留旧列表；任一结果都必须仍属于当前范围才允许写入界面。
   */
  const refreshCurrentList = useCallback(async () => {
    if (previewMode) {
      const refreshedArticles = applyPreviewScope(scope, mode);
      setSelectedId(refreshedArticles[0]?.id ?? null);
      beginReadingSession(scope, mode, true);
      setListRefreshKey((key) => key + 1);
      notify("列表已刷新");
      return;
    }

    const listSequence = ++requestSequenceRef.current;
    const unreadSequence = ++unreadRefreshSequenceRef.current;
    const unreadMutationVersion = unreadMutationVersionRef.current;
    unreadRefreshRequestedAtRef.current = Date.now();

    // The current continuation and its pending responses belong to the old list and must not append
    // after refresh.
    // 当前 continuation 及其在途响应都属于旧列表，刷新后不得继续追加。
    loadMoreRequestRef.current += 1;
    loadMoreInFlightRef.current = false;
    setLoadingMore(false);
    setLoadingList(true);

    const [pageResult, unreadResult] = await Promise.allSettled([
      rssClient.getStream({
        streamId: getStreamId(scope),
        unreadOnly: mode === "unread",
      }),
      rssClient.refreshUnreadCounts(),
    ]);

    // If the user switches scopes during refresh, only the new scope's request may update the UI.
    // 用户在刷新期间切换了范围时，新范围的请求拥有界面写入权。
    if (listSequence !== requestSequenceRef.current) return;

    if (
      unreadResult.status === "fulfilled"
      && unreadSequence === unreadRefreshSequenceRef.current
      && unreadMutationVersion === unreadMutationVersionRef.current
    ) {
      setReadingListUnreadCount(unreadResult.value.readingListUnreadCount);
      setFeedUnreadCounts(unreadResult.value.feedUnreadCounts);
    }

    if (pageResult.status === "fulfilled") {
      setArticles(pageResult.value.items);
      setContinuation(pageResult.value.continuation);
      setSelectedId(pageResult.value.items[0]?.id ?? null);
      beginReadingSession(scope, mode, true);
      setListRefreshKey((key) => key + 1);
      notify(unreadResult.status === "rejected"
        ? "文章列表已刷新，未读数量刷新失败"
        : "列表已刷新");
    } else {
      notify(normalizeRssError(pageResult.reason).message);
    }

    if (listSequence === requestSequenceRef.current) setLoadingList(false);
  }, [applyPreviewScope, beginReadingSession, mode, notify, previewMode, scope, rssClient]);

  /**
   * Mark the entire current FreshRSS stream as read, then rebuild the list using its first page and
   * unread counts. Fix the time boundary after confirmation so articles arriving during the
   * operation are not marked accidentally.
   *
   * 把当前 FreshRSS stream 整体标记为已读，再用第一页与未读计数重建列表。
   * 时间边界固定在用户确认之后，操作期间新到达的文章不会被误标。
   */
  const markCurrentListRead = useCallback(async () => {
    if (previewMode) {
      const newlyReadFeedIds = new Set<string>();
      for (const [articleId, article] of previewArticlesRef.current) {
        if (article.isRead || !articleMatchesPreviewScope(article, scope, previewFolders)) continue;
        newlyReadFeedIds.add(article.feedId);
        previewArticlesRef.current.set(articleId, { ...article, isRead: true });
      }

      const previewArticles = Array.from(previewArticlesRef.current.values());
      setReadingListUnreadCount(previewArticles.filter((article) => !article.isRead).length);
      setFeedUnreadCounts(createPreviewFeedUnreadCounts(previewFeeds, previewArticles));
      recordFeedsMarkedRead(newlyReadFeedIds);
      const visibleArticles = applyPreviewScope(scope, mode);
      setSelectedId(visibleArticles[0]?.id ?? null);
      beginReadingSession(scope, mode, true);
      setListRefreshKey((key) => key + 1);
      return;
    }

    const targetScope = scope;
    const targetMode = mode;
    const streamId = getStreamId(targetScope);
    const beforeTimestampUsec = `${Date.now()}000`;
    const listSequence = ++requestSequenceRef.current;

    // Old continuations and pending responses must not overwrite the list after a bulk operation
    // finishes.
    // 旧 continuation 及在途响应不能在批量操作完成后重新写回列表。
    loadMoreRequestRef.current += 1;
    loadMoreInFlightRef.current = false;
    setLoadingMore(false);
    setLoadingList(true);
    unreadMutationVersionRef.current += 1;

    try {
      await rssClient.markStreamRead({ streamId, beforeTimestampUsec });
      if (listSequence !== requestSequenceRef.current) {
        void reconcileUnreadCounts(false);
        return;
      }

      const newlyReadFeedIds = new Set(
        targetScope.kind === "feed"
          ? (feedUnreadCounts[targetScope.id] ?? 0) > 0 ? [targetScope.id] : []
          : targetScope.kind === "folder"
            ? (folders.find((folder) => folder.id === targetScope.id)?.feedIds ?? [])
              .filter((feedId) => (feedUnreadCounts[feedId] ?? 0) > 0)
            : targetScope.kind === "reading-list"
              ? Object.entries(feedUnreadCounts)
                .filter(([, unreadCount]) => unreadCount > 0)
                .map(([feedId]) => feedId)
              : articles.filter((article) => !article.isRead).map((article) => article.feedId),
      );
      recordFeedsMarkedRead(newlyReadFeedIds);

      // Reflect the successful server operation in the current UI even if the subsequent refresh
      // fails.
      // 即使随后的刷新失败，也先让已成功的服务端操作正确反映在当前画面。
      setArticles((current) => targetMode === "unread"
        ? []
        : current.map((article) => ({ ...article, isRead: true })));
      setContinuation(undefined);
      if (targetMode === "unread") setSelectedId(null);

      const unreadSequence = ++unreadRefreshSequenceRef.current;
      const mutationVersion = unreadMutationVersionRef.current;
      unreadRefreshRequestedAtRef.current = Date.now();
      const [pageResult, unreadResult] = await Promise.allSettled([
        rssClient.getStream({ streamId, unreadOnly: targetMode === "unread" }),
        rssClient.refreshUnreadCounts(),
      ]);
      if (listSequence !== requestSequenceRef.current) return;

      const pageIsFresh = pageResult.status === "fulfilled" && !pageResult.value.fromCache;
      if (pageIsFresh) {
        setArticles(pageResult.value.items);
        setContinuation(pageResult.value.continuation);
        setSelectedId(pageResult.value.items[0]?.id ?? null);
      }

      const countsAreFresh = unreadResult.status === "fulfilled"
        && unreadSequence === unreadRefreshSequenceRef.current
        && mutationVersion === unreadMutationVersionRef.current;
      if (countsAreFresh) {
        setReadingListUnreadCount(unreadResult.value.readingListUnreadCount);
        setFeedUnreadCounts(unreadResult.value.feedUnreadCounts);
      }

      beginReadingSession(targetScope, targetMode, true);
      setListRefreshKey((key) => key + 1);
      if (!pageIsFresh || !countsAreFresh) {
        notify("已全部标记为已读，但部分列表信息刷新失败");
      }
    } catch (error) {
      if (listSequence === requestSequenceRef.current) {
        notify(normalizeRssError(error).message);
      }
      throw error;
    } finally {
      if (listSequence === requestSequenceRef.current) setLoadingList(false);
    }
  }, [applyPreviewScope, articles, beginReadingSession, feedUnreadCounts, folders, mode, notify, previewMode, reconcileUnreadCounts, recordFeedsMarkedRead, scope, rssClient]);

  /**
   * Submit final article states and use a separate operation sequence for each field to handle
   * out-of-order responses.
   *
   * 提交文章最终状态，并用每个字段独立的操作序号抵御响应乱序。
   */
  const commitArticleState = useCallback(async (
    articleIds: string[],
    field: MutableArticleState,
    value: boolean,
  ) => {
    const operationId = ++mutationSequenceRef.current;
    const articleIdSet = new Set(articleIds);
    const previousArticles = articles.filter((article) => articleIdSet.has(article.id));
    const newlyReadFeedIds = field === "read" && value
      ? new Set(previousArticles.filter((article) => !article.isRead).map((article) => article.feedId))
      : new Set<string>();
    const previousValues = new Map(
      previousArticles.map((article) => [
        article.id,
        field === "read" ? article.isRead : article.isStarred,
      ]),
    );
    const readingSessionVersion = readingSessionVersionRef.current;
    const sessionAddedIds = new Set<string>();
    const sessionRemovedIds = new Set<string>();
    const sessionExcludedIds = new Set<string>();

    // Register operation sequences before updating React state so even an immediate network failure
    // can roll back correctly.
    // 操作序号必须在 React 状态更新前登记，网络极快失败时也能正确回滚。
    for (const articleId of previousValues.keys()) {
      latestMutationRef.current.set(`${field}:${articleId}`, operationId);
    }

    // Part 1: record rollback values and update the UI immediately.
    // 第一部分：记录回滚值并立即更新 UI。
    setArticles((current) => current.map((article) => {
      if (!articleIdSet.has(article.id)) return article;
      return field === "read"
        ? { ...article, isRead: value }
        : { ...article, isStarred: value };
    }));

    // Update global unread counts optimistically, counting only articles whose state actually
    // changed.
    // 全局未读数也采用乐观更新，并且只计算状态确实发生变化的文章。
    if (field === "read") {
      unreadMutationVersionRef.current += 1;
      const unreadDelta = Array.from(previousValues.values()).reduce((total, previous) => {
        if (previous === value) return total;
        return total + (value ? -1 : 1);
      }, 0);
      if (unreadDelta) {
        setReadingListUnreadCount((count) => Math.max(0, count + unreadDelta));
      }

      // Derive feed and global counts from the same state delta; calculate folder counts from the
      // current feed counts.
      // Feed 数量与全局数量使用同一次状态差异，文件夹数量由 Feed 实时汇总。
      const feedDeltas = new Map<string, number>();
      for (const article of previousArticles) {
        if (article.isRead === value) continue;
        feedDeltas.set(article.feedId, (feedDeltas.get(article.feedId) ?? 0) + (value ? -1 : 1));
      }
      setFeedUnreadCounts((current) => applyFeedUnreadDeltas(current, feedDeltas));

      // Count only unread articles actually consumed in this list session; do not count the same
      // article twice.
      // 只记录本次列表会话真正消费的未读文章；同篇文章不会重复累计。
      const sessionReadIds = sessionReadArticleIdsRef.current;
      const initiallyReadIds = sessionInitiallyReadArticleIdsRef.current;
      for (const article of previousArticles) {
        if (article.isRead === value) continue;
        if (value) {
          if (!initiallyReadIds.has(article.id) && !sessionReadIds.has(article.id)) {
            sessionReadIds.add(article.id);
            sessionAddedIds.add(article.id);
          }
        } else if (sessionReadIds.delete(article.id)) {
          sessionRemovedIds.add(article.id);
        } else if (!initiallyReadIds.has(article.id)) {
          // Articles already read when the session began are not part of this session's reading
          // progress.
          // 会话开始时已经读过的文章不属于本次阅读进度。
          initiallyReadIds.add(article.id);
          sessionExcludedIds.add(article.id);
        }
      }
      setSessionReadCount(sessionReadIds.size);
    }

    if (field === "starred") {
      const sessionStarredIds = sessionStarredArticleIdsRef.current;
      const initiallyStarredIds = sessionInitiallyStarredArticleIdsRef.current;
      for (const article of previousArticles) {
        if (article.isStarred === value) continue;
        if (value) {
          if (!initiallyStarredIds.has(article.id) && !sessionStarredIds.has(article.id)) {
            sessionStarredIds.add(article.id);
            sessionAddedIds.add(article.id);
          }
        } else if (sessionStarredIds.delete(article.id)) {
          sessionRemovedIds.add(article.id);
        } else if (!initiallyStarredIds.has(article.id)) {
          // Articles already starred when the session began are not newly starred in this session.
          // 会话开始时已经收藏的文章不属于本次新增收藏。
          initiallyStarredIds.add(article.id);
          sessionExcludedIds.add(article.id);
        }
      }
      setSessionStarredCount(sessionStarredIds.size);
    }

    if (previewMode) {
      // Update the full mock collection in preview mode so state survives switching to another
      // scope.
      // 预览模式还要更新完整 mock 集合，切换到其他范围后状态才不会丢失。
      for (const articleId of articleIds) {
        const article = previewArticlesRef.current.get(articleId);
        if (!article) continue;
        previewArticlesRef.current.set(articleId, field === "read"
          ? { ...article, isRead: value }
          : { ...article, isStarred: value });
      }
      recordFeedsMarkedRead(newlyReadFeedIds);
      return true;
    }

    // Part 2: in live mode, send explicit final states to the current RSS adapter.
    // 第二部分：真实模式把明确的最终状态发送到当前 RSS 适配器。
    try {
      const result = await rssClient.editEntryStates({
        articleIds,
        read: field === "read" ? value : undefined,
        starred: field === "starred" ? value : undefined,
        operationId,
      });
      recordFeedsMarkedRead(newlyReadFeedIds);

      // Avoid extra requests after ordinary successful writes; reconcile silently only after
      // automatic reauthentication.
      // 普通成功写入不额外请求；只有自动重登后才进行一次静默校准。
      if (result.reauthenticated) void reconcileUnreadCounts(false);
      return true;
    } catch (error) {
      // Part 3: roll back only fields that still represent the latest intent; an old failure must
      // not overwrite later clicks.
      // 第三部分：只回滚仍是最新意图的字段，旧失败不能覆盖后续点击。
      const rollbackIds = new Set(articleIds.filter(
        (articleId) => latestMutationRef.current.get(`${field}:${articleId}`) === operationId,
      ));
      setArticles((current) => current.map((article) => {
        const previous = previousValues.get(article.id);
        if (previous === undefined || !rollbackIds.has(article.id)) return article;
        return field === "read"
          ? { ...article, isRead: previous }
          : { ...article, isStarred: previous };
      }));

      // Revert only unread count changes that have not been superseded by newer operations.
      // 仅撤销没有被更新操作覆盖的未读数变化。
      if (field === "read") {
        const unreadDelta = Array.from(rollbackIds).reduce((total, articleId) => {
          const previous = previousValues.get(articleId);
          if (previous === undefined || previous === value) return total;
          return total + (value ? 1 : -1);
        }, 0);
        if (unreadDelta) {
          setReadingListUnreadCount((count) => Math.max(0, count + unreadDelta));
        }

        const feedDeltas = new Map<string, number>();
        for (const article of previousArticles) {
          if (!rollbackIds.has(article.id) || article.isRead === value) continue;
          feedDeltas.set(article.feedId, (feedDeltas.get(article.feedId) ?? 0) + (value ? 1 : -1));
        }
        setFeedUnreadCounts((current) => applyFeedUnreadDeltas(current, feedDeltas));

        // Apply failed-operation rollbacks only to the originating reading session, without
        // affecting a subsequently selected list.
        // 失败回滚只作用于发起操作的同一阅读会话，不能污染后来切换的列表。
        if (readingSessionVersionRef.current === readingSessionVersion) {
          const sessionReadIds = sessionReadArticleIdsRef.current;
          const initiallyReadIds = sessionInitiallyReadArticleIdsRef.current;
          for (const articleId of rollbackIds) {
            if (sessionAddedIds.has(articleId)) sessionReadIds.delete(articleId);
            if (sessionRemovedIds.has(articleId)) sessionReadIds.add(articleId);
            if (sessionExcludedIds.has(articleId)) initiallyReadIds.delete(articleId);
          }
          setSessionReadCount(sessionReadIds.size);
        }
      }
      if (field === "starred" && readingSessionVersionRef.current === readingSessionVersion) {
        const sessionStarredIds = sessionStarredArticleIdsRef.current;
        const initiallyStarredIds = sessionInitiallyStarredArticleIdsRef.current;
        for (const articleId of rollbackIds) {
          if (sessionAddedIds.has(articleId)) sessionStarredIds.delete(articleId);
          if (sessionRemovedIds.has(articleId)) sessionStarredIds.add(articleId);
          if (sessionExcludedIds.has(articleId)) initiallyStarredIds.delete(articleId);
        }
        setSessionStarredCount(sessionStarredIds.size);
      }
      notify(normalizeRssError(error).message);

      // If the write outcome is uncertain, roll back locally and then reconcile silently with the
      // authoritative endpoint.
      // 写入结果不确定时，在完成本地回滚后用权威端点静默校准一次。
      void reconcileUnreadCounts(false);
      return false;
    }
  }, [articles, notify, previewMode, reconcileUnreadCounts, recordFeedsMarkedRead, rssClient]);

  /**
   * Toggle the read state of one article.
   * 把单篇文章切换到与当前值相反的已读状态。
   */
  const toggleRead = useCallback((id: string) => {
    const article = articles.find((candidate) => candidate.id === id);
    if (article) void commitArticleState([id], "read", !article.isRead);
  }, [articles, commitArticleState]);

  /**
   * Toggle the starred state of one article.
   * 把单篇文章切换到与当前值相反的收藏状态。
   */
  const toggleStar = useCallback((id: string) => {
    const article = articles.find((candidate) => candidate.id === id);
    if (article) void commitArticleState([id], "starred", !article.isStarred);
  }, [articles, commitArticleState]);

  /**
   * Exclude already-read articles, then submit an explicit final read state for the remaining
   * batch.
   * 过滤已经读过的条目后，批量提交明确的已读最终状态。
   */
  const markArticlesRead = useCallback((ids: string[]) => {
    const unreadIds = ids.filter((id) => !articles.find((article) => article.id === id)?.isRead);
    if (unreadIds.length) void commitArticleState(unreadIds, "read", true);
  }, [articles, commitArticleState]);

  /**
   * Wait for remote results on bulk toolbar actions; keep the confirmation layer open on failure so
   * the user can retry.
   * 工具栏批量操作需要等待远端结果，失败时让确认层保持打开以便重试。
   */
  const markArticlesAboveRead = useCallback(async (ids: string[]) => {
    const unreadArticleIds = new Set(
      articles.filter((article) => !article.isRead).map((article) => article.id),
    );
    const unreadIds = ids.filter((id) => unreadArticleIds.has(id));
    if (!unreadIds.length) return;
    const succeeded = await commitArticleState(unreadIds, "read", true);
    if (!succeeded) throw new Error("上方文章标记已读失败");
  }, [articles, commitArticleState]);

  /**
   * Share reader and mark-as-read logic between normal opening and history restoration; do not
   * change browser history here.
   * 普通打开和历史恢复共用正文及已读逻辑，不在这里改写浏览器历史。
   */
  const openArticleContent = useCallback((id: string) => {
    const article = articles.find((candidate) => candidate.id === id);
    if (article && !article.isRead) void commitArticleState([id], "read", true);
    setSelectedId(id);
    setReturnHighlight(null);
    setReaderResetKey((key) => key + 1);
    setCanReopenReader(false);
    setView("reader");
    window.scrollTo({ top: 0 });
  }, [articles, commitArticleState]);

  /**
   * Record history when the user opens an article; browser forward navigation only restores
   * existing entries.
   * 用户打开文章时记录历史；浏览器前进只恢复已有记录。
   */
  const openArticle = useCallback((id: string) => {
    recordReaderHistory(id);
    openArticleContent(id);
  }, [openArticleContent, recordReaderHistory]);

  /**
   * Consume reader history on system back; the next back action from the list remains the browser's
   * responsibility.
   * 系统返回先消费正文历史；列表上的下一次返回仍由浏览器处理。
   */
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      readerBackPendingRef.current = false;
      const marker = event.state?.__swipyrssReader as {
        session?: string;
        articleId?: string;
      } | undefined;
      if (marker?.session === readerHistorySessionRef.current
        && marker.articleId && articles.some((article) => article.id === marker.articleId)) {
        readerHistoryActiveRef.current = true;
        openArticleContent(marker.articleId);
      } else {
        const wasReader = readerHistoryActiveRef.current;
        readerHistoryActiveRef.current = false;
        if (wasReader) restoreArticleList();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [articles, openArticleContent, restoreArticleList]);

  /**
   * Append a page using the current continuation and deduplicate articles by ID. A synchronous ref
   * locks requests before React updates loadingMore; scope and request sequences keep slow
   * responses from an old feed out of a newly selected list.
   *
   * 使用当前 continuation 追加一页，并按文章 ID 去重。
   *
   * 同步 ref 在 React 更新 loadingMore 以前就锁住请求；范围序号和请求序号
   * 则保证旧 Feed 的慢响应不能混入用户后来打开的新列表。
   */
  const loadMore = useCallback(async (reason: LoadMoreReason) => {
    if (!continuation || previewMode || loadMoreInFlightRef.current) return;

    const requestId = ++loadMoreRequestRef.current;
    const listSequence = requestSequenceRef.current;
    const requestedContinuation = continuation;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);

    try {
      const page = await rssClient.getStream({
        streamId: getStreamId(scope),
        unreadOnly: mode === "unread",
        continuation: requestedContinuation,
      });

      // If the scope or subsequent request has changed, discard this response without touching UI
      // state.
      // 列表范围或后续请求已经变化时，当前响应只作废，不触碰界面状态。
      if (
        requestId !== loadMoreRequestRef.current
        || listSequence !== requestSequenceRef.current
      ) return;

      setArticles((current) => {
        const knownIds = new Set(current.map((article) => article.id));
        return [...current, ...page.items.filter((article) => !knownIds.has(article.id))];
      });
      setContinuation(page.continuation);
    } catch (error) {
      const stillCurrent = requestId === loadMoreRequestRef.current
        && listSequence === requestSequenceRef.current;
      if (!stillCurrent) return;

      // Keep automatic preloading silent; show specific errors only when the user retries at the
      // end of the list.
      // 自动预加载保持安静；用户点击末尾重试时才展示具体错误。
      if (reason === "manual") notify(normalizeRssError(error).message);
      throw error;
    } finally {
      if (requestId === loadMoreRequestRef.current) {
        loadMoreInFlightRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [continuation, mode, notify, previewMode, scope, rssClient]);

  /**
   * Switch to adjacent folders or feeds in stable sidebar order without wrapping at the boundaries.
   * 依照侧边栏的稳定顺序切换相邻文件夹或 Feed，到边界时不循环。
   */
  const selectPreviousList = useCallback((): NextListTarget | null => {
    if (!previousListTarget) return null;
    selectScope({ kind: previousListTarget.kind, id: previousListTarget.id });
    return previousListTarget;
  }, [previousListTarget, selectScope]);
  const selectNextList = useCallback((): NextListTarget | null => {
    if (!nextListTarget) return null;
    selectScope({ kind: nextListTarget.kind, id: nextListTarget.id });
    return nextListTarget;
  }, [nextListTarget, selectScope]);

  /**
   * Apply preferences immediately and save them on this device; retain the current choice if
   * storage is unavailable.
   * 偏好立即生效并保存在当前设备；存储不可用时仍保留本次选择。
   */
  const changeSwipeMarkReadMode = useCallback((nextMode: SwipeMarkReadMode) => {
    setSwipeMarkReadMode(nextMode);
    try {
      window.localStorage.setItem(SWIPE_MARK_READ_STORAGE_KEY, nextMode);
    } catch {
      // Unavailable local storage must not block list operations.
      // 本地存储不可用不阻断列表操作。
    }
  }, []);

  /**
   * Save the preference for the next initialization without reloading the current list or startup
   * effect.
   * 立即保存偏好，下次初始化时使用；不触发当前列表或启动 effect 重载。
   */
  const changeStartupPageMode = useCallback((nextMode: StartupPageMode) => {
    setStartupPageMode(nextMode);
    startupPageModeRef.current = nextMode;
    try { window.localStorage.setItem(STARTUP_PAGE_STORAGE_KEY, nextMode); }
    catch { /*
     * Keep the settings for this session when storage is unavailable.
     * 存储不可用时仍保留本次会话中的设置。
     */ }
  }, []);

  const changeToolbarPosition = useCallback((position: ToolbarPosition) => {
    setToolbarPosition(position);
    try { window.localStorage.setItem(TOOLBAR_POSITION_STORAGE_KEY, position); }
    catch { /*
     * Apply the setting to this session even when storage is unavailable.
     * 存储不可用时仍在当前会话生效。
     */ }
  }, []);

  /**
   * Reuse the full connection flow from settings, then return to the refreshed list on success.
   * 设置页复用完整连接流程，成功后返回刷新过的列表。
   */
  const saveSettings = useCallback(async (input: FreshRssConnectionInput) => {
    await connect(input);
    notify("FreshRSS 连接信息已更新");
  }, [connect, notify]);

  /**
   * Delegate article opening to the selected platform, optionally displaying its embedded view.
   * 将原文打开方式交给所选平台；平台提供内嵌视图时在应用中展示。
   */
  const openExternal = useCallback((url: string) => {
    if (externalArticles.kind === "external") {
      void externalArticles.open(url).catch((error) => notify(normalizeRssError(error).message));
      return;
    }
    setExternalUrl(url);
  }, [externalArticles, notify]);
  /**
   * Keep the underlying reader component and scroll position unchanged when closing the
   * original-page overlay.
   * 关闭原文覆盖层后，背后的正文组件和滚动位置保持不变。
   */
  const closeExternal = useCallback(() => setExternalUrl(null), []);
  /**
   * Return to the reader and show a readable error if the platform's embedded view fails.
   * 平台提供的内嵌视图失败时，退回正文并显示可读错误。
   */
  const handleExternalError = useCallback((error: unknown) => {
    notify(normalizeRssError(error).message);
    setExternalUrl(null);
  }, [notify]);

  if (starting) {
    return <main className="grid h-dvh place-items-center bg-canvas text-sm text-muted">正在恢复 SwipyRSS…</main>;
  }

  if (!connection && !previewMode) {
    return <ConnectPage connectionDefaults={connectionDefaults} onConnect={connect} onPreview={enterPreview}/>;
  }

  return (
    <div className="h-dvh min-h-0 overflow-hidden lg:grid lg:grid-cols-[284px_minmax(0,1fr)]">
      <div className="contents" inert={shortcutHelpOpen}>
        <Sidebar
          drawerRef={drawerRef}
          open={sidebarOpen}
          mode={mode}
          feeds={feeds}
          folders={folders}
          selectedFolderId={selectedFolder?.id ?? null}
          selectedFeedId={selectedFeed?.id ?? null}
          starredSelected={scope.kind === "starred"}
          feedUnreadCounts={feedUnreadCounts}
          unreadCount={readingListUnreadCount}
          apiConfigured={Boolean(connection)}
          settingsActive={view === "settings"}
          onClose={closeSidebar}
          onOpenSettings={openSettings}
          onSelectMode={(nextMode) => selectScope(READING_LIST_SCOPE, nextMode)}
          onSelectStarred={() => selectScope({ kind: "starred" })}
          onSelectFolder={(folderId) => selectScope({ kind: "folder", id: folderId })}
          onSelectFeed={(feedId) => selectScope({ kind: "feed", id: feedId })}
        />
      </div>
      <button ref={backdropRef} className={`fixed inset-y-0 left-0 z-40 w-full border-0 bg-[rgba(14,24,38,.28)] transition-opacity duration-300 lg:hidden ${sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"}`} aria-label="关闭侧边栏" onClick={closeSidebar}/>
      <main ref={mainRef} className="relative h-full min-h-0 min-w-0 overflow-hidden" inert={shortcutHelpOpen}>
        {view === "settings" ? (
          <SettingsPage connectionDefaults={connectionDefaults} startupPageMode={startupPageMode} onStartupPageModeChange={changeStartupPageMode} toolbarPosition={toolbarPosition} onToolbarPositionChange={changeToolbarPosition} connection={connection} configured={Boolean(connection)} swipeMarkReadMode={swipeMarkReadMode} onSwipeMarkReadModeChange={changeSwipeMarkReadMode} onCancel={() => setView("list")} onOpenSidebar={openSidebar} onOpenShortcutHelp={() => setShortcutHelpOpen(true)} onSave={saveSettings}/>
        ) : (
          <>
            <div className="h-full min-h-0" aria-hidden={view === "reader"} inert={view === "reader"}>
              <ArticleListPage
                articles={articles}
                feeds={feeds}
                refreshKey={listRefreshKey}
                mode={mode}
                isStarredList={scope.kind === "starred"}
                toolbarPosition={toolbarPosition}
                autoCollapsePaused={loadingList || shortcutHelpOpen || Boolean(externalUrl)}
                sidebarOpen={sidebarOpen}
                sideToolbarCollapsedRef={sideListToolbarCollapsedRef}
                swipeMarkReadMode={swipeMarkReadMode}
                selectedFeed={selectedFeed}
                selectedFolder={selectedFolder}
                folderFeeds={folderFeeds}
                feedUnreadCounts={feedUnreadCounts}
                feedReadMarkedAt={feedReadMarkedAt}
                active={view === "list"}
                readingArticleId={view === "reader" ? selectedId : null}
                returnHighlight={returnHighlight}
                onReturnHighlightHandled={consumeReturnHighlight}
                unreadCount={currentListUnreadCount}
                sessionReadCount={sessionReadCount}
                sessionStarredCount={sessionStarredCount}
                nextListTarget={nextListTarget}
                previousListTarget={previousListTarget}
                canReopenReader={canReopenReader}
                hasMore={Boolean(continuation)}
                loadingMore={loadingMore}
                markAllReadScopeName={markAllReadScopeName}
                onModeChange={(nextMode) => selectScope(scope, nextMode)}
                onSelectFeed={(feedId) => selectScope({ kind: "feed", id: feedId })}
                onSelectFolder={(folderId) => selectScope({ kind: "folder", id: folderId })}
                onNextList={selectNextList}
                onPreviousList={selectPreviousList}
                onReopenReader={reopenReader}
                onLoadMore={loadMore}
                onRefreshList={refreshCurrentList}
                onMarkAllRead={markCurrentListRead}
                onMarkAboveRead={markArticlesAboveRead}
                onOpenSidebar={openSidebar}
                onOpenArticle={openArticle}
                onOpenExternal={openExternal}
                onMarkRead={markArticlesRead}
                onToggleRead={toggleRead}
                onToggleStar={toggleStar}
              />
            </div>
            {selectedArticle ? (
              <ReaderPage
                toolbarPosition={toolbarPosition}
                open={view === "reader"}
                obscured={Boolean(externalUrl)}
                resetKey={readerResetKey}
                article={selectedArticle}
                feedIconUrl={feedsById.get(selectedArticle.feedId)?.iconUrl}
                onBack={closeReader}
                onSwipeBack={closeReaderFromSwipe}
                onKeyboardBack={closeReader}
                onPrevious={previousArticle ? () => openArticle(previousArticle.id) : undefined}
                onNext={nextArticle ? () => openArticle(nextArticle.id) : undefined}
                onToggleRead={() => toggleRead(selectedArticle.id)}
                onToggleStar={() => toggleStar(selectedArticle.id)}
                onOpenExternal={openExternal}
                onToast={notify}
              />
            ) : null}
          </>
        )}
        {loadingList ? <div className="article-loading-overlay absolute inset-0 z-40 grid place-items-center text-sm text-muted backdrop-blur-sm">正在加载文章…</div> : null}
        {externalUrl && ExternalArticleView ? (
          <ExternalArticleView
            url={externalUrl}
            onClose={closeExternal}
            onError={handleExternalError}
            onToast={notify}
          />
        ) : null}
        <div className={`absolute top-5 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300 ${toast ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"}`} role="status">{toast}</div>
      </main>
      <KeyboardShortcutHelp view={view} mode={mode} swipeMarkReadMode={swipeMarkReadMode} disabled={Boolean(externalUrl) || loadingList} manualOpen={shortcutHelpOpen} onClose={closeShortcutHelp} onOpenSettings={openSettings}/>
      <GestureDebugPanel view={view} sidebarOpen={sidebarOpen}/>
    </div>
  );
}
