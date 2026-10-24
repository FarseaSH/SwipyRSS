import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronUp, ExternalLink, Share2, Star, UserRound } from "lucide-react";
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { useSideToolbarDismiss } from "@/components/useSideToolbarDismiss";
import { ToolbarAnchor } from "@/components/ToolbarAnchor";
import { FeedIcon } from "@/components/FeedIcon";
import { ReadStateIcon } from "@/components/ReadStateIcon";
import type { Article, ToolbarPosition } from "@/types";
import { isInteractiveReaderTarget, useReaderInteraction } from "../hooks/useReaderInteraction";

type Props = {
  open: boolean;
  toolbarPosition: ToolbarPosition;
  obscured?: boolean;
  resetKey: number;
  article: Article;
  feedIconUrl?: string;
  onBack: () => void;
  onSwipeBack: () => void;
  onKeyboardBack: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onOpenExternal: (url: string) => void;
  onToast: (message: string) => void;
};

const SANITIZE_OPTIONS: DOMPurifyConfig = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "svg", "math", "audio", "video"],
  FORBID_ATTR: ["style", "srcset"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
};

/**
 * Display sanitized article content and coordinate reading gestures, state actions, and external
 * links.
 *
 * 展示清洗后的文章正文，并协调阅读手势、状态操作和外链跳转。
 */
