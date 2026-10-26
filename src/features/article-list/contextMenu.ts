import type { Article } from "@/types";

/** The target is inclusive; never substitute the current screen's last article. */
export function unreadIdsThroughArticle(articles: readonly Article[], articleId: string): string[] {
  const index = articles.findIndex((article) => article.id === articleId);
  return index < 0 ? [] : articles.slice(0, index + 1).filter((article) => !article.isRead).map((article) => article.id);
}

export type MenuViewport = { left: number; top: number; width: number; height: number };

/** Touch menus follow the press horizontally and the card vertically, with a 12px gap. */
export function touchContextMenuPosition(card: MenuViewport, width: number, height: number, viewport: MenuViewport, touchX = card.left + card.width / 2) {
  const gap = 12;
  const leftEdge = viewport.left + gap;
  const topEdge = viewport.top + gap;
  const rightEdge = viewport.left + viewport.width - gap;
  const bottomEdge = viewport.top + viewport.height - gap;
  const aboveBottom = Math.min(bottomEdge, card.top - gap);
  const belowTop = Math.max(topEdge, card.top + card.height + gap);
  const above = Math.max(0, aboveBottom - topEdge);
  const below = Math.max(0, bottomEdge - belowTop);
  const useAbove = height <= above || (height > below && above >= below);
  const available = useAbove ? above : below;
  // An unusually tall card can occupy the entire visible viewport. Keep the menu usable then.
  const maxHeight = available || Math.max(0, bottomEdge - topEdge);
  const menuHeight = Math.min(height, maxHeight);
  return {
    left: Math.max(leftEdge, Math.min(touchX - width / 2, rightEdge - width)),
    top: available ? (useAbove ? aboveBottom - menuHeight : belowTop) : topEdge,
    maxHeight,
  };
}

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
