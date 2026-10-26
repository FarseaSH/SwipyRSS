import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type ArticleMenuAnchor = { articleId: string; x: number; y: number; input: "mouse" | "touch" };

export function useArticleContextMenu(enabled: boolean, resetKey: string) {
  const [menu, setMenu] = useState<ArticleMenuAnchor | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = useRef(menu);
  current.current = menu;
  const close = useCallback(() => {
    current.current = null;
    setMenu(null);
  }, []);
  const open = useCallback((articleId: string, x: number, y: number, input: ArticleMenuAnchor["input"] = "mouse") => {
    const next = { articleId, x, y, input };
    current.current = next;
    setMenu(next);
  }, []);

  useLayoutEffect(close, [enabled, resetKey, close]);
  useEffect(() => {
    let consumeClick = false;
    const consume = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const down = (event: PointerEvent) => {
      consumeClick = false;
      if (!current.current || menuRef.current?.contains(event.target as Node)) return;
      // A second right click must reach its article so it can replace the target immediately.
      if (event.button === 2) return;
      close();
      consumeClick = true;
      consume(event);
    };
    const click = (event: MouseEvent) => {
      if (!consumeClick) return;
      consumeClick = false;
      consume(event);
    };
    const key = (event: KeyboardEvent) => {
      if (!current.current) return;
      if (event.key === "Escape") {
        consume(event);
        const articleId = current.current.articleId;
        close();
        Array.from(document.querySelectorAll<HTMLElement>(".article-card[data-article-id]"))
          .find((card) => card.dataset.articleId === articleId)?.focus({ preventScroll: true });
      }
    };
    const visibility = () => { if (document.hidden) close(); };
    const context = (event: MouseEvent) => {
      if (!current.current || menuRef.current?.contains(event.target as Node)) return;
      if (!(event.target instanceof Element) || !event.target.closest(".article-card:not([inert])")) close();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("contextmenu", context, true);
    window.addEventListener("blur", close);
    window.addEventListener("pagehide", close);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("contextmenu", context, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("pagehide", close);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [close]);
  return { menu: enabled ? menu : null, menuRef, open, close };
}
