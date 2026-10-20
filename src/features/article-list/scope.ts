import type { FeedFolder } from "@/types";

export type ListScope =
  | { kind: "reading-list" }
  | { kind: "starred" }
  | { kind: "folder"; id: string }
  | { kind: "feed"; id: string };

/**
 * Convert a UI list scope to a FreshRSS stream ID.
 * 把 UI 列表范围转换成 FreshRSS stream ID。
 */
export function getStreamId(scope: ListScope): string {
  switch (scope.kind) {
    case "reading-list":
      return "user/-/state/com.google/reading-list";
    case "starred":
      return "user/-/state/com.google/starred";
    case "folder":
    case "feed":
      return scope.id;
  }
}

/**
 * Create a stable scope key for resetting pagination and separating cached data.
 * 生成重置翻页和区分缓存所需的稳定范围键。
 */
export function getScopeKey(scope: ListScope): string {
  return `${scope.kind}:${"id" in scope ? scope.id : "root"}`;
}

/**
 * Check whether an article belongs to a preview scope; FreshRSS filters live data on the server.
 * 判断文章是否属于指定的预览范围。真实模式由 FreshRSS 服务端筛选。
 */
export function articleMatchesPreviewScope(
  article: { feedId: string; isStarred: boolean },
  scope: ListScope,
  folders: FeedFolder[],
): boolean {
  switch (scope.kind) {
    case "reading-list":
      return true;
    case "starred":
      return article.isStarred;
    case "feed":
      return article.feedId === scope.id;
    case "folder": {
      const folder = folders.find((candidate) => candidate.id === scope.id);
      return Boolean(folder?.feedIds.includes(article.feedId));
    }
  }
}