export function ReaderPage({ toolbarPosition, open, obscured = false, resetKey, article, feedIconUrl, onBack, onSwipeBack, onKeyboardBack, onPrevious, onNext, onToggleRead, onToggleStar, onOpenExternal, onToast }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const continuityMarkerRef = useRef<HTMLDivElement>(null);
  const positionMarkerRef = useRef<HTMLDivElement>(null);
  const swipeLeftHintRef = useRef<HTMLDivElement>(null);
  const originalArticleUrl = useMemo(
    () => normalizeExternalHttpUrl(article.articleUrl),
    [article.articleUrl],
  );
  const openOriginalArticle = useCallback(() => {
    if (originalArticleUrl) onOpenExternal(originalArticleUrl);
  }, [onOpenExternal, originalArticleUrl]);
  const { toolbarDimmed, wakeToolbar, resetToolbar, collapseToolbar } = useReaderInteraction(
    viewportRef,
    continuityMarkerRef,
    positionMarkerRef,
    panelRef,
    onSwipeBack,
    onKeyboardBack,
    open && !obscured,
    toolbarPosition !== "bottom",
    originalArticleUrl ? openOriginalArticle : undefined,
    swipeLeftHintRef,
  );
  useSideToolbarDismiss(toolbarRef, open && !obscured && toolbarPosition !== "bottom" && !toolbarDimmed, collapseToolbar);
  const sanitizedContent = useMemo(
    () => sanitizeArticleHtml(article.contentHtml, article.articleUrl),
    [article.articleUrl, article.contentHtml],
  );


  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = 0;

    // The reader reuses the same DOM. Even when transparent, absolute markers from the previous
    // article can extend a short article's scrollHeight through their top and height values.
    // 阅读页复用同一个 DOM；旧文章的绝对定位标记即使透明，
    // 其 top/height 仍会把短文章的 scrollHeight 撑长。
    for (const marker of [continuityMarkerRef.current, positionMarkerRef.current]) {
      if (!marker) continue;
      marker.classList.remove("visible");
      marker.style.removeProperty("top");
      marker.style.removeProperty("height");
    }
    resetToolbar();
  }, [article.id, resetKey, resetToolbar]);

  useEffect(() => {
    if (!open || obscured) return;
    resetToolbar();
    // Focus the content scroll wrapper so arrow keys and PageUp/PageDown work immediately.
    // 键盘焦点进入正文滚动容器，使方向键和 PageUp/PageDown 立即可用。
    const frame = window.requestAnimationFrame(() => {
      viewportRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, obscured, resetKey, resetToolbar]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // The sanitizer removes unsafe URLs; add runtime attributes for image loading and privacy here.
    // 清洗器负责删除危险地址；这里补上图片加载和隐私相关的运行时属性。
    viewport.querySelectorAll<HTMLImageElement>(".reader-html img").forEach((image) => {
      image.loading = "lazy";
      image.referrerPolicy = "no-referrer";
      image.decoding = "async";
    });
    viewport.querySelectorAll<HTMLElement>(".reader-html pre").forEach((codeBlock) => {
      codeBlock.tabIndex = 0;
      codeBlock.dataset.readerHorizontalScroll = "";
      codeBlock.setAttribute("aria-label", "代码块，可左右滚动");
    });
  }, [sanitizedContent]);

  /**
   * Prefer system sharing; fall back to copying the actual article URL when unsupported.
   * 优先调用系统分享能力，不支持时退化为复制真实文章链接。
   */
  const share = async () => {
    if (toolbarDimmed) { wakeToolbar(); return; }
    const shareUrl = article.articleUrl ?? location.href;
    try {
      if (navigator.share) await navigator.share({ title: article.title, text: article.summaryText, url: shareUrl });
      else { await navigator.clipboard?.writeText(shareUrl); onToast("文章链接已复制"); }
    } catch { /*
     * No feedback is needed when the user cancels sharing.
     * 用户取消分享时无需反馈
     */ }
  };

  /**
   * Intercept links in sanitized content so third-party pages cannot replace the main application
   * WebView.
   * 拦截清洗后正文中的链接，避免第三方页面替换主应用 WebView。
   */
  const openContentLink = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;

    event.preventDefault();
    try {
      const url = new URL(anchor.href, article.articleUrl);
      if (url.protocol === "http:" || url.protocol === "https:") onOpenExternal(url.href);
      else onToast("暂不支持打开这种链接");
    } catch {
      onToast("文章链接无效");
    }
  };

  /**
   * The first click on a dormant toolbar only wakes it to prevent accidental article state changes.
   * 工具栏休眠时第一次点击只唤醒，避免用户误操作文章状态。
   */
  const act = (action: () => void) => {
    if (toolbarDimmed) { wakeToolbar(); return; }
    action();
  };

  /**
   * Article shortcuts reuse button callbacks and execute immediately even when the toolbar is
   * dormant.
   * 文章级快捷键复用按钮回调，工具栏休眠时也立即执行。
   */
  const handleArticleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!open || obscured || event.defaultPrevented || event.nativeEvent.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isInteractiveReaderTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key !== "[" && key !== "]" && key !== "enter" && key !== "s") return;
    event.preventDefault();
    wakeToolbar();
    if (key === "[" || key === "]") {
      const navigate = key === "[" ? onPrevious : onNext;
      if (navigate) navigate();
      else onToast(key === "[" ? "没有上一篇文章" : "没有下一篇文章");
    } else if (key === "enter") {
      if (originalArticleUrl) onOpenExternal(originalArticleUrl);
      else onToast("当前文章没有可用的原文链接");
    } else {
      onToggleStar();
    }
  };

  return (
    <section
      ref={panelRef}
      data-toolbar-position={toolbarPosition}
      className={`reader-panel ${open ? "open" : ""} ${obscured ? "obscured" : ""}`}
      aria-hidden={!open || obscured}
      inert={!open || obscured}
      onKeyDown={handleArticleKeyDown}
    >
      <button
        className="reader-back-button"
        style={{ opacity: toolbarDimmed ? 0.48 : 1 }}
        onClick={onBack}
        aria-label="返回文章列表"
      ><ChevronLeft size={24}/></button>
      <div
        className="reader-article-nav"
        style={{ opacity: toolbarDimmed ? 0.48 : 1 }}
        role="group"
        aria-label="切换文章"
      >
        <button className="reader-article-nav-button" onClick={onPrevious} disabled={!onPrevious} aria-label={onPrevious ? "上一篇文章" : "没有上一篇文章"}><ChevronUp size={20}/></button>
        <button className="reader-article-nav-button" onClick={onNext} disabled={!onNext} aria-label={onNext ? "下一篇文章" : "没有下一篇文章"}><ChevronDown size={20}/></button>
      </div>

      <div ref={viewportRef} className="reader-viewport" tabIndex={-1} aria-label="文章正文，可双击定位或使用方向键翻屏，[ 和 ] 切换文章，回车或触屏左滑打开原文，S 切换收藏">
        <article className="reader-document" lang={article.language}>
          <div ref={continuityMarkerRef} className="continuity-marker" aria-hidden="true"/>
          <div ref={positionMarkerRef} className="position-marker" aria-hidden="true"/>
          <div className="reader-copy">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-muted"><FeedIcon iconUrl={feedIconUrl} color={article.feedColor}/><span>{article.feedTitle}</span></div>
            <h1 className="m-0 text-[27px] font-bold leading-[1.15] tracking-[-.035em] text-ink sm:text-[37px]">
              {originalArticleUrl ? (
                <button
                  type="button"
                  className="reader-title-link"
                  title="在应用内打开原文"
                  aria-label={`访问原文：${article.title}`}
                  onClick={() => onOpenExternal(originalArticleUrl)}
                >
                  {article.title}
                </button>
              ) : article.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} strokeWidth={1.8} aria-hidden="true"/><time dateTime={new Date(article.publishedAt).toISOString()}>{article.publishedLabel}</time></span>
              {article.author ? <><span aria-hidden="true">·</span><span className="inline-flex items-center gap-1.5"><UserRound size={14} strokeWidth={1.8} aria-hidden="true"/><span>{article.author}</span></span></> : null}
            </div>
            <div className="reader-html" onClick={openContentLink} dangerouslySetInnerHTML={{ __html: sanitizedContent }}/>
          </div>
        </article>
      </div>

      <div ref={swipeLeftHintRef} className="reader-external-swipe-hint" aria-hidden="true">
        <ExternalLink size={18}/>
        <span className="reader-external-swipe-prompt">左滑打开原文</span>
        <span className="reader-external-swipe-ready">松开打开原文</span>
      </div>

      <ToolbarAnchor position={toolbarPosition}>
        <div ref={toolbarRef} data-toolbar-position={toolbarPosition} className={`reader-toolbar ${toolbarPosition !== "bottom" ? "side-toolbar" : ""} ${toolbarDimmed ? "dimmed" : ""}`} onClick={() => { if (toolbarDimmed) wakeToolbar(); }} aria-label={toolbarDimmed ? "点击激活阅读工具栏" : "阅读工具栏"}>
          <button className="reader-tool" aria-label={article.isRead ? "取消已读" : "标记已读"} onClick={(e) => { e.stopPropagation(); act(onToggleRead); }}>
            <span className="reader-tool-icon" aria-hidden="true">{article.isRead ? <Check size={20}/> : <ReadStateIcon isRead={false} size={17}/>}</span>
            <span className="reader-tool-label">{article.isRead ? "取消已读" : "标记已读"}</span>
          </button>
          <button className={`reader-tool reader-star-tool ${article.isStarred ? "starred" : ""}`} aria-label={article.isStarred ? "取消收藏" : "收藏文章"} onClick={(e) => { e.stopPropagation(); act(onToggleStar); }}>
            <span className="reader-star-icon" aria-hidden="true"><Star size={17} fill={article.isStarred ? "currentColor" : "none"}/></span>
            <span className="reader-tool-label">{article.isStarred ? "取消收藏" : "收藏文章"}</span>
          </button>
          <button className="reader-tool" aria-label="分享文章" onClick={(e) => { e.stopPropagation(); void share(); }}>
            <span className="reader-tool-icon" aria-hidden="true"><Share2 size={17}/></span>
            <span className="reader-tool-label">分享文章</span>
          </button>
        </div>
      </ToolbarAnchor>
    </section>
  );
}

