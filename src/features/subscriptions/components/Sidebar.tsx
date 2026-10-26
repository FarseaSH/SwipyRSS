import { ChevronDown, ChevronRight, CircleDot, Inbox, Rss, Star, TriangleAlert, X } from "lucide-react";
import { VersionControls } from "@/features/versions/components/VersionControls";
import { useLayoutEffect, useRef, useState } from "react";
import { SidebarFeedList } from "./SidebarFeedList";
import { folderScrollTop, secondRowScrollTop, sidebarScrollDuration, sidebarMotionProgress } from "./sidebarScroll";
import { UnreadCountBadge } from "@/components/UnreadCountBadge";
import type { ArticleMode, Feed, FeedFolder } from "@/types";

type SidebarProps = {
  drawerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  mode: ArticleMode;
  feeds: Feed[];
  folders: FeedFolder[];
  selectedFolderId: string | null;
  selectedFeedId: string | null;
  starredSelected: boolean;
  feedUnreadCounts: Record<string, number>;
  unreadCount: number;
  apiConfigured: boolean;
  settingsActive: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onSelectMode: (mode: ArticleMode) => void;
  onSelectStarred: () => void;
  onSelectFolder: (folderId: string) => void;
  onSelectFeed: (feedId: string) => void;
};

/**
 * Render the subscription tree with all navigation and counts keyed by stable FreshRSS IDs.
 * 渲染订阅树；所有导航和计数都以 FreshRSS 的稳定 ID 为键。
 */
