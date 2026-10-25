import { TimeZoneSelect } from "./TimeZoneSelect";
import { CheckCircle2, Eye, Keyboard, Menu, Settings } from "lucide-react";
import { FreshRssConnectionForm } from "@/features/connection/components/FreshRssConnectionForm";
import { useMemo } from "react";
import type { ConnectionDefaults } from "@/platform/Platform";
import { SettingsSelect } from "./SettingsSelect";
import { SwipeMarkReadSelect } from "./SwipeMarkReadSelect";
import { VersionSettings } from "@/features/versions/components/VersionControls";
import type { FreshRssConnectionInput, SavedFreshRssConnection, StartupPageMode, SwipeMarkReadMode, ToolbarPosition } from "@/types";

type Props = {
  connectionDefaults: ConnectionDefaults;
  connection: SavedFreshRssConnection | null;
  configured: boolean;
  startupPageMode: StartupPageMode;
  onStartupPageModeChange: (mode: StartupPageMode) => void;
  toolbarPosition: ToolbarPosition;
  onToolbarPositionChange: (position: ToolbarPosition) => void;
  swipeMarkReadMode: SwipeMarkReadMode;
  onSwipeMarkReadModeChange: (mode: SwipeMarkReadMode) => void;
  onCancel: () => void;
  onOpenSidebar: () => void;
  onOpenShortcutHelp: () => void;
  onSave: (connection: FreshRssConnectionInput) => Promise<void>;
};

/**
 * Display application settings and ensure saved API passwords are never returned to React.
 * 展示应用设置，并保证已保存的 API 密码不会重新回传给 React。
 */
export function SettingsPage({ connectionDefaults, connection, configured, startupPageMode, onStartupPageModeChange, toolbarPosition, onToolbarPositionChange, swipeMarkReadMode, onSwipeMarkReadModeChange, onCancel, onOpenSidebar, onOpenShortcutHelp, onSave }: Props) {
  const initialValue = useMemo<FreshRssConnectionInput>(() => ({
    apiUrl: connection?.apiUrl ?? connectionDefaults.apiUrl,
    username: connection?.username ?? connectionDefaults.username,
    password: "",
  }), [connection, connectionDefaults]);

  return (
    <section className="flex h-dvh min-w-0 flex-col bg-canvas">
      <header className="app-header sticky top-0 z-30 grid h-16 flex-none grid-cols-[1fr_auto_1fr] items-center border-b px-4 backdrop-blur-xl sm:px-6">
        <div className="justify-self-start"><button className="icon-button lg:hidden" onClick={onOpenSidebar} aria-label="打开侧边栏"><Menu size={20}/></button></div>
        <h1 className="m-0 text-[16px] font-bold tracking-[-.02em]">设置</h1>
        <div/>
      </header>

      <div className="settings-scroll-area">
        <div className="settings-container">
          <div className="settings-title-block">
            <span className="settings-title-icon"><Settings size={22}/></span>
            <div><h2>应用设置</h2><p>管理阅读方式与 FreshRSS 连接。</p></div>
          </div>

          <section className="settings-card" aria-labelledby="fresh-rss-settings-title">
            <div className="settings-card-header">
              <div><h3 id="fresh-rss-settings-title">FreshRSS 连接</h3><p>更新 Google Reader compatible API 的连接信息。</p></div>
              <span className={`settings-status ${configured ? "" : "preview"}`}>
                {configured ? <CheckCircle2 size={15}/> : <Eye size={15}/>}{configured ? "已配置" : "预览模式"}
              </span>
            </div>
            <FreshRssConnectionForm initialValue={initialValue} passwordRequired={!configured} submitLabel="保存连接信息" onSubmit={onSave} onCancel={onCancel}/>
          </section>

          <section className="settings-card" aria-labelledby="swipe-mark-read-title">
            <div className="settings-card-header">
              <div><h3 id="swipe-mark-read-title">阅读设置</h3><p>调整启动页面、上滑标记已读的方式与工具栏位置。</p></div>
            </div>
            <div className="settings-field">
              <label id="startup-page-label" htmlFor="startup-page-mode">启动页面</label>
              <SettingsSelect id="startup-page-mode" labelId="startup-page-label" value={startupPageMode} onChange={onStartupPageModeChange}
                options={[{ value: "unread", label: "未读文章" }, { value: "all", label: "所有文章" },
                  { value: "first-folder", label: "第一个 Feed 组列表" }, { value: "first-feed", label: "第一个 Feed 列表" },
                  { value: "last-list", label: "上一次退出的列表" }]}/>
              <p>重新启动应用时进入指定的文章列表。</p>
            </div>
            <TimeZoneSelect/>
            <div className="settings-field">
              <label id="swipe-mark-read-label" htmlFor="swipe-mark-read-mode">上滑标记已读</label>
              <SwipeMarkReadSelect value={swipeMarkReadMode} onChange={onSwipeMarkReadModeChange}/>
            </div>
            <div className="settings-field">
              <label id="toolbar-position-label" htmlFor="toolbar-position">工具栏位置</label>
              <SettingsSelect id="toolbar-position" labelId="toolbar-position-label" value={toolbarPosition} onChange={onToolbarPositionChange}
                options={[{ value: "bottom", label: "下方" }, { value: "left", label: "左侧" }, { value: "right", label: "右侧" }]}/>
            </div>
          </section>

          <VersionSettings />
          <section className="settings-card" aria-labelledby="shortcut-settings-title">
            <div className="settings-card-header">
              <div><h3 id="shortcut-settings-title">快捷键</h3><p>查看列表与正文的键盘操作，也可长按 Ctrl 或 ⌘ 查看当前页面的快捷键。</p></div>
              <button type="button" className="shortcut-help-entry" onClick={onOpenShortcutHelp}><Keyboard size={18}/>快捷键帮助</button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
