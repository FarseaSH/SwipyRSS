import { ChevronDown, ChevronRight, CircleDot, Inbox, Rss, Settings, Star, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FeedIcon } from "@/components/FeedIcon";
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

  useEffect(() => {
    if (selectedFolderId && folders.some((folder) => folder.id === selectedFolderId)) {
      setExpandedFolderIds((current) => current.has(selectedFolderId) ? current : new Set([selectedFolderId]));
      return;
    }
    if (folders[0]) {
      setExpandedFolderIds((current) => current.size ? current : new Set([folders[0].id]));
    }
  }, [folders, selectedFolderId]);

  const openSettings = () => { onOpenSettings(); onClose(); };
  const select = (next: ArticleMode) => { onSelectMode(next); onClose(); };
  const selectStarred = () => { onSelectStarred(); onClose(); };
  const selectFolder = (folderId: string) => { setExpandedFolderIds(new Set([folderId])); onSelectFolder(folderId); onClose(); };
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
      <nav className="sidebar-scroll-area min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="订阅源">
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
            <div key={folder.id} className="sidebar-folder-group block w-full">
              <div className={`sidebar-folder-row flex w-full min-w-0 items-center ${folderPageActive ? "active" : ""}`}>
                <button className="sidebar-folder-toggle icon-button" onClick={() => toggleFolder(folder.id)} aria-label={`${expanded ? "收起" : "展开"}${folder.name}`} aria-expanded={expanded}>{expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>
                <button className="sidebar-folder-link sidebar-item min-w-0 flex-1" onClick={() => selectFolder(folder.id)}><span className="truncate">{folder.name}</span><UnreadCountBadge className="ml-auto" count={folderUnreadCount}/></button>
              </div>
              {expanded ? (
                <div className="sidebar-feed-list block w-auto">
                  {folder.feedIds.map((feedId) => {
                    const feed = feedsById.get(feedId);
                    if (!feed) return null;
                    const feedUnreadCount = feedUnreadCounts[feedId] ?? feed.unreadCount ?? 0;
                    return <button key={feedId} className={`sidebar-feed-item sidebar-item w-full ${!settingsActive && selectedFeedId === feedId ? "active" : ""}`} onClick={() => selectFeed(feedId)}><FeedIcon iconUrl={feed.iconUrl}/><span className="truncate">{feed.title}</span><UnreadCountBadge className="ml-auto" count={feedUnreadCount}/></button>;
                  })}
                </div>
              ) : null}
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
          <button className={`sidebar-item ${settingsActive ? "active" : ""}`} onClick={openSettings}><Settings size={17}/>设置</button>
        </div>
      </div>
    </aside>
  );
}
