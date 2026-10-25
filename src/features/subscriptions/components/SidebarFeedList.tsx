import { useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { FeedIcon } from "@/components/FeedIcon";
import { UnreadCountBadge } from "@/components/UnreadCountBadge";
import type { Feed } from "@/types";
import { scrollbarGeometry } from "./sidebarScroll";

type Props = {
  expanded: boolean;
  feeds: Feed[];
  folderName: string;
  selectedFeedId: string | null;
  feedUnreadCounts: Record<string, number>;
  onSelectFeed: (feedId: string) => void;
};

/** Keep native wheel/touch scrolling; the original tree line becomes its draggable scrollbar. */
export function SidebarFeedList({ expanded, feeds, folderName, selectedFeedId, feedUnreadCounts, onSelectFeed }: Props) {
  const [hasOpened, setHasOpened] = useState(expanded);
  const renderContent = expanded || hasOpened;
  useLayoutEffect(() => { if (expanded) setHasOpened(true); }, [expanded]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startScroll: number } | null>(null);
  const [geometry, setGeometry] = useState(() => scrollbarGeometry(0, 0, 0));
  const viewportId = useId();
  const overflowing = geometry.maxScroll > 0;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const measure = () => setGeometry(scrollbarGeometry(viewport.clientHeight, viewport.scrollHeight, viewport.scrollTop));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("scroll", measure, { passive: true });
    return () => { observer.disconnect(); viewport.removeEventListener("scroll", measure); };
  }, [renderContent]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !viewportRef.current) return;
    event.preventDefault();
    event.stopPropagation(); // Do not turn a thumb drag into the drawer's horizontal close gesture.
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startScroll: viewportRef.current.scrollTop };
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
    const current = scrollbarGeometry(viewport.clientHeight, viewport.scrollHeight, viewport.scrollTop);
    if (current.travel > 0) viewport.scrollTop = drag.startScroll + (event.clientY - drag.startY) * current.maxScroll / current.travel;
  };
  const endDrag = () => { dragRef.current = null; };

  return (
    <div className={`sidebar-feed-collapse ${expanded ? "is-expanded" : ""}`} inert={!expanded} aria-hidden={!expanded}>
      {renderContent ? <div className="sidebar-feed-collapse-clip">
        <div className="sidebar-feed-list">
          <div id={viewportId} ref={viewportRef} className="sidebar-feed-viewport" role="region" aria-label={`${folderName}的订阅源`}>
            <div ref={contentRef} className="sidebar-feed-content">
              {feeds.map((feed) => <button key={feed.id} data-feed-id={feed.id} aria-current={selectedFeedId === feed.id ? "page" : undefined} className={`sidebar-feed-item sidebar-item w-full ${selectedFeedId === feed.id ? "active" : ""}`} onClick={() => onSelectFeed(feed.id)}><FeedIcon iconUrl={feed.iconUrl}/><span className="truncate">{feed.title}</span><UnreadCountBadge className="ml-auto" count={feedUnreadCounts[feed.id] ?? feed.unreadCount ?? 0}/></button>)}
            </div>
          </div>
          {overflowing ? <div
            className="sidebar-feed-scrollbar"
            role="scrollbar" tabIndex={expanded ? 0 : -1} aria-label={`${folderName}滚动条`} aria-controls={viewportId}
            aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(geometry.maxScroll)} aria-valuenow={Math.round(geometry.thumbTop / (geometry.travel || 1) * geometry.maxScroll)}
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
            onKeyDown={(event) => {
              const viewport = viewportRef.current;
              if (!viewport) return;
              const steps: Record<string, number> = { ArrowUp: -36, ArrowDown: 36, PageUp: -viewport.clientHeight, PageDown: viewport.clientHeight, Home: -viewport.scrollHeight, End: viewport.scrollHeight };
              if (!(event.key in steps)) return;
              event.preventDefault(); event.stopPropagation();
              viewport.scrollTop += steps[event.key];
            }}
          ><span className="sidebar-feed-thumb" style={{ height: geometry.thumbHeight, transform: `translateY(${geometry.thumbTop}px)` }}/></div> : null}
        </div>
      </div> : null}
    </div>
  );
}
