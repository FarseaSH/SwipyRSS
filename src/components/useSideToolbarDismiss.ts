import { useEffect, type RefObject } from "react";
import { isBlockedHorizontalWheel } from "./blockedHorizontalWheel";

/**
 * Collapse the expanded side toolbar on outside clicks or scrolling; article navigation and header
 * mode switches preserve list state.
 * 侧边展开后可点击外部或开始滚动收起；文章导航与 Header 模式切换保留列表原状态。
 */
export function useSideToolbarDismiss(
  toolbarRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  collapse: () => void,
  preserveArticleNavigation = false,
) {
  useEffect(() => {
    if (!enabled) return;
    const dismiss = (event: Event) => {
      // Navigation already consumed the remaining horizontal back-gesture momentum; it must not
      // collapse the toolbar again.
      // 返回手势的剩余横向惯性已由导航层消费，不能再次触发工具栏收起。
      if (isBlockedHorizontalWheel(event)) return;
      const target = event.target;
      if (!(target instanceof Element) || toolbarRef.current?.contains(target)) return;
      if (event.type === "pointerdown" && preserveArticleNavigation
        && target.closest("[data-article-id], [data-preserve-list-toolbar]")) return;
      collapse();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("wheel", dismiss, { passive: true });
    document.addEventListener("touchmove", dismiss, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("wheel", dismiss);
      document.removeEventListener("touchmove", dismiss);
    };
  }, [collapse, enabled, preserveArticleNavigation, toolbarRef]);
}
