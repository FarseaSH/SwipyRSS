import { getBottomToolbar } from "@/components/toolbarGeometry";

/**
 * A main article must fit fully between the preview masks, with no text obscured by the bottom
 * toolbar.
 * 正式条目必须完整位于两块预览遮罩之间，且文字没有被底部工具栏覆盖。
 */
export function getReturnVisibleArticleIds(viewport: HTMLElement, toolbar: HTMLElement | null): string[] {
  toolbar = getBottomToolbar(toolbar);
  const bounds = viewport.getBoundingClientRect();
  const top = viewport.querySelector(".article-edge-control.previous")?.getBoundingClientRect().bottom ?? bounds.top;
  const bottom = viewport.querySelector(".article-edge-control.next")?.getBoundingClientRect().top ?? bounds.bottom;
  const cover = toolbar?.getBoundingClientRect();
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-article-id]"))
    .filter((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.top < top - 1 || rect.bottom > bottom + 1) return false;
      return !cover || !Array.from(card.querySelectorAll(".article-heading, .article-summary"))
        .some((text) => {
          const bounds = text.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(text);
          return Array.from(range.getClientRects()).some((line) => line.bottom > bounds.top
            && line.top < bounds.bottom && line.left < cover.right && line.right > cover.left
            && line.top < cover.bottom && line.bottom > cover.top);
        });
    }).map((card) => card.dataset.articleId!);
}

/**
 * Place ordinary articles near the top; near the end, include earlier context and reserve space
 * only for the bottom toolbar.
 * 普通文章靠上；接近末尾时向前补足上下文，仅为底部工具栏留出空间。
 */
export function getReturnAnchor(viewport: HTMLElement, toolbar: HTMLElement | null, articleId: string): string | null {
  toolbar = getBottomToolbar(toolbar);
  const cards = Array.from(viewport.querySelectorAll<HTMLElement>("[data-article-id]"));
  const targetIndex = cards.findIndex((card) => card.dataset.articleId === articleId);
  if (targetIndex < 0) return null;
  const target = cards[targetIndex];
  const bounds = viewport.getBoundingClientRect();
  const safeBottom = Math.max(target.offsetHeight + 49, toolbar
    ? Math.min(viewport.clientHeight, toolbar.getBoundingClientRect().top - bounds.top - 8)
    : viewport.clientHeight);
  const last = cards.at(-1)!;
  const endOffset = Math.max(0, last.offsetTop + last.offsetHeight - safeBottom);
  if (Math.max(0, target.offsetTop - 49) <= endOffset) return articleId;
  if (endOffset === 0) return cards[0].dataset.articleId!;
  const firstIndex = cards.findIndex((card) => card.offsetTop >= endOffset + 49);
  return cards[Math.min(firstIndex < 0 ? targetIndex : firstIndex, targetIndex)].dataset.articleId!;
}
