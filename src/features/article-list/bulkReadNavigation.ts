export type BulkReadAutoAdvance = "off" | "all" | "above" | "both";
export type BulkReadSource = "all" | "context-above" | "feed-all" | "toolbar-above";

const STORAGE_KEY = "swipyrss.bulk-read-auto-advance.v1";

export function loadBulkReadAutoAdvance(): BulkReadAutoAdvance {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "all" || value === "above" || value === "both") return value;
  } catch { /* Keep the default when local storage is unavailable. */ }
  return "off";
}

export function saveBulkReadAutoAdvance(value: BulkReadAutoAdvance) {
  try { window.localStorage.setItem(STORAGE_KEY, value); }
  catch { /* The setting still applies to this session. */ }
}

export function shouldAdvanceAfterRead(setting: BulkReadAutoAdvance, source: BulkReadSource): boolean {
  // Feed-specific context-menu actions always stay in the current list, even with "both" enabled.
  // 右键针对单个 Feed 的全部已读始终不跳转；预留的工具栏上方已读也不受此设置控制。
  if (source === "feed-all" || source === "toolbar-above") return false;
  return setting === "both" || (source === "all" ? setting === "all" : setting === "above");
}
