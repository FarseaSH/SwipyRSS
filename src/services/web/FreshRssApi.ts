import { isLosslessNumber, parse as parseLosslessJson } from "lossless-json";
import { rssError } from "@/services/rss/errors";
import type { EntryStateMutation, MarkStreamReadRequest, StreamRequest } from "@/services/rss/types";
import type {
  AccountBootstrap,
  Article,
  Feed,
  FeedFolder,
  StreamPage,
  UnreadCountSnapshot,
} from "@/types";
import type { WebCredential } from "./IndexedDbStore";
import { getFreshRssExtensionRuntimeConfig } from "./runtimeConfig";

const READING_LIST = "user/-/state/com.google/reading-list";
const STARRED = "user/-/state/com.google/starred";
const READ = "user/-/state/com.google/read";
const FOLDER_PREFIX = "user/-/label/";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 30;
const REQUEST_TIMEOUT_MS = 25_000;

export function getDefaultWebApiUrl(): string {
  const runtimeApiBase = getFreshRssExtensionRuntimeConfig()?.apiBase;
  return normalizeWebApiUrl(runtimeApiBase || import.meta.env.VITE_FRESHRSS_API_BASE || "/api/greader.php");
}

export function getDefaultWebUsername(): string {
  return getFreshRssExtensionRuntimeConfig()?.username ?? "";
}

/**
 * Allow only same-origin APIs in the Web version so Authorization cannot be sent to an unreviewed
 * domain.
 * Web 版本只允许同源 API，避免 Authorization 被发送到用户未审查的域名。
 */
export function normalizeWebApiUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim(), window.location.origin);
  } catch {
    throw rssError("InvalidApiUrl", "请输入有效的 FreshRSS API 地址");
  }
  if (url.origin !== window.location.origin) {
    throw rssError("InvalidApiUrl", "PWA 只允许连接当前站点同源的 FreshRSS API");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw rssError("InvalidApiUrl", "API 地址不能包含凭据、查询参数或页面片段");
  }
  if (!url.pathname.replace(/\/+$/, "").endsWith("greader.php")) {
    throw rssError("InvalidApiUrl", "请输入以 greader.php 结尾的 Google Reader compatible API 地址");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href.replace(/\/$/, "");
}

export async function loginToFreshRss(
  apiUrl: string,
  username: string,
  password: string,
): Promise<WebCredential> {
  const normalizedApiUrl = normalizeWebApiUrl(apiUrl);
  const normalizedUsername = username.trim();
  if (!normalizedUsername || !password) {
    throw rssError("AuthenticationFailed", "请填写 FreshRSS 账号和 API 密码");
  }
  const endpoint = endpointUrl(normalizedApiUrl, "accounts/ClientLogin");
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ Email: normalizedUsername, Passwd: password }),
  });
  await assertSuccessful(response);
  const body = await response.text();
  const auth = body.split(/\r?\n/)
    .find((line) => line.startsWith("Auth="))
    ?.slice("Auth=".length);
  if (!auth) throw rssError("IncompatibleResponse", "FreshRSS 登录响应中缺少 Auth 字段");
  return { apiUrl: normalizedApiUrl, username: normalizedUsername, auth };
}

/**
 * Adapt the FreshRSS gReader HTTP protocol and its flexible responses for the Web runtime.
 * 对 FreshRSS gReader HTTP 协议和宽松响应做 Web 端适配。
 */
export class FreshRssApi {
  constructor(private readonly credential: WebCredential) {}

  accountKey(): string {
    return `${this.credential.apiUrl}|${this.credential.username}`;
  }

  async bootstrap(): Promise<AccountBootstrap> {
    const [subscriptions, tags, unread] = await Promise.all([
      this.getJson("reader/api/0/subscription/list", { output: "json" }),
      this.getJson("reader/api/0/tag/list", { output: "json" }),
      this.getJson("reader/api/0/unread-count", { output: "json" }),
    ]);
    return buildBootstrap(subscriptions, tags, unread);
  }

  async unreadCounts(): Promise<UnreadCountSnapshot> {
    return buildUnreadCountSnapshot(
      await this.getJson("reader/api/0/unread-count", { output: "json" }),
    );
  }