export function Sidebar({ drawerRef, open, mode, feeds, folders, selectedFolderId, selectedFeedId, starredSelected, feedUnreadCounts, unreadCount, apiConfigured, settingsActive, onClose, onOpenSettings, onSelectMode, onSelectStarred, onSelectFolder, onSelectFeed }: SidebarProps) {
  const [expandedFolderIds, setExpandedFolderIds] = useState(() => new Set(
    selectedFolderId ? [selectedFolderId] : folders[0] ? [folders[0].id] : [],
  ));
  const feedsById = new Map(feeds.map((feed) => [feed.id, feed]));

  const scrollAreaRef = useRef<HTMLElement>(null);
  const selectionKey = settingsActive || starredSelected ? "" : selectedFeedId ? `feed:${selectedFeedId}` : selectedFolderId ? `folder:${selectedFolderId}` : "";
  const lastSelectionRef = useRef<string | null>(null);
  const pendingSelectionRef = useRef(false);
  const initializedFoldersRef = useRef(folders.length > 0);
  const positioningFrameRef = useRef(0);
  const interactionRef = useRef(0);
  const releaseTreeRef = useRef<(() => void) | null>(null);
  const readySelectionRef = useRef<string | null>(null);
  const previousOpenRef = useRef(open);
  const exclusiveFolderRef = useRef<string | null>(null);

  // Only a changed selection (or its first arrival with async data) requests placement.
  // Counts, manual expansion and reopening the drawer must preserve the user's position.
  useLayoutEffect(() => {
    const folder = selectedFeedId
      ? folders.find((candidate) => candidate.id === selectedFolderId && candidate.feedIds.includes(selectedFeedId))
        ?? folders.find((candidate) => candidate.feedIds.includes(selectedFeedId))
      : folders.find((candidate) => candidate.id === selectedFolderId);
    if (!initializedFoldersRef.current && folders[0]) {
      initializedFoldersRef.current = true;
      setExpandedFolderIds((current) => current.size ? current : new Set([folders[0].id]));
    }
    if (lastSelectionRef.current !== selectionKey && (!selectionKey || folder)) {
      cancelAnimationFrame(positioningFrameRef.current);
      lastSelectionRef.current = selectionKey;
      pendingSelectionRef.current = Boolean(folder);
      readySelectionRef.current = null;
      if (!folder || selectedFeedId) exclusiveFolderRef.current = null;
    }
  }, [selectionKey, folders, selectedFolderId, selectedFeedId]);

  useLayoutEffect(() => {
    const reopening = open && !previousOpenRef.current;
    previousOpenRef.current = open;
    if (!pendingSelectionRef.current) return;
    const area = scrollAreaRef.current;
    const drawer = drawerRef.current;
    if (!area || !drawer) return;
    const mobile = !window.matchMedia("(min-width: 1024px)").matches;
    let cancelled = false;

    const interaction = interactionRef.current;
    const current = () => !cancelled && pendingSelectionRef.current && interaction === interactionRef.current;
    const treeAnimations = () => area.getAnimations({ subtree: true }).filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return target instanceof Element && target.matches(".sidebar-feed-collapse, .sidebar-feed-list");
    });
    const instant = mobile || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const position = async () => {
      if (!current()) return;
      readySelectionRef.current = selectionKey;
      const folder = selectedFeedId
        ? folders.find((candidate) => candidate.id === selectedFolderId && candidate.feedIds.includes(selectedFeedId))
          ?? folders.find((candidate) => candidate.feedIds.includes(selectedFeedId))
        : folders.find((candidate) => candidate.id === selectedFolderId);
      if (!folder) return;
      // Close the old group and open the new one in the same commit.
      const exclusive = exclusiveFolderRef.current || !expandedFolderIds.has(folder.id);
      if (!expandedFolderIds.has(folder.id) || (exclusive && expandedFolderIds.size !== 1)) {
        setExpandedFolderIds(new Set(exclusive ? [folder.id] : [...expandedFolderIds, folder.id]));
        return;
      }
      // Pause real height transitions, sample their final layout once, then drive
      // their timeline and the scroll from the same frame clock.
      const motions = treeAnimations().map((animation) => {
        const start = Number(animation.currentTime ?? 0);
        const end = Number(animation.effect?.getComputedTiming().endTime ?? start);
        animation.pause();
        return { animation, start, end };
      });
      releaseTreeRef.current = () => {
        for (const { animation } of motions) {
          if (animation.playState === "paused") animation.play();
        }
      };
      const outerStart = area.scrollTop;
      for (const { animation, end } of motions) animation.currentTime = end;
      const group = Array.from(area.querySelectorAll<HTMLElement>("[data-folder-id]")).find((element) => element.dataset.folderId === folder.id);
      if (!group) return;
      const row = group.querySelector<HTMLElement>(".sidebar-folder-row")!;
      const viewport = group.querySelector<HTMLElement>(".sidebar-feed-viewport");
      const activeFeed = Array.from(group.querySelectorAll<HTMLElement>("[data-feed-id]")).find((feed) => feed.dataset.feedId === selectedFeedId);
      const innerStart = viewport?.scrollTop ?? 0;
      const innerEnd = viewport && activeFeed
        ? secondRowScrollTop(activeFeed.getBoundingClientRect().top - viewport.getBoundingClientRect().top + innerStart, activeFeed.offsetHeight, viewport.scrollHeight, viewport.clientHeight)
        : innerStart;
      // Feed selection keeps its existing second-row placement in both scroll areas.
      const rowRect = row.getBoundingClientRect();
      const itemTop = rowRect.top - area.getBoundingClientRect().top + outerStart;
      const previousGroup = group.previousElementSibling;
      const rowGap = previousGroup ? Math.max(0, group.getBoundingClientRect().top - previousGroup.getBoundingClientRect().bottom) : 0;
      const outerEnd = selectedFeedId
        ? secondRowScrollTop(itemTop, row.offsetHeight + 4, area.scrollHeight, area.clientHeight)
        : folderScrollTop(itemTop, rowRect.height, area.scrollHeight, area.clientHeight, rowGap);
      for (const { animation, start } of motions) animation.currentTime = start;
      area.scrollTop = outerStart;
      const started = performance.now();
      const distance = Math.max(Math.abs(outerEnd - outerStart), Math.abs(innerEnd - innerStart));
      const duration = instant ? 0 : Math.max(motions.length ? 200 : 0, sidebarScrollDuration(distance));
      const place = () => {
        if (!current()) return;
        const progress = duration ? Math.min(1, (performance.now() - started) / duration) : 1;
        const eased = sidebarMotionProgress(progress);
        for (const { animation, start, end } of motions) {
          animation.currentTime = start + (end - start) * progress;
        }
        area.scrollTop = outerStart + (outerEnd - outerStart) * eased;
        if (viewport) viewport.scrollTop = innerStart + (innerEnd - innerStart) * eased;
        if (progress < 1) positioningFrameRef.current = requestAnimationFrame(place);
        else {
          for (const { animation } of motions) animation.finish();
          releaseTreeRef.current = null;
          pendingSelectionRef.current = false;
          exclusiveFolderRef.current = null;
        }
      };
      place();
    };

    if (mobile) {
      if (open && !reopening && readySelectionRef.current !== selectionKey) return;
      const closing = open ? [] : drawer.getAnimations().filter((animation) => animation.playState !== "finished");
      if (closing.length) {
        void Promise.allSettled(closing.map((animation) => animation.finished)).then(() => {
          if (current()) void position();
        });
      } else void position();
    } else void position();
    return () => { cancelled = true; cancelAnimationFrame(positioningFrameRef.current); releaseTreeRef.current?.(); releaseTreeRef.current = null; };
  }, [open, selectionKey, expandedFolderIds, folders, feeds, selectedFolderId, selectedFeedId, drawerRef]);

  useLayoutEffect(() => {
    const area = scrollAreaRef.current;
    const cancel = (event?: Event) => {
      // Repeated activation of the current item leaves its in-flight sequence alone.
      const activation = event?.type === "pointerdown" || (event?.type === "keydown" && ["Enter", " "].includes((event as KeyboardEvent).key));
      if (activation && event?.target instanceof Element
        && event.target.closest('.sidebar-folder-link[aria-current="page"], .sidebar-feed-item[aria-current="page"]')) return;
      releaseTreeRef.current?.();
      releaseTreeRef.current = null;
      interactionRef.current += 1;
      cancelAnimationFrame(positioningFrameRef.current);
      pendingSelectionRef.current = false;
      exclusiveFolderRef.current = null;
    };
    area?.addEventListener("wheel", cancel, { passive: true });
    area?.addEventListener("touchmove", cancel, { passive: true });
    area?.addEventListener("pointerdown", cancel, true);
    area?.addEventListener("keydown", cancel, true);
    return () => {
      cancel();
      area?.removeEventListener("wheel", cancel);
      area?.removeEventListener("touchmove", cancel);
      area?.removeEventListener("pointerdown", cancel, true);
      area?.removeEventListener("keydown", cancel, true);
    };
  }, []);

  const openSettings = () => { onOpenSettings(); onClose(); };
  const select = (next: ArticleMode) => { onSelectMode(next); onClose(); };
  const selectStarred = () => { onSelectStarred(); onClose(); };
  const selectFolder = (folderId: string) => {
    if (selectionKey !== `folder:${folderId}`) exclusiveFolderRef.current = folderId;
    onSelectFolder(folderId);
    onClose();
  };
  const selectFeed = (feedId: string) => {
    onSelectFeed(feedId);
    onClose();
  };
  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };
  return (
    <aside ref={drawerRef} className={`fixed inset-y-0 left-0 z-50 flex h-dvh min-h-0 w-[284px] flex-col overflow-hidden border-r bg-sidebar p-4 transition-transform duration-300 lg:static lg:z-0 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="mb-5 flex h-10 items-center justify-between px-2">
        <div className="flex items-center gap-2.5 font-bold tracking-[-.02em]"><span className="grid size-8 place-items-center rounded-xl bg-ink text-white"><Rss size={17}/></span>SwipyRSS</div>
        <button className="sidebar-close-button icon-button lg:hidden" aria-label="关闭侧边栏" onClick={onClose}><X size={18}/></button>
      </div>
      <nav className="space-y-1" aria-label="主要导航">
        <button className={`sidebar-item ${!settingsActive && !starredSelected && !selectedFolderId && mode === "all" ? "active" : ""}`} onClick={() => select("all")}><Inbox className="sidebar-all-icon" size={17}/>所有文章</button>
        <button className={`sidebar-item ${!settingsActive && !starredSelected && !selectedFolderId && mode === "unread" ? "active" : ""}`} onClick={() => select("unread")}><CircleDot className="sidebar-unread-icon" size={17}/>未读文章<UnreadCountBadge className="ml-auto" count={unreadCount}/></button>
        <button className={`sidebar-item ${!settingsActive && starredSelected ? "active" : ""}`} onClick={selectStarred}><Star className="sidebar-starred-icon" size={17}/>星标文章</button>
      </nav>
      <div className="mt-7 mb-2 flex items-center px-3 text-[11px] font-bold uppercase tracking-[.12em] text-muted"><span>订阅源</span><ChevronDown className="ml-auto" size={14}/></div>
      <nav ref={scrollAreaRef} className="sidebar-scroll-area min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="订阅源">
        {folders.map((folder) => {
          const expanded = expandedFolderIds.has(folder.id);
          const folderPageActive = !settingsActive && selectedFolderId === folder.id && !selectedFeedId;
          // Always derive folder counts from current feed counts so startup snapshots cannot
          // overwrite later optimistic updates.
          // 文件夹数量始终由当前 Feed 计数派生，避免启动快照覆盖后续乐观更新。
          const folderUnreadCount = folder.feedIds.reduce(
            (count, feedId) => count + (feedUnreadCounts[feedId] ?? 0),
            0,
          );
          return (
            <div key={folder.id} data-folder-id={folder.id} className="sidebar-folder-group block w-full">
              <div className={`sidebar-folder-row flex w-full min-w-0 items-center ${folderPageActive ? "active" : ""}`}>
                <button className="sidebar-folder-toggle icon-button" onClick={() => toggleFolder(folder.id)} aria-label={`${expanded ? "收起" : "展开"}${folder.name}`} aria-expanded={expanded}>{expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>
                <button className="sidebar-folder-link sidebar-item min-w-0 flex-1" aria-current={folderPageActive ? "page" : undefined} onClick={() => selectFolder(folder.id)}><span className="truncate">{folder.name}</span><UnreadCountBadge className="ml-auto" count={folderUnreadCount}/></button>
              </div>
              <SidebarFeedList
                expanded={expanded}
                feeds={folder.feedIds.map((id) => feedsById.get(id)).filter((feed): feed is Feed => Boolean(feed))}
                folderName={folder.name}
                selectedFeedId={settingsActive ? null : selectedFeedId}
                feedUnreadCounts={feedUnreadCounts}
                onSelectFeed={selectFeed}
              />
            </div>
          );
        })}
      </nav>
      <div className="mt-auto">
        {!apiConfigured ? (
          <button className="sidebar-api-warning" onClick={openSettings} aria-label="FreshRSS API 未配置，前往设置">
            <span className="sidebar-api-warning-icon"><TriangleAlert size={16}/></span>
            <span className="min-w-0"><strong>FreshRSS API 未配置</strong><small>当前正在使用预览数据</small></span>
          </button>
        ) : null}
        <div className="border-t pt-3">
          <VersionControls onSettings={openSettings} active={settingsActive}/>
        </div>
      </div>
    </aside>
  );
}
