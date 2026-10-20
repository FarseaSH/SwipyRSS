import type { RssClient } from "@/services/rss/RssClient";
import { normalizeRssError, rssError } from "@/services/rss/errors";
import type { EntryStateMutation, MarkStreamReadRequest, StreamRequest } from "@/services/rss/types";
import type {
  AccountBootstrap,
  EntryStateResult,
  FreshRssConnectionInput,
  SavedFreshRssConnection,
  StreamPage,
  UnreadCountSnapshot,
} from "@/types";
import { FreshRssApi, loginToFreshRss, normalizeWebApiUrl, refreshPublishedLabels } from "./FreshRssApi";
import { IndexedDbStore, type WebCredential } from "./IndexedDbStore";

const BOOTSTRAP_CACHE_KEY = "bootstrap";

/**
 * Connect the browser directly to FreshRSS; keep authentication and article caches within the
 * current origin.
 * 浏览器直连 FreshRSS 的适配器；认证与文章缓存仅保存在当前 Origin。
 */
export class WebRssClient implements RssClient {
  private readonly store = new IndexedDbStore();
  private credential: WebCredential | null = null;
  private apiInstance: FreshRssApi | null = null;

  async testConnection(input: FreshRssConnectionInput): Promise<void> {
    await loginToFreshRss(input.apiUrl, input.username, input.password);
  }

  async saveConnection(input: FreshRssConnectionInput): Promise<SavedFreshRssConnection> {
    const apiUrl = normalizeWebApiUrl(input.apiUrl);
    const username = input.username.trim();
    let credential: WebCredential;
    if (input.password) {
      credential = await loginToFreshRss(apiUrl, username, input.password);
    } else {
      const existing = this.credential ?? await this.store.loadCredential();
      if (!existing || existing.apiUrl !== apiUrl || existing.username !== username) {
        throw rssError("AuthenticationFailed", "修改 API 地址或账号时必须重新输入 API 密码");
      }
      credential = existing;
    }

    await this.store.saveCredential(credential);
    this.credential = credential;
    this.apiInstance = new FreshRssApi(credential);
    return savedConnection(credential);
  }

  async loadSavedConnection(): Promise<SavedFreshRssConnection | null> {
    this.credential = await this.store.loadCredential();
    this.apiInstance = this.credential ? new FreshRssApi(this.credential) : null;
    return this.credential ? savedConnection(this.credential) : null;
  }

  async bootstrapAccount(): Promise<AccountBootstrap> {
    const api = await this.api();
    try {
      const bootstrap = await api.bootstrap();
      await this.bestEffortCache(() => this.store.putCache(api.accountKey(), BOOTSTRAP_CACHE_KEY, bootstrap));
      return bootstrap;
    } catch (error) {
      await this.invalidateOnAuthenticationFailure(error);
      const normalized = normalizeRssError(error);
      if (!normalized.retryable) throw error;
      const cached = await this.cacheOrNull(() => this.store.getCache<AccountBootstrap>(api.accountKey(), BOOTSTRAP_CACHE_KEY));
      if (cached) return cached.value;
      throw error;
    }
  }

  async getStream(request: StreamRequest): Promise<StreamPage> {
    const api = await this.api();
    const cacheKey = streamCacheKey(request);
    try {
      const page = await api.getStream(request);
      await this.bestEffortCache(() => this.store.putCache(api.accountKey(), cacheKey, page));
      return page;
    } catch (error) {
      await this.invalidateOnAuthenticationFailure(error);
      const normalized = normalizeRssError(error);
      if (!normalized.retryable) throw error;
      const cached = await this.cacheOrNull(() => this.store.getCache<StreamPage>(api.accountKey(), cacheKey));
      if (!cached) throw error;
      return refreshPublishedLabels({ ...cached.value, fromCache: true, stale: cached.stale });
    }
  }

  async editEntryStates(mutation: EntryStateMutation): Promise<EntryStateResult> {
    const api = await this.api();
    try {
      await api.editEntryStates(mutation);
      return { reauthenticated: false };
    } catch (error) {
      await this.invalidateOnAuthenticationFailure(error);
      throw error;
    }
  }

  async markStreamRead(request: MarkStreamReadRequest): Promise<void> {
    const api = await this.api();
    try {
      await api.markStreamRead(request);
    } catch (error) {
      await this.invalidateOnAuthenticationFailure(error);
      throw error;
    }
  }

  async refreshUnreadCounts(): Promise<UnreadCountSnapshot> {
    const api = await this.api();
    try {
      return await api.unreadCounts();
    } catch (error) {
      await this.invalidateOnAuthenticationFailure(error);
      throw error;
    }
  }

  async clearAccount(): Promise<void> {
    const credential = this.credential ?? await this.store.loadCredential();
    this.credential = null;
    this.apiInstance = null;
    try {
      if (credential) await this.store.clearAccount(`${credential.apiUrl}|${credential.username}`);
    } finally {
      await this.store.clearCredential();
    }
  }

  private async api(): Promise<FreshRssApi> {
    this.credential ??= await this.store.loadCredential();
    if (!this.credential) throw rssError("AuthenticationFailed", "尚未保存 FreshRSS 连接");
    this.apiInstance ??= new FreshRssApi(this.credential);
    return this.apiInstance;
  }

  private async invalidateOnAuthenticationFailure(error: unknown): Promise<void> {
    if (normalizeRssError(error).kind !== "AuthenticationFailed") return;
    this.credential = null;
    this.apiInstance = null;
    await this.store.clearCredential().catch(() => undefined);
  }

  private async bestEffortCache(operation: () => Promise<unknown>): Promise<void> {
    await operation().catch(() => undefined);
  }

  private async cacheOrNull<T>(operation: () => Promise<T>): Promise<T | null> {
    return operation().catch(() => null);
  }
}

function savedConnection(credential: WebCredential): SavedFreshRssConnection {
  return { apiUrl: credential.apiUrl, username: credential.username };
}

function streamCacheKey(request: StreamRequest): string {
  return `stream|${request.streamId}|${request.unreadOnly}|${request.continuation ?? "first"}|${request.limit ?? 20}`;
}
