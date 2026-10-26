import type { TimeSection } from "../timeSections";
import { Star } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { ReadStateIcon } from "@/components/ReadStateIcon";
import type { Article, ArticleCardLayout } from "@/types";
import { ArticleCardVisual, ArticleSourceLabel } from "./ArticleCardVisual";
import { ArticleShortcutNumber } from "./ArticleShortcutNumber";

type Props = {
  listNow: number;
  timeSectionLabel?: TimeSection;
  article: Article;
  feedIconUrl?: string;
  active: boolean;
  contextMenuActive: boolean;
  onContextMenu: (x: number, y: number) => void;
  shortcutNumber?: number;
  starShortcutNumber?: number;
  highlightPhase: "idle" | "reading" | "holding" | "releasing";
  onHighlightEnd: () => void;
  onOpen: (openOriginal: boolean) => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onLayoutChange: (articleId: string, layout: ArticleCardLayout) => void;
  suppressClick: () => boolean;
};

/**
 * Render one article with a static feed label and independent read/star actions.
 * 渲染单篇文章，来源标签随卡片打开正文，已读和收藏操作保持独立。
 */
export function ArticleCard({ listNow, timeSectionLabel, article, feedIconUrl, active, contextMenuActive, onContextMenu, shortcutNumber, starShortcutNumber, highlightPhase, onHighlightEnd, onOpen, onToggleRead, onToggleStar, onLayoutChange, suppressClick }: Props) {
  const [titleFitsOneLine, setTitleFitsOneLine] = useState(false);
  const titleMeasureRef = useRef<HTMLHeadingElement>(null);
  const lastPointerTypeRef = useRef("mouse");
  const hasSummary = article.summaryText.trim().length > 0;
  const getHeightClass = (fitsOneLine: boolean): ArticleCardLayout["heightClass"] => {
    if (!fitsOneLine) return "title-only";
    return hasSummary ? "standard" : "compact";
  };
  const layout: ArticleCardLayout = {
    heightClass: getHeightClass(titleFitsOneLine),
    titleFitsOneLine,
  };
  const open = (openOriginal = false) => { if (!suppressClick()) onOpen(openOriginal); };

  useLayoutEffect(() => {
    const measureElement = titleMeasureRef.current;
    if (!measureElement) return;
    let cancelled = false;

    /**
     * Use the actual font and available width to determine whether the title occupies one line.
     * 使用实际字体和可用宽度判断标题是否只占一行。
     */
    const measureTitle = () => {
      if (cancelled) return;
      const lineHeight = Number.parseFloat(window.getComputedStyle(measureElement).lineHeight);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;

      const fitsOneLine = measureElement.getBoundingClientRect().height <= lineHeight + 1;
      setTitleFitsOneLine((current) => current === fitsOneLine ? current : fitsOneLine);
      onLayoutChange(article.id, {
        heightClass: getHeightClass(fitsOneLine),
        titleFitsOneLine: fitsOneLine,
      });
    };

    // Width changes affect wrapping in both Chinese and English titles; remeasure and report the
    // height tier.
    // 宽度变化会改变中英文标题的换行结果，必须重新测量并报告高度档位。
    const observer = new ResizeObserver(measureTitle);
    observer.observe(measureElement);
    measureTitle();
    void document.fonts?.ready.then(measureTitle);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [article.id, article.title, hasSummary, onLayoutChange]);

  return (
    <article
      className={`article-card ${layout.heightClass} ${article.isRead ? "read" : ""} ${contextMenuActive ? "context-menu-active" : ""} ${highlightPhase !== "idle" ? `reading-highlight highlight-${highlightPhase}` : ""}`}
      onPointerDown={(event) => { lastPointerTypeRef.current = event.pointerType; }}
      onContextMenu={(event) => {
        if (!active) return;
        event.preventDefault();
        event.stopPropagation();
        // Native touch contextmenu must not bypass the pager's 500ms/6px recognition.
        if (lastPointerTypeRef.current !== "mouse") return;
        onContextMenu(event.clientX, event.clientY);
      }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "background-color"
          && !event.nativeEvent.pseudoElement) onHighlightEnd();
      }}
      data-article-id={article.id}
      tabIndex={active ? 0 : -1}
      role="button"
      aria-hidden={!active}
      aria-label={`打开文章：${article.title}`}
      inert={!active}
      onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a")) open(event.ctrlKey || event.metaKey); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
    >
      <span className="article-divider" data-time-tone={timeSectionLabel?.tone} aria-hidden="true">{timeSectionLabel ? <span className="article-time-section"><span className="article-time-section-text">{timeSectionLabel.label}</span></span> : null}</span>
      <ArticleCardVisual
        listNow={listNow}
        article={article}
        titleFitsOneLine={titleFitsOneLine}
        titleMeasureRef={titleMeasureRef}
        source={<ArticleSourceLabel article={article} iconUrl={feedIconUrl}/>}
        readAction={<button className="icon-button article-read-button" aria-label={article.isRead ? "取消已读" : "标记已读"} title={article.isRead ? "取消已读" : "标记已读"} onClick={(e) => { e.stopPropagation(); onToggleRead(); }}>{shortcutNumber ? <ArticleShortcutNumber number={shortcutNumber}/> : <ReadStateIcon isRead={article.isRead} size={18}/>}</button>}
        starAction={<button className={`icon-button article-star-button ${article.isStarred ? "starred" : ""} ${starShortcutNumber ? "showing-shortcut" : ""}`} aria-label={article.isStarred ? "取消星标" : "加入星标"} onClick={(e) => { e.stopPropagation(); onToggleStar(); }}>{starShortcutNumber ? <ArticleShortcutNumber number={starShortcutNumber}/> : <Star size={17} fill={article.isStarred ? "currentColor" : "none"}/>}</button>}
      />
    </article>
  );
}
