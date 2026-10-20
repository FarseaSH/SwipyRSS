import { useEffect, useMemo, useState, type RefObject } from "react";
import type { Article, ArticleCardLayout } from "@/types";

const HEADER_AND_GUTTER = 88;
const TOP_PREVIEW_SPACE = 49;
const COMPACT_ARTICLE_HEIGHT = 82;
const TITLE_ONLY_ARTICLE_HEIGHT = 92;
const STANDARD_ARTICLE_HEIGHT = 104;

export type ArticlePage = {
  articles: Article[];
  /**
   * The actual vertical position of the current group's first article on the continuous track.
   * 当前组第一篇文章在连续轨道中的真实纵向位置。
   */
  startOffset: number;
  /**
   * The sum of the fixed height tiers of all articles in the current group.
   * 当前组全部文章的固定档位高度之和。
   */
  contentHeight: number;
  /**
   * The distance the track must move upward after snapping.
   * 吸附后轨道需要向上移动的距离。
   */
  snapOffset: number;
  /**
   * The fallback starting position of the bottom mask before the DOM is ready.
   * DOM 尚未就绪时使用的底部遮罩起点兜底。
   */
  bottomMaskOffset: number;
};

/**
 * Read an article's fixed height; use the safer standard height until measurement finishes.
 * 读取条目的固定高度；尚未完成测量时采用更安全的标准高度。
 */
function getArticleHeight(
  articleId: string,
  layouts: Readonly<Record<string, ArticleCardLayout>>,
): number {
  switch (layouts[articleId]?.heightClass) {
    case "compact": return COMPACT_ARTICLE_HEIGHT;
    case "title-only": return TITLE_ONLY_ARTICLE_HEIGHT;
    default: return STANDARD_ARTICLE_HEIGHT;
  }
}

/**
 * Place articles sequentially within each screen's actual height budget. Leave the article entering
 * the viewport's bottom as a faded preview with a fixed height. Actual text-obstruction checks
 * during paging determine whether the last main article must also lead the next screen.
 *
 * 按每一屏的真实高度预算依次放入文章。
 *
 * 每组把视口末端已经进入画面的文章留作固定高度的淡化预览。是否需要让
 * 上一屏最后一篇正文再次成为下一屏首篇，由翻页时的真实文字遮挡检测决定。
 */
function paginateArticles(
  articles: Article[],
  layouts: Readonly<Record<string, ArticleCardLayout>>,
  viewportHeight: number,
): ArticlePage[] {
  const pages: ArticlePage[] = [];
  const articleHeights = articles.map((article) => getArticleHeight(article.id, layouts));
  const articleStarts: number[] = [];
  let trackHeight = 0;
  for (const articleHeight of articleHeights) {
    articleStarts.push(trackHeight);
    trackHeight += articleHeight;
  }

  let pageStartIndex = 0;
  while (pageStartIndex < articles.length) {
    const pageIndex = pages.length;
    const startOffset = articleStarts[pageStartIndex] ?? 0;
    const snapOffset = Math.max(
      0,
      startOffset - (pageIndex > 0 ? TOP_PREVIEW_SPACE : 0),
    );
    const visibleTrackEnd = snapOffset + viewportHeight;
    let lastVisibleIndex = pageStartIndex;

    for (let index = pageStartIndex; index < articles.length; index += 1) {
      if ((articleStarts[index] ?? trackHeight) >= visibleTrackEnd) break;
      lastVisibleIndex = index;
    }

    // Leave the bottom preview for the next group; advance by at least one article even in a tiny
    // viewport to avoid a loop.
    // 视口末端的预览项留给下一组；极小视口也至少推进一篇，避免原地循环。
    const nextPageStartIndex = lastVisibleIndex > pageStartIndex
        ? lastVisibleIndex
        : Math.min(articles.length, pageStartIndex + 1);
    const hasNextPage = nextPageStartIndex < articles.length;
    const pageEndIndex = hasNextPage ? nextPageStartIndex : articles.length;
    const pageEndOffset = articleStarts[pageEndIndex] ?? trackHeight;

    const bottomMaskOffset = hasNextPage
      ? Math.max(0, pageEndOffset - snapOffset)
      : viewportHeight;

    pages.push({
      articles: articles.slice(pageStartIndex, pageEndIndex),
      startOffset,
      contentHeight: pageEndOffset - startOffset,
      snapOffset,
      // Use the precomputed page's final preview position as the mask fallback before the actual DOM is
      // ready.
      // 真实 DOM 尚未就绪时，以静态分页的末端预览位置作为遮罩兜底。
      bottomMaskOffset,
    });
    pageStartIndex = nextPageStartIndex;
  }

  return pages;
}

/**
 * Observe the article viewport's actual height and generate pages using fixed height tiers.
 * ResizeObserver covers window resizing, orientation changes, and feed-navigation visibility;
 * visualViewport resize also handles available-height changes from dynamic mobile toolbars.
 *
 * 监听文章视口的真实高度，并返回按固定档位生成的页面。
 *
 * ResizeObserver 覆盖窗口缩放、移动端横竖屏和来源导航出现或消失的情况；
 * visualViewport resize 则补充处理移动端动态工具栏造成的可用高度变化。
 */
export function useArticlePages(
  viewportRef: RefObject<HTMLElement | null>,
  articles: Article[],
  layouts: Readonly<Record<string, ArticleCardLayout>>,
): ArticlePage[] {
  const [viewportHeight, setViewportHeight] = useState(() => {
    if (typeof window === "undefined") return 600;
    const windowHeight = window.visualViewport?.height ?? window.innerHeight;
    return Math.max(STANDARD_ARTICLE_HEIGHT, windowHeight - HEADER_AND_GUTTER);
  });

  useEffect(() => {
    /**
     * Update only when height actually changes to avoid unnecessary rerenders from ResizeObserver.
     * 只在高度确实变化时更新，避免 ResizeObserver 产生无意义重渲染。
     */
    const updateHeight = () => {
      const measuredHeight = viewportRef.current?.clientHeight;
      if (!measuredHeight) return;
      setViewportHeight((current) => current === measuredHeight ? current : measuredHeight);
    };

    const observer = new ResizeObserver(updateHeight);
    updateHeight();
    if (viewportRef.current) observer.observe(viewportRef.current);
    window.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("resize", updateHeight);

    return () => {
      window.removeEventListener("resize", updateHeight);
      window.visualViewport?.removeEventListener("resize", updateHeight);
      observer.disconnect();
    };
  }, [viewportRef]);

  return useMemo(
    () => paginateArticles(articles, layouts, viewportHeight),
    [articles, layouts, viewportHeight],
  );
}
