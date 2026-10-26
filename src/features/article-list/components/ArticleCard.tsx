import type { TimeSection } from "../timeSections";
import { Star } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ReadStateIcon } from "@/components/ReadStateIcon";
import type { Article, ArticleCardLayout } from "@/types";
import { ArticleCardVisual, ArticleSourceIcon, ArticleSourceLabel } from "./ArticleCardVisual";
import { ArticleShortcutNumber } from "./ArticleShortcutNumber";

type Props = {
  listNow: number;
  timeSectionLabel?: TimeSection;
  article: Article;
  feedIconUrl?: string;
  active: boolean;
  shortcutNumber?: number;
  starShortcutNumber?: number;
  highlightPhase: "idle" | "reading" | "holding" | "releasing";
  onHighlightEnd: () => void;
  feedLinkEnabled: boolean;
  isCurrentFeed: boolean;
  onOpen: () => void;
  onSelectFeed: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onLayoutChange: (articleId: string, layout: ArticleCardLayout) => void;
  suppressClick: () => boolean;
};

/**
 * Render one article while separating feed navigation and state actions from opening the card.
 * 渲染单篇文章，并把来源跳转和状态操作与卡片打开动作隔离。
 */
export function ArticleCard({ listNow, timeSectionLabel, article, feedIconUrl, active, shortcutNumber, starShortcutNumber, highlightPhase, onHighlightEnd, feedLinkEnabled, isCurrentFeed, onOpen, onSelectFeed, onToggleRead, onToggleStar, onLayoutChange, suppressClick }: Props) {
  const [sourceNotice, setSourceNotice] = useState("");
  const [sourceNoticeVisible, setSourceNoticeVisible] = useState(false);
  const [titleFitsOneLine, setTitleFitsOneLine] = useState(false);
  const titleMeasureRef = useRef<HTMLHeadingElement>(null);
  const sourceNoticeHideTimerRef = useRef<number | null>(null);
  const sourceNoticeClearTimerRef = useRef<number | null>(null);
  const hasSummary = article.summaryText.trim().length > 0;
  const getHeightClass = (fitsOneLine: boolean): ArticleCardLayout["heightClass"] => {
    if (!fitsOneLine) return "title-only";
    return hasSummary ? "standard" : "compact";
  };
  const layout: ArticleCardLayout = {
    heightClass: getHeightClass(titleFitsOneLine),
    titleFitsOneLine,
  };
  const open = () => { if (!suppressClick()) onOpen(); };

  useEffect(() => () => {
    window.clearTimeout(sourceNoticeHideTimerRef.current ?? undefined);
    window.clearTimeout(sourceNoticeClearTimerRef.current ?? undefined);
  }, []);

  useEffect(() => {
    if (!sourceNotice) return;
    // After mounting on demand, paint the hidden state first and then reuse the existing fade-in
    // transition.
    // 按需挂载后先绘制隐藏状态，再沿用原来的淡入过渡。
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => setSourceNoticeVisible(true));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sourceNotice]);

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

  /**
   * Show a brief message when clicking the current feed; delegate other feed clicks to the list
   * wrapper to switch streams.
   *
   * 点击当前来源时给出轻提示；点击其他来源时交给列表容器切换 stream。
   */
  const selectFeed = () => {
    if (!isCurrentFeed) {
      onSelectFeed();
      return;
    }
    window.clearTimeout(sourceNoticeHideTimerRef.current ?? undefined);
    window.clearTimeout(sourceNoticeClearTimerRef.current ?? undefined);
    setSourceNotice("已经到这个来源了");
    // Repeated clicks, including during fade-out, restore visibility and restart the display timer.
    // 重复点击（包括淡出期间）直接恢复显示，并重新计算停留时间。
    if (sourceNotice) setSourceNoticeVisible(true);
    sourceNoticeHideTimerRef.current = window.setTimeout(() => {
      setSourceNoticeVisible(false);
      sourceNoticeClearTimerRef.current = window.setTimeout(() => setSourceNotice(""), 260);
    }, 1600);
  };

  return (
    <article
      className={`article-card ${layout.heightClass} ${article.isRead ? "read" : ""} ${highlightPhase !== "idle" ? `reading-highlight highlight-${highlightPhase}` : ""}`}
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
      onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a")) open(); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
    >
      <span className="article-divider" data-time-tone={timeSectionLabel?.tone} aria-hidden="true">{timeSectionLabel ? <span className="article-time-section"><span className="article-time-section-text">{timeSectionLabel.label}</span></span> : null}</span>
      <ArticleCardVisual
        listNow={listNow}
        article={article}
        titleFitsOneLine={titleFitsOneLine}
        titleMeasureRef={titleMeasureRef}
        source={feedLinkEnabled ? (
            <span className="article-source-wrap">
              <button className="article-source-link" aria-label={isCurrentFeed ? `当前已经是来源 ${article.feedTitle}` : `查看来源 ${article.feedTitle}`} onClick={(event) => { event.stopPropagation(); selectFeed(); }}>
                <ArticleSourceIcon iconUrl={feedIconUrl} color={article.feedColor}/>
                <span className="truncate">{article.feedTitle}</span>
              </button>
              {sourceNotice ? <span className={`article-source-notice ${sourceNoticeVisible ? "visible" : ""}`} role="status">{sourceNotice}</span> : null}
            </span>
          ) : (
            <ArticleSourceLabel article={article} iconUrl={feedIconUrl}/>
          )}
        readAction={<button className="icon-button article-read-button" aria-label={article.isRead ? "取消已读" : "标记已读"} title={article.isRead ? "取消已读" : "标记已读"} onClick={(e) => { e.stopPropagation(); onToggleRead(); }}>{shortcutNumber ? <ArticleShortcutNumber number={shortcutNumber}/> : <ReadStateIcon isRead={article.isRead} size={18}/>}</button>}
        starAction={<button className={`icon-button article-star-button ${article.isStarred ? "starred" : ""} ${starShortcutNumber ? "showing-shortcut" : ""}`} aria-label={article.isStarred ? "取消星标" : "加入星标"} onClick={(e) => { e.stopPropagation(); onToggleStar(); }}>{starShortcutNumber ? <ArticleShortcutNumber number={starShortcutNumber}/> : <Star size={17} fill={article.isStarred ? "currentColor" : "none"}/>}</button>}
      />
    </article>
  );
}
