import { ArrowRight, ArrowUpToLine, CheckCheck, Star } from "lucide-react";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { FeedIcon } from "@/components/FeedIcon";
import type { Article, Feed } from "@/types";
import { contextMenuPosition, touchContextMenuPosition } from "../contextMenu";
import type { ArticleMenuAnchor } from "../hooks/useArticleContextMenu";

type Props = {
  anchor: ArticleMenuAnchor;
  article: Article;
  feed?: Feed;
  mixed: boolean;
  canMarkAbove: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onStar: () => void;
  onMarkAbove: () => void;
  onMarkFeed: () => void;
  onSelectFeed: () => void;
};

export function ArticleContextMenu(props: Props) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const menu = props.menuRef.current;
    if (!menu) return;
    const card = props.anchor.input === "touch"
      ? Array.from(document.querySelectorAll<HTMLElement>(".article-card[data-article-id]"))
        .find((element) => element.dataset.articleId === props.anchor.articleId)
      : undefined;
    const place = () => {
      const viewport = window.visualViewport;
      const bounds = {
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
      };
      const styles = getComputedStyle(menu);
      const safe = (edge: string) => Number.parseFloat(styles.getPropertyValue(`--menu-safe-${edge}`)) || 0;
      const left = safe("left"), right = safe("right"), top = safe("top"), bottom = safe("bottom");
      bounds.left += left;
      bounds.top += top;
      bounds.width -= left + right;
      bounds.height -= top + bottom;
      const margin = props.anchor.input === "touch" ? 24 : 16;
      menu.style.maxWidth = `${Math.max(0, bounds.width - margin)}px`;
      menu.style.maxHeight = `${Math.max(0, bounds.height - margin)}px`;
      const rect = menu.getBoundingClientRect();
      if (card) {
        const position = touchContextMenuPosition(card.getBoundingClientRect(), rect.width, rect.height, bounds, props.anchor.x);
        menu.style.maxHeight = `${position.maxHeight}px`;
        setPosition(position);
      } else {
        setPosition(contextMenuPosition(props.anchor.x, props.anchor.y, rect.width, rect.height, bounds));
      }
    };
    place();
    menu.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    if (card) observer.observe(card);
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [props.anchor, props.menuRef]);
  const run = (action: () => void) => { props.onClose(); action(); };
  const feedName = props.feed?.title ?? props.article.feedTitle;
  return createPortal(
    <div ref={props.menuRef} className="article-context-menu" role="menu" aria-label="文章操作" tabIndex={-1}
      style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden" }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
            : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        } else if (event.key === "Tab") { event.preventDefault(); props.onClose(); }
      }}>
      <button role="menuitem" onClick={() => run(props.onStar)}><Star size={17} fill={props.article.isStarred ? "currentColor" : "none"} className={props.article.isStarred ? "starred" : undefined}/><span>{props.article.isStarred ? "取消收藏" : "收藏该文章"}</span></button>
      <button role="menuitem" disabled={!props.canMarkAbove} title={props.canMarkAbove ? undefined : "该条及上方没有未读文章"} onClick={() => run(props.onMarkAbove)}><ArrowUpToLine size={17}/><span>上方已读</span></button>
      {props.mixed ? <>
        <div className="article-context-separator" role="separator"/>
        <div className="article-context-feed" title={feedName}><FeedIcon iconUrl={props.feed?.iconUrl}/><span>{feedName}</span></div>
        <button role="menuitem" onClick={() => run(props.onMarkFeed)}><CheckCheck size={17}/><span>此 Feed 全部已读</span></button>
        <button role="menuitem" onClick={() => run(props.onSelectFeed)}><ArrowRight size={17}/><span>前往此 Feed</span></button>
      </> : null}
    </div>, document.body,
  );
}

export function FeedReadConfirmation({ name, busy, error, onCancel, onConfirm }: {
  name: string; busy: boolean; error: string; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<div className="feed-read-confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div ref={ref} className="feed-read-confirm" role="dialog" aria-modal="true" aria-labelledby="feed-read-confirm-title" aria-describedby="feed-read-confirm-description" aria-busy={busy}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); if (!busy) onCancel(); }
        if (event.key === "Tab") {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          event.preventDefault();
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
      <h2 id="feed-read-confirm-title">标记该 Feed 全部已读？</h2>
      <p className="feed-read-confirm-name" title={name}>{name}</p>
      <p id="feed-read-confirm-description">将包含该 Feed 尚未加载的文章。此操作不可一键撤销。</p>
      {error ? <p role="alert" className="mark-read-confirm-error">{error}</p> : null}
      <div className="feed-read-confirm-actions"><button disabled={busy} onClick={onCancel}>取消</button><button className="mark-read-confirm-submit" disabled={busy} onClick={onConfirm}><CheckCheck size={16}/>{busy ? "正在标记…" : "确认全部已读"}</button></div>
    </div>
  </div>, document.body);
}
