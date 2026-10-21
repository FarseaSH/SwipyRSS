import type { Article } from "@/types";

/** The target is inclusive; never substitute the current screen's last article. */
export function unreadIdsThroughArticle(articles: readonly Article[], articleId: string): string[] {
  const index = articles.findIndex((article) => article.id === articleId);
  return index < 0 ? [] : articles.slice(0, index + 1).filter((article) => !article.isRead).map((article) => article.id);
}

export type MenuViewport = { left: number; top: number; width: number; height: number };

/** Flip each axis independently before clamping to the visible viewport. */
export function contextMenuPosition(x: number, y: number, width: number, height: number, viewport: MenuViewport) {
  const leftEdge = viewport.left + 8;
  const topEdge = viewport.top + 8;
  const rightEdge = viewport.left + viewport.width - 8;
  const bottomEdge = viewport.top + viewport.height - 8;
  const left = x + width > rightEdge ? x - width : x;
  const top = y + height > bottomEdge ? y - height : y;
  return {
    left: Math.max(leftEdge, Math.min(left, rightEdge - width)),
    top: Math.max(topEdge, Math.min(top, bottomEdge - height)),
  };
}
