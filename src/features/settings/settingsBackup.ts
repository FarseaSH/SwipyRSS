import type { ArticleMode, Feed, StartupPageMode, SwipeMarkReadMode, ToolbarPosition } from "@/types";

export type BackupSettings = {
  startupPage?: StartupPageMode;
  toolbarPosition?: ToolbarPosition;
  swipeMarkRead?: SwipeMarkReadMode;
};
export type SettingsBackup = {
  format: "swipyrss-settings";
  version: 1;
  settings: BackupSettings;
  listModes: { readingList?: ArticleMode; starred?: ArticleMode; feeds: Record<string, ArticleMode> };
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象。`);
  return value as Record<string, unknown>;
}
function isMode(value: unknown): value is ArticleMode { return value === "all" || value === "unread"; }

/** Normalize only URL syntax; retain protocol, path case, trailing slash and query parameters.
 * 只规范 URL 语法，保留协议、路径大小写、末尾斜杠及查询参数，避免匹配到不同订阅。 */
export function normalizeFeedUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

/** Export an explicit allowlist, never raw storage keys, account data or reading activity.
 * 只导出白名单，绝不直接导出存储键、账号信息或阅读活动。 */
export function createSettingsBackup(settings: Required<BackupSettings>, modes: Readonly<Record<string, ArticleMode>>, feeds: readonly Feed[]): SettingsBackup {
  const feedModes: Record<string, ArticleMode> = {};
  for (const feed of feeds) {
    const url = normalizeFeedUrl(feed.feedUrl);
    const mode = modes[`feed:${feed.id}`];
    if (url && isMode(mode)) feedModes[url] = mode;
  }
  return {
    format: "swipyrss-settings", version: 1,
    settings: { startupPage: settings.startupPage, toolbarPosition: settings.toolbarPosition, swipeMarkRead: settings.swipeMarkRead },
    listModes: {
      ...(isMode(modes["reading-list:root"]) ? { readingList: modes["reading-list:root"] } : {}),
      ...(isMode(modes["starred:root"]) ? { starred: modes["starred:root"] } : {}),
      feeds: feedModes,
    },
  };
}

/** Fully validate known fields before applying any change; unknown fields never reach storage.
 * 写入前完整校验已知字段；未知字段不会进入本地存储。 */
export function parseSettingsBackup(text: string): SettingsBackup {
  if (text.length > 1_048_576) throw new Error("备份文本过大，请使用不超过 1 MB 的设置备份。");
  let parsed: unknown;
  try { parsed = JSON.parse(text.trim()); }
  catch { throw new Error("JSON 格式有误，请检查括号、引号和逗号。"); }
  const root = record(parsed, "备份");
  if (root.format !== "swipyrss-settings") throw new Error("这不是 SwipyRSS 设置备份。");
  if (root.version !== 1) throw new Error("不支持此备份版本，请使用 version 为 1 的备份。");
  const input = root.settings === undefined ? {} : record(root.settings, "settings");
  const settings: BackupSettings = {};
  if (Object.hasOwn(input, "startupPage")) {
    if (!["unread", "all", "first-folder", "first-feed", "last-list"].includes(input.startupPage as string)) throw new Error("启动页面的值无效。");
    settings.startupPage = input.startupPage as StartupPageMode;
  }
  if (Object.hasOwn(input, "toolbarPosition")) {
    if (!["bottom", "left", "right"].includes(input.toolbarPosition as string)) throw new Error("工具栏位置的值无效。");
    settings.toolbarPosition = input.toolbarPosition as ToolbarPosition;
  }
  if (Object.hasOwn(input, "swipeMarkRead")) {
    if (!["off", "both", "unread", "all"].includes(input.swipeMarkRead as string)) throw new Error("上滑标记已读的值无效。");
    settings.swipeMarkRead = input.swipeMarkRead as SwipeMarkReadMode;
  }
  const inputModes = root.listModes === undefined ? {} : record(root.listModes, "listModes");
  const listModes: SettingsBackup["listModes"] = { feeds: {} };
  for (const key of ["readingList", "starred"] as const) {
    if (!Object.hasOwn(inputModes, key)) continue;
    const mode = inputModes[key];
    if (!isMode(mode)) throw new Error(`${key} 的阅读模式无效，只能是 all 或 unread。`);
    listModes[key] = mode;
  }
  if (inputModes.feeds !== undefined) {
    for (const [rawUrl, mode] of Object.entries(record(inputModes.feeds, "listModes.feeds"))) {
      const url = normalizeFeedUrl(rawUrl);
      if (!url) throw new Error("Feed 订阅地址无效，只支持完整的 HTTP / HTTPS URL。");
      if (!isMode(mode)) throw new Error("Feed 阅读模式无效，只能是 all 或 unread。");
      if (Object.hasOwn(listModes.feeds, url) && listModes.feeds[url] !== mode) throw new Error("同一 Feed URL 存在冲突的阅读模式。");
      listModes.feeds[url] = mode;
    }
  }
  if (!Object.keys(settings).length && !listModes.readingList && !listModes.starred && !Object.keys(listModes.feeds).length) {
    throw new Error("备份中没有可识别的设置项。");
  }
  return { format: "swipyrss-settings", version: 1, settings, listModes };
}

/** Remap URLs onto current IDs; absent feeds and folder modes are never created.
 * 按 URL 映射到当前 Feed ID；不存在的来源和 Feed 组不会创建偏好。 */
export function planSettingsImport(backup: SettingsBackup, feeds: readonly Feed[]) {
  const modes: Record<string, ArticleMode> = {};
  const feedsByUrl = new Map<string, string[]>();
  for (const feed of feeds) {
    const url = normalizeFeedUrl(feed.feedUrl);
    if (url) feedsByUrl.set(url, [...(feedsByUrl.get(url) ?? []), feed.id]);
  }
  let matchedFeeds = 0;
  let skippedFeeds = 0;
  for (const [url, mode] of Object.entries(backup.listModes.feeds)) {
    const ids = feedsByUrl.get(url);
    if (!ids?.length) { skippedFeeds += 1; continue; }
    matchedFeeds += 1;
    for (const id of ids) modes[`feed:${id}`] = mode;
  }
  if (backup.listModes.readingList) modes["reading-list:root"] = backup.listModes.readingList;
  if (backup.listModes.starred) modes["starred:root"] = backup.listModes.starred;
  return {
    modes, matchedFeeds, skippedFeeds,
    settingCount: Object.keys(backup.settings).length,
    generalListCount: Number(Boolean(backup.listModes.readingList)) + Number(Boolean(backup.listModes.starred)),
  };
}

/** Save before updating React. Restore earlier writes if storage rejects a later setting.
 * 先持久化再更新 React，若后续写入失败则恢复先前写入。 */
export function persistSettingsImport(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, writes: ReadonlyArray<readonly [string, string]>): void {
  const previous = writes.map(([key]) => [key, storage.getItem(key)] as const);
  let applied = 0;
  try {
    for (const [key, value] of writes) { storage.setItem(key, value); applied += 1; }
  } catch (error) {
    for (let index = applied - 1; index >= 0; index -= 1) {
      const [key, value] = previous[index];
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    throw error;
  }
}
