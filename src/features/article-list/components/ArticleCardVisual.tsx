import type { ReactNode, Ref } from "react";
import { FeedIcon } from "@/components/FeedIcon";
import type { Article } from "@/types";
import { formatListPublishedTime } from "../publishedTime";

type VisualProps = {
  listNow: number;
  article: Article;
  titleFitsOneLine: boolean;
  source: ReactNode;
  readAction: ReactNode;
  starAction: ReactNode;
  titleMeasureRef?: Ref<HTMLHeadingElement>;
};

type SourceLabelProps = {
  article: Article;
  iconUrl?: string;
};

/**
 * Render only the article card's visual structure. Normal cards and adjacent previews share this
 * component so feed labels, titles, summaries, and actions retain the same styling. Outer
 * components still handle events and title measurement.
 *
 * 渲染文章卡片的纯视觉结构。
 *
 * 正常卡片和上下相邻预览共用该组件，确保来源、标题、摘要和操作区不会
 * 逐渐形成两套样式。事件语义和标题测量仍由各自的外层组件负责。
 */
export function ArticleCardVisual({ listNow, article, titleFitsOneLine, source, readAction, starAction, titleMeasureRef }: VisualProps) {
  const hasSummary = article.summaryText.trim().length > 0;
  const published = formatListPublishedTime(article.publishedAt, listNow);

  return (
    <>
      <div className="article-read-action">{readAction}</div>
      <div className="article-copy min-w-0">
        <div className="article-meta mb-2 text-xs text-muted">
          {source}
          <span className="article-meta-time" data-recency={published.recency}><time dateTime={published.dateTime}>{published.label}</time></span>
        </div>
        {titleMeasureRef ? <h2 ref={titleMeasureRef} className="article-heading-measure m-0 text-[16px] font-bold leading-[1.38] tracking-[-.015em] sm:text-[17px]" aria-hidden="true">{article.title}</h2> : null}
        <h2 className="article-heading m-0 text-[16px] font-bold leading-[1.38] tracking-[-.015em] sm:text-[17px]">{article.title}</h2>
        {titleFitsOneLine && hasSummary ? <p className="article-summary mt-2 text-sm text-muted">{article.summaryText}</p> : null}
      </div>
      <div className="article-star-action">{starAction}</div>
    </>
  );
}

/**
 * Prefer the FreshRSS feed icon and use the feed's theme color for the fallback RSS icon.
 * 优先使用 FreshRSS 来源图标，并用来源主题色渲染加载失败后的 RSS 图标。
 */
export function ArticleSourceIcon({ iconUrl, color }: { iconUrl?: string; color: string }) {
  return <FeedIcon className="article-source-icon" iconUrl={iconUrl} color={color}/>;
}

/**
 * Render a feed label without its own click behavior for reuse in ordinary text and adjacent
 * previews.
 * 渲染没有独立点击行为的来源标签，供普通文本和相邻预览复用。
 */
export function ArticleSourceLabel({ article, iconUrl }: SourceLabelProps) {
  return (
    <span className="article-source-static">
      <ArticleSourceIcon iconUrl={iconUrl} color={article.feedColor}/>
      <span className="article-source-title">{article.feedTitle}</span>
    </span>
  );
}
