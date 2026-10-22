/**
 * The article list scope selected by the user.
 * 用户选择的文章列表范围。
 */
export type ArticleMode = "all" | "unread";

/**
 * The article list shown whenever the application starts.
 * 每次启动应用时进入的文章列表。
 */
export type StartupPageMode = "unread" | "all" | "first-folder" | "first-feed" | "last-list";

/**
 * Which list modes automatically mark the previous screen as read when paging forward.
 * 翻到下一屏时，哪些列表模式自动将上一屏标记为已读。
 */
export type SwipeMarkReadMode = "off" | "both" | "unread" | "all";

/**
 * Toolbar placement shared by the list and reader.
 * 列表和正文共用的工具栏位置。
 */
export type ToolbarPosition = "left" | "bottom" | "right";

/**
 * The top-level page currently displayed in the main content area.
 * 主内容区当前显示的一级页面。
 */
export type AppView = "list" | "reader" | "settings";

/**
 * Raw connection input submitted by the form to Rust.
 * 连接表单提交给 Rust 的原始输入。
 */
export type FreshRssConnectionInput = {
  apiUrl: string;
  username: string;
  password: string;
};

/**
 * Non-sensitive saved connection fields that can safely be displayed in the UI.
 * 已保存连接中可以安全回显给 UI 的非敏感字段。
 */
export type SavedFreshRssConnection = {
  apiUrl: string;
  username: string;
};

/**
 * The stable domain model for a FreshRSS subscription feed.
 * FreshRSS 订阅源的稳定领域模型。
 */
export type Feed = {
  id: string;
  title: string;
  feedUrl?: string;
  siteUrl?: string;
  iconUrl?: string;
  folderIds: string[];
  unreadCount?: number;
};

/**
 * FreshRSS folders store feed IDs rather than mutable titles for associations.
 * FreshRSS 文件夹只保存 Feed ID，避免用可变化的标题做关联。
 */
export type FeedFolder = {
  id: string;
  name: string;
  feedIds: string[];
  unreadCount?: number;
};

/**
 * The article model returned by Rust to the reader. Keep id and feedId as strings so large Google
 * Reader-compatible API IDs do not lose precision in JavaScript.
 *
 * Rust 返回给阅读界面的文章模型。
 *
 * `id` 和 `feedId` 必须保持字符串，避免 Google Reader compatible API
 * 的大整数 ID 在 JavaScript 中损失精度。
 */
export type Article = {
  id: string;
  feedId: string;
  feedTitle: string;
  feedColor: string;
  publishedAt: number;
  author?: string;
  title: string;
  summaryText: string;
  contentHtml: string;
  articleUrl?: string;
  enclosure?: {
    url: string;
    mimeType?: string;
  };
  language: "zh-CN" | "en";
  tags: string[];
  isRead: boolean;
  isStarred: boolean;
};

/**
 * Articles and the next-page cursor returned by one stream request.
 * 一次 stream 请求返回的文章和下一页游标。
 */
export type StreamPage = {
  items: Article[];
  continuation?: string;
  fromCache: boolean;
  stale: boolean;
};

/**
 * The source of a load-more request, distinguishing silent preloading from an explicit user retry.
 * 加载更多的触发来源，用于区分静默预加载和用户明确重试。
 */
export type LoadMoreReason = "prefetch" | "manual";

/**
 * Fixed article height tiers used for stable pagination within the available height.
 * 列表条目的固定高度档位，用于稳定地按可用高度进行分页。
 */
export type ArticleHeightClass = "compact" | "title-only" | "standard";

/**
 * Card layout measured from the title so normal cards and adjacent previews use identical
 * typography.
 * 标题测量得到的卡片布局，用于让正常卡片与相邻预览保持同一排版。
 */
export type ArticleCardLayout = {
  heightClass: ArticleHeightClass;
  titleFitsOneLine: boolean;
};

/**
 * All remote metadata needed to build the sidebar after application startup.
 * 应用启动后构造侧边栏需要的全部远端元数据。
 */
export type AccountBootstrap = {
  feeds: Feed[];
  folders: FeedFolder[];
  readingListUnreadCount: number;
};

/**
 * A lightweight authoritative snapshot of unread counts, without the subscription tree or article
 * content.
 * 未读数量的轻量权威快照，不包含订阅树和文章内容。
 */
export type UnreadCountSnapshot = {
  readingListUnreadCount: number;
  feedUnreadCounts: Record<string, number>;
};

/**
 * The write result indicates whether unread counts need reconciliation after automatic
 * reauthentication.
 * 写操作结果；用于判断是否需要在自动重登后重新校准未读数量。
 */
export type EntryStateResult = {
  reauthenticated: boolean;
};

/**
 * An adjacent scope targeted by bottom-list navigation or the toolbar.
 * 列表底部或工具栏将要跳转的相邻范围。
 */
export type NextListTarget =
  | { kind: "folder"; id: string; name: string }
  | { kind: "feed"; id: string; name: string };

/**
 * A stable, serializable error structure returned by Rust commands.
 * Rust command 可序列化返回的稳定错误结构。
 */
export type AppError = {
  kind: string;
  message: string;
  retryable: boolean;
};
