/**
 * Return only visible text lines, excluding text hidden by line-clamp.
 * 只返回实际显示的文字行，排除 line-clamp 隐藏的文字。
 */
export function getArticleTextRects(card: HTMLElement): DOMRect[] {
  return Array.from(card.querySelectorAll<HTMLElement>(".article-heading, .article-summary"))
    .flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects()).filter((rect) => (
        Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top)
          >= Math.max(10, rect.height * 0.5)
      ));
    });
}

/**
 * The focus area excludes preview articles inside the upper and lower paging masks.
 * 聚焦区不包含上下翻屏遮罩中的预览条目。
 */
export function getFocusedArticleIds(viewport: HTMLElement): string[] {
  const bounds = viewport.getBoundingClientRect();
  const top = Math.max(bounds.top, viewport.querySelector(".article-edge-control.previous")
    ?.getBoundingClientRect().bottom ?? bounds.top);
  const bottom = Math.min(bounds.bottom, viewport.querySelector(".article-edge-control.next")
    ?.getBoundingClientRect().top ?? bounds.bottom);
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-article-id]"))
    .filter((card) => {
      const bounds = card.getBoundingClientRect();
      return bounds.top >= top - 1 && bounds.top < bottom
        && getArticleTextRects(card).some((rect) => (
          Math.min(rect.bottom, bottom) - Math.max(rect.top, top)
            >= Math.max(10, rect.height * 0.5)
        ));
    })
    .map((card) => card.dataset.articleId!);
}