/**
 * Create a clickable title only for HTTP/HTTPS article URLs. Treat FreshRSS data as untrusted:
 * invalid URLs and other schemes leave the title as plain text rather than an unusable link. Rust
 * validates the URL again before opening it.
 *
 * 只为 HTTP/HTTPS 原文地址生成标题入口。
 *
 * FreshRSS 数据仍视为不可信输入；无效地址或其他协议保持普通标题，避免
 * 创建一个看似可点击但最终无法打开的入口。真正打开前 Rust 端还会复核一次。
 */
function normalizeExternalHttpUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sanitize article content, then apply a second stage of URL constraints. DOMPurify handles
 * elements and attributes; inspect images and links separately in the actual DOM so links may use
 * HTTP/HTTPS while content images require HTTPS.
 *
 * 清洗正文并对 URL 做第二阶段约束。
 *
 * DOMPurify 负责元素和属性安全；随后使用真实 DOM 分别检查图片与链接，
 * 从而实现“链接可 HTTP/HTTPS，但正文图片只允许 HTTPS”的差异化策略。
 */
function sanitizeArticleHtml(html: string, articleUrl?: string): string {
  const template = document.createElement("template");
  template.innerHTML = DOMPurify.sanitize(html, SANITIZE_OPTIONS);

  template.content.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    try {
      const source = new URL(image.getAttribute("src") ?? "", articleUrl);
      if (source.protocol !== "https:") throw new Error("insecure image URL");
      image.src = source.href;
    } catch {
      image.removeAttribute("src");
      image.dataset.imageBlocked = "true";
      image.alt ||= "图片已阻止加载";
    }
  });

  // Some feeds output URLs as plain text; linkify them first, then validate all URLs consistently.
  // 部分 RSS 正文把网址作为普通文本输出；先将其转换为链接，再统一校验地址。
  linkifyPlainTextUrls(template.content);

  template.content.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
    try {
      // Resolve relative links only against the actual article URL, never accidentally against the
      // local application URL.
      // 相对链接只能以真实文章地址为基准，不能意外解析成本地应用地址。
      const destination = new URL(anchor.getAttribute("href") ?? "", articleUrl);
      if (destination.protocol !== "http:" && destination.protocol !== "https:") {
        throw new Error("unsupported link protocol");
      }
      anchor.href = destination.href;
      anchor.removeAttribute("target");
      anchor.rel = "noopener noreferrer";
    } catch {
      anchor.removeAttribute("href");
    }
  });

  return template.innerHTML;
}

