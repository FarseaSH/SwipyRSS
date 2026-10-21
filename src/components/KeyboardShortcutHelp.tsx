import { Keyboard, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppView, ArticleMode, SwipeMarkReadMode } from "@/types";

import { shouldMarkAboveRead } from "@/features/article-list/markReadAction";

type Props = {
  view: AppView;
  mode: ArticleMode;
  swipeMarkReadMode: SwipeMarkReadMode;
  disabled: boolean;
  manualOpen: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
};
type HelpScope = AppView | "confirm";
const HOLD_DELAY_MS = 600;

/**
 * Holding a modifier only previews help; shortcuts, blur, and page changes clear the temporary
 * overlay.
 * 修饰键长按只用于查看；组合键、失焦和页面切换都清除临时浮层。
 */
export function KeyboardShortcutHelp({ view, mode, swipeMarkReadMode, disabled, manualOpen, onClose, onOpenSettings }: Props) {
  const [peekScope, setPeekScope] = useState<HelpScope | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const apple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  const modifier = apple ? "⌘" : "Ctrl";

  useEffect(() => {
    if (!manualOpen) return;
    const previousFocus = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [manualOpen]);

  useEffect(() => {
    let timer: number | undefined;
    let held = false;
    const triggerKey = apple ? "Meta" : "Control";
    const dismiss = () => {
      window.clearTimeout(timer);
      timer = undefined;
      setPeekScope(null);
    };
    const reset = () => { held = false; dismiss(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (manualOpen) {
        // Manual help is modal so keyboard events cannot reach the list or settings form behind it.
        // 手动帮助是模态窗口，防止按键落到背后的列表或设置表单。
        event.stopImmediatePropagation();
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        else if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
        else if (event.target !== closeRef.current) event.preventDefault();
        return;
      }
      if (disabled || document.querySelector(".article-context-menu, .feed-read-confirm")) return;
      if (event.key !== triggerKey) dismiss();
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.key === "," && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (!document.getElementById("mark-read-confirm-popover") && view !== "settings") onOpenSettings();
        return;
      }
      if (event.key !== triggerKey || held) return;
      held = true;
      if (event.altKey || event.shiftKey || (apple ? event.ctrlKey : event.metaKey)) return;
      timer = window.setTimeout(() => {
        setPeekScope(document.getElementById("mark-read-confirm-popover") ? "confirm" : view);
      }, HOLD_DELAY_MS);
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === triggerKey) reset(); };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    return () => {
      reset();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [apple, disabled, manualOpen, mode, onClose, onOpenSettings, view]);

  const scope = manualOpen ? "settings" : peekScope;
  if (!scope) return null;
  const sections: Array<{ title: string; rows: Array<[string, string]> }> = [];
  if (scope === "list" || scope === "settings") sections.push({ title: "文章列表", rows: [
    ["J / K · ↑ / ↓", "下一屏 / 上一屏"], ["PageDown / PageUp", "下一屏 / 上一屏"],
    ["[ / ]", "上一个 / 下一个 Feed 或文件夹组"], ["1–9 / Alt + 1–9", "打开当前屏对应文章"],
    ["按住 Option / Alt", "显示当前屏文章编号"],
    ["L / →", "重新打开最近阅读的文章（可用时）"], ["/", "切换所有文章 / 未读文章"],
    ["M", scope === "settings" ? "上方已读 / 全部已读（跟随工具栏，需确认）" : shouldMarkAboveRead(mode, swipeMarkReadMode) ? "确认当前屏及上方已读" : "确认当前范围全部已读（包括尚未加载的文章）"],
    ["R", "刷新当前列表"],
  ] });
  if (scope === "reader" || scope === "settings") sections.push({ title: "文章正文", rows: [
    ["J / K · ↑ / ↓", "向下 / 向上翻屏"], ["PageDown / PageUp", "向下 / 向上翻屏"],
    ["[ / ]", "上一篇 / 下一篇文章"], ["Enter", "打开原文"], ["S", "收藏 / 取消收藏"],
    ["H / ← / Esc", "返回文章列表"],
  ] });
  if (scope === "confirm" || scope === "settings") sections.push({ title: "已读确认", rows: [["Enter", "确认执行"], ["Esc", "取消（处理中不可取消）"]] });
  if (scope !== "confirm") sections.push({ title: "通用", rows: [[`${modifier} + ,`, "打开设置（列表 / 正文）"], [`长按 ${modifier}`, "查看当前页面快捷键，松开关闭"]] });

  return (
    <div className={`shortcut-help-layer ${manualOpen ? "manual" : "peek"}`} onClick={manualOpen ? onClose : undefined}>
      <section className="shortcut-help-card" role={manualOpen ? "dialog" : "region"} aria-modal={manualOpen || undefined} aria-labelledby="shortcut-help-title" onClick={(event) => event.stopPropagation()}>
        <header className="shortcut-help-header">
          <div><Keyboard size={20}/><h2 id="shortcut-help-title">快捷键帮助</h2></div>
          {manualOpen ? <button ref={closeRef} type="button" className="icon-button" aria-label="关闭快捷键帮助" onClick={onClose}><X size={20}/></button> : <span>松开 {modifier} 关闭</span>}
        </header>
        <div className="shortcut-help-sections">
          {sections.map((section) => <section key={section.title}><h3>{section.title}</h3><dl>{section.rows.map(([key, description]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{description}</dd></div>)}</dl></section>)}
        </div>
      </section>
    </div>
  );
}