  async getStream(request: StreamRequest): Promise<StreamPage> {
    const streamPath = encodeStreamPath(request.streamId);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, request.limit ?? DEFAULT_PAGE_SIZE));
    const query: Record<string, string> = { output: "json", n: String(limit), r: "d" };
    if (request.unreadOnly) query.xt = READ;
    if (request.continuation) query.c = request.continuation;
    const response = asRecord(await this.getJson(`reader/api/0/stream/contents/${streamPath}`, query));
    return {
      items: asArray(response.items).map(parseArticle).filter((article): article is Article => Boolean(article)),
      continuation: stringValue(response.continuation),
      fromCache: false,
      stale: false,
    };
  }

  async editEntryStates(mutation: EntryStateMutation): Promise<void> {
    if (!mutation.articleIds.length) throw rssError("InvalidMutation", "没有需要更新的文章");
    if (mutation.read === undefined && mutation.starred === undefined) {
      throw rssError("InvalidMutation", "没有指定文章最终状态");
    }
    if (mutation.read !== undefined) await this.editTag(mutation.articleIds, READ, mutation.read);
    if (mutation.starred !== undefined) await this.editTag(mutation.articleIds, STARRED, mutation.starred);
  }

  async markStreamRead(request: MarkStreamReadRequest): Promise<void> {
    encodeStreamPath(request.streamId);
    if (!/^\d+$/.test(request.beforeTimestampUsec)) {
      throw rssError("InvalidMutation", "全部已读操作的时间边界无效");
    }
    const token = await this.actionToken();
    const form = new URLSearchParams({
      s: request.streamId,
      ts: request.beforeTimestampUsec,
      T: token,
    });
    await this.postForm("reader/api/0/mark-all-as-read", form);
  }

  private actionTokenValue?: string;

  private async actionToken(): Promise<string> {
    if (this.actionTokenValue) return this.actionTokenValue;
    const token = (await this.getText("reader/api/0/token")).trim();
    if (!token) throw rssError("BadToken", "FreshRSS 没有返回写操作 token");
    this.actionTokenValue = token;
    return token;
  }

  private async editTag(articleIds: string[], tag: string, add: boolean): Promise<void> {
    const form = new URLSearchParams();
    for (const articleId of articleIds) form.append("i", articleId);
    form.append(add ? "a" : "r", tag);
    form.append("T", await this.actionToken());
    await this.postForm("reader/api/0/edit-tag", form);
  }

  private async getJson(suffix: string, query: Record<string, string>): Promise<unknown> {
    const endpoint = endpointUrl(this.credential.apiUrl, suffix);
    for (const [key, value] of Object.entries(query)) endpoint.searchParams.set(key, value);
    const response = await this.authenticatedFetch(endpoint, { method: "GET" });
    const text = await response.text();
    try {
      return parseLosslessJson(text);
    } catch {
      throw rssError("DecodeFailed", "FreshRSS 返回了无法解析的数据");
    }
  }

  private async getText(suffix: string): Promise<string> {
    const response = await this.authenticatedFetch(endpointUrl(this.credential.apiUrl, suffix), { method: "GET" });
    return response.text();
  }

  private async postForm(suffix: string, body: URLSearchParams): Promise<void> {
    await this.authenticatedFetch(endpointUrl(this.credential.apiUrl, suffix), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body,
    });
  }

  private async authenticatedFetch(url: URL, init: RequestInit): Promise<Response> {
    const response = await fetchWithTimeout(url, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...init.headers,
        Authorization: `GoogleLogin auth=${this.credential.auth}`,
      },
    });
    await assertSuccessful(response);
    return response;
  }
}

function endpointUrl(apiUrl: string, suffix: string): URL {
  const endpoint = new URL(apiUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint;
}

async function fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw rssError("ConnectTimeout", "连接 FreshRSS 超时，请稍后重试", true);
    }
    throw rssError("NetworkUnavailable", "无法连接 FreshRSS，请检查网络和部署配置", true);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function assertSuccessful(response: Response): Promise<void> {
  if (response.status === 401) throw rssError("AuthenticationFailed", "FreshRSS 登录已失效，请重新输入 API 密码");
  if (response.status === 404) {
    throw rssError("ApiDisabled", "FreshRSS API 不可用，请检查 API 是否启用以及服务器 PATH_INFO 配置");
  }
  if (!response.ok) {
    throw rssError("HttpStatus", `FreshRSS 请求失败（HTTP ${response.status}）`, response.status >= 500);
  }
}