/**
 * Convert plain HTTP/HTTPS URLs in article text into clickable links. Preserve existing links and
 * code blocks to avoid nested links or altered examples, and exclude trailing Chinese or English
 * sentence punctuation from the URL.
 *
 * 将正文中的 HTTP/HTTPS 纯文本网址转换为可点击链接。
 *
 * 已存在的链接以及代码块保持原样，避免产生嵌套链接或改变代码示例；URL
 * 末尾属于自然语言的中英文标点也不会被错误地收入链接地址。
 */
function linkifyPlainTextUrls(root: DocumentFragment): void {
  const urlCandidatePattern = /https?:\/\/[^\s<>"']+/i;
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;
  const trailingPunctuationPattern = /[.,!?;:，。！？；：、)）\]】}》〉”’]+$/u;
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("a, code, pre")) return NodeFilter.FILTER_REJECT;
      return urlCandidatePattern.test(node.textContent ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  // Do not modify the DOM while TreeWalker is traversing it; replacing nodes could skip subsequent
  // text.
  // TreeWalker 遍历期间不直接改 DOM，避免替换节点导致后续文本被跳过。
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  textNodes.forEach((textNode) => {
    const text = textNode.data;
    const replacement = document.createDocumentFragment();
    let cursor = 0;

    for (const match of text.matchAll(urlPattern)) {
      const matchIndex = match.index ?? 0;
      const rawUrl = match[0];
      const linkUrl = rawUrl.replace(trailingPunctuationPattern, "");
      if (!linkUrl) continue;

      replacement.append(text.slice(cursor, matchIndex));
      const anchor = document.createElement("a");
      anchor.href = linkUrl;
      anchor.textContent = linkUrl;
      replacement.append(anchor);

      // Keep stripped sentence-ending punctuation as ordinary article text.
      // 被剥离的句末标点仍作为普通正文保留。
      replacement.append(rawUrl.slice(linkUrl.length));
      cursor = matchIndex + rawUrl.length;
    }

    replacement.append(text.slice(cursor));
    textNode.replaceWith(replacement);
  });
}
