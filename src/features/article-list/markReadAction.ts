import type { ArticleMode, SwipeMarkReadMode } from "@/types";

/**
 * Keep Read Above when swipe-to-mark is disabled in All mode; otherwise handle the entire current
 * scope.
 * 所有文章未启用滑动标记时保留“上方已读”，其余情况处理当前整个范围。
 */
export function shouldMarkAboveRead(mode: ArticleMode, swipeMarkReadMode: SwipeMarkReadMode): boolean {
  return mode === "all" && swipeMarkReadMode !== "all" && swipeMarkReadMode !== "both";
}