function encodeStreamPath(streamId: string): string {
  if (streamId === READING_LIST || streamId === STARRED) return streamId;
  if (/^feed\/\d+$/.test(streamId)) return streamId;
  if (streamId.startsWith(FOLDER_PREFIX) && streamId.length > FOLDER_PREFIX.length) {
    return `${FOLDER_PREFIX}${encodePathSegment(streamId.slice(FOLDER_PREFIX.length))}`;
  }
  throw rssError("InvalidStream", "请求的 FreshRSS 列表范围不受支持");
}

function encodePathSegment(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => {
    const isAlphaNumeric = (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
    return isAlphaNumeric ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

function buildUnreadCountSnapshot(raw: unknown): UnreadCountSnapshot {
  const unreadCounts = asArray(asRecord(raw).unreadcounts);
  const feedUnreadCounts: Record<string, number> = {};
  let readingListUnreadCount = 0;
  for (const item of unreadCounts) {
    const record = asRecord(item);
    const id = stringValue(record.id);
    const count = numberValue(record.count);
    if (id === READING_LIST) readingListUnreadCount = count;
    else if (id?.startsWith("feed/")) feedUnreadCounts[id] = count;
  }
  return { readingListUnreadCount, feedUnreadCounts };
}

function buildBootstrap(subscriptionsRaw: unknown, tagsRaw: unknown, unreadRaw: unknown): AccountBootstrap {
  const unreadSnapshot = buildUnreadCountSnapshot(unreadRaw);
  const unreadById = new Map<string, number>();
  for (const item of asArray(asRecord(unreadRaw).unreadcounts)) {
    const record = asRecord(item);
    const id = stringValue(record.id);
    if (id) unreadById.set(id, numberValue(record.count));
  }

  const folders: FeedFolder[] = [];
  const folderIndexes = new Map<string, number>();
  for (const item of asArray(asRecord(tagsRaw).tags)) {
    const tag = asRecord(item);
    const id = stringValue(tag.id);
    if (!id || stringValue(tag.type) !== "folder") continue;
    folderIndexes.set(id, folders.length);
    folders.push({ id, name: decodeFolderName(id), feedIds: [], unreadCount: unreadById.get(id) });
  }

  const feeds: Feed[] = [];
  for (const item of asArray(asRecord(subscriptionsRaw).subscriptions)) {
    const subscription = asRecord(item);
    const id = stringValue(subscription.id);
    if (!id) continue;
    const categories = asArray(subscription.categories).map(asRecord);
    const folderIds = categories.map((category) => stringValue(category.id)).filter((value): value is string => Boolean(value));
    for (const category of categories) {
      const folderId = stringValue(category.id);
      if (!folderId) continue;
      let index = folderIndexes.get(folderId);
      if (index === undefined) {
        index = folders.length;
        folderIndexes.set(folderId, index);
        folders.push({
          id: folderId,
          name: stringValue(category.label) ?? decodeFolderName(folderId),
          feedIds: [],
          unreadCount: unreadById.get(folderId),
        });
      }
      folders[index].feedIds.push(id);
    }
    feeds.push({
      id,
      title: stringValue(subscription.title) ?? "未命名来源",
      feedUrl: stringValue(subscription.url),
      siteUrl: stringValue(subscription.htmlUrl),
      iconUrl: stringValue(subscription.iconUrl),
      folderIds,
      unreadCount: unreadById.get(id),
    });
  }
  return { feeds, folders, readingListUnreadCount: unreadSnapshot.readingListUnreadCount };
}

function parseArticle(raw: unknown): Article | null {
  const value = asRecord(raw);
  const id = stringValue(value.id);
  if (!id) return null;
  const origin = asRecord(value.origin);
  const feedId = stringValue(origin.streamId) ?? "";
  const title = stringValue(value.title) ?? "无标题";
  const summary = asRecord(value.summary);
  const content = asRecord(value.content);
  const contentHtml = stringValue(summary.content) ?? stringValue(content.content) ?? "";
  const categories = asArray(value.categories).map(stringValue).filter((item): item is string => Boolean(item));
  const publishedAt = publishedMillis(value);
  return {
    id,
    feedId,
    feedTitle: stringValue(origin.title) ?? "未知来源",
    feedColor: stableFeedColor(feedId),
    publishedAt,
    publishedLabel: formatPublishedTime(publishedAt),
    author: stringValue(value.author),
    title,
    summaryText: truncateText(stripHtml(contentHtml), 220),
    contentHtml,
    articleUrl: firstHref(value.alternate) ?? firstHref(value.canonical),
    enclosure: firstEnclosure(value.enclosure),
    language: /[\u4e00-\u9fff]/u.test(`${title}${Array.from(contentHtml).slice(0, 300).join("")}`) ? "zh-CN" : "en",
    tags: categories.filter((category) => category.startsWith(FOLDER_PREFIX)).map((category) => decodeLabel(category.slice(FOLDER_PREFIX.length))),
    isRead: categories.includes(READ),
    isStarred: categories.includes(STARRED),
  };
}

function firstHref(raw: unknown): string | undefined {
  for (const item of asArray(raw)) {
    const href = stringValue(asRecord(item).href);
    if (href) return href;
  }
  return undefined;
}

function firstEnclosure(raw: unknown): Article["enclosure"] {
  const item = asRecord(asArray(raw)[0]);
  const url = stringValue(item.href) ?? stringValue(item.url);
  if (!url) return undefined;
  return { url, mimeType: stringValue(item.type) };
}

function publishedMillis(value: Record<string, unknown>): number {
  const published = numberValue(value.published, Number.NaN);
  if (Number.isFinite(published)) return published * 1_000;
  const timestampUsec = stringValue(value.timestampUsec);
  return timestampUsec ? Math.trunc(Number(timestampUsec) / 1_000) : 0;
}

/**
 * Refresh relative date labels against today's date even when returning cached articles.
 * 缓存返回时也要按当前日期刷新相对时间文案。
 */
export function refreshPublishedLabels(page: StreamPage): StreamPage {
  return { ...page, items: page.items.map((article) => ({ ...article, publishedLabel: formatPublishedTime(article.publishedAt) })) };
}

function formatPublishedTime(milliseconds: number): string {
  const timestamp = new Date(milliseconds);
  if (!Number.isFinite(timestamp.getTime())) return "时间未知";
  const now = new Date();
  const time = `${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}`;
  const today = localDayNumber(now);
  const publishedDay = localDayNumber(timestamp);
  const daysAgo = today - publishedDay;
  const isPastOrPresent = timestamp.getTime() <= now.getTime();
  if (isPastOrPresent && daysAgo === 0) return `今天 ${time}`;
  if (isPastOrPresent && daysAgo === 1) return `昨天 ${time}`;
  const mondayOffset = (now.getDay() + 6) % 7;
  const dateLabel = `${pad(timestamp.getMonth() + 1)}-${pad(timestamp.getDate())} ${time}`;
  if (isPastOrPresent && daysAgo >= 2 && daysAgo <= 6 && daysAgo <= mondayOffset) {
    return `周${chineseWeekday(timestamp)} ${dateLabel}`;
  }
  if (isPastOrPresent && daysAgo >= 2 && daysAgo <= 6) return `上周${chineseWeekday(timestamp)} ${dateLabel}`;
  if (timestamp.getFullYear() === now.getFullYear()) return dateLabel;
  return `${timestamp.getFullYear()}-${dateLabel}`;
}

function localDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function chineseWeekday(date: Date): string {
  return ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function stableFeedColor(feedId: string): string {
  const colors = ["#3B78B8", "#557FA9", "#6F8FB4", "#4F7FAF", "#365F8D", "#7187A4", "#39739F", "#52789F"];
  let hash = 2_166_136_261;
  for (const byte of new TextEncoder().encode(feedId)) hash = Math.imul(hash ^ byte, 16_777_619) >>> 0;
  return colors[hash % colors.length];
}

function stripHtml(html: string): string {
  let text = "";
  let insideTag = false;
  for (const character of html) {
    if (character === "<") insideTag = true;
    else if (character === ">") { insideTag = false; text += " "; }
    else if (!insideTag) text += character;
  }
  return text.replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").split(/\s+/u).filter(Boolean).join(" ");
}

function truncateText(value: string, maximum: number): string {
  const characters = Array.from(value);
  return characters.length > maximum ? `${characters.slice(0, maximum).join("")}…` : value;
}

function decodeFolderName(folderId: string): string {
  return decodeLabel(folderId.startsWith(FOLDER_PREFIX) ? folderId.slice(FOLDER_PREFIX.length) : folderId);
}

function decodeLabel(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (isLosslessNumber(value)) return value.value;
  return undefined;
}

function numberValue(value: unknown, fallback = 0): number {
  const serialized = stringValue(value);
  if (serialized === undefined) return fallback;
  const number = Number(serialized);
  return Number.isFinite(number) ? number : fallback;
}
