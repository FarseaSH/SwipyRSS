import { useCallback, useLayoutEffect, useRef, useState } from "react";

export type ArticleShortcutMode = "none" | "go" | "star";

/** Keep a timed action bound to the exact screen whose numbers the user saw. */
export function useArticleShortcutMode(enabled: boolean, screenKey: string) {
  const [mode, setMode] = useState<ArticleShortcutMode>("none");
  const modeRef = useRef<ArticleShortcutMode>("none");
  const timerRef = useRef<number | undefined>(undefined);
  const reset = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    modeRef.current = "none";
    setMode("none");
  }, []);
  const activate = useCallback((nextMode: "go" | "star") => {
    if (!enabled) return;
    window.clearTimeout(timerRef.current);
    modeRef.current = nextMode;
    setMode(nextMode);
    timerRef.current = window.setTimeout(reset, 5000);
  }, [enabled, reset]);

  useLayoutEffect(() => {
    reset();
    if (!enabled) return;
    // Pointer actions and focus changes hand control back to the ordinary UI.
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", reset);
    document.addEventListener("focusin", reset);
    document.addEventListener("pointerdown", reset, true);
    return () => {
      reset();
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      document.removeEventListener("focusin", reset);
      document.removeEventListener("pointerdown", reset, true);
    };
  }, [enabled, screenKey, reset]);

  return { mode: enabled ? mode : "none", modeRef, activate, reset };
}
