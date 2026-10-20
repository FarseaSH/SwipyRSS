import { rssError } from "@/services/rss/errors";

const DATABASE_NAME = "swipyrss";
const DATABASE_VERSION = 1;
const CREDENTIAL_STORE = "credentials";
const CACHE_STORE = "cacheEntries";
const ACTIVE_CREDENTIAL_ID = "active";
const MAX_CACHE_BYTES = 100 * 1024 * 1024;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;

export type WebCredential = {
  apiUrl: string;
  username: string;
  auth: string;
};

type CredentialRecord = WebCredential & { id: string };

type CacheEntryRecord = {
  id: string;
  accountKey: string;
  cacheKey: string;
  payload: unknown;
  sizeBytes: number;
  storedAt: number;
  lastAccessed: number;
};

export type CachedValue<T> = {
  value: T;
  stale: boolean;
};

/**
 * The Web runtime's sole persistence layer; API passwords are never stored here.
 * Web 运行时唯一的持久化层；API 密码从不写入这里。
 */
export class IndexedDbStore {
  private databasePromise?: Promise<IDBDatabase>;

  async loadCredential(): Promise<WebCredential | null> {
    const database = await this.database();
    const transaction = database.transaction(CREDENTIAL_STORE, "readonly");
    const record = await request<CredentialRecord | undefined>(
      transaction.objectStore(CREDENTIAL_STORE).get(ACTIVE_CREDENTIAL_ID),
    );
    await transactionDone(transaction);
    if (!record) return null;
    return { apiUrl: record.apiUrl, username: record.username, auth: record.auth };
  }

  async saveCredential(credential: WebCredential): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(CREDENTIAL_STORE, "readwrite");
    transaction.objectStore(CREDENTIAL_STORE).put({ id: ACTIVE_CREDENTIAL_ID, ...credential });
    await transactionDone(transaction);
  }

  async clearCredential(): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(CREDENTIAL_STORE, "readwrite");
    transaction.objectStore(CREDENTIAL_STORE).delete(ACTIVE_CREDENTIAL_ID);
    await transactionDone(transaction);
  }

  async getCache<T>(accountKey: string, cacheKey: string): Promise<CachedValue<T> | null> {
    const database = await this.database();
    const id = createCacheId(accountKey, cacheKey);
    const readTransaction = database.transaction(CACHE_STORE, "readonly");
    const record = await request<CacheEntryRecord | undefined>(
      readTransaction.objectStore(CACHE_STORE).get(id),
    );
    await transactionDone(readTransaction);
    if (!record) return null;

    const writeTransaction = database.transaction(CACHE_STORE, "readwrite");
    writeTransaction.objectStore(CACHE_STORE).put({ ...record, lastAccessed: Date.now() });
    await transactionDone(writeTransaction);
    return {
      value: record.payload as T,
      stale: Date.now() - record.storedAt > STALE_AFTER_MS,
    };
  }

  async putCache(accountKey: string, cacheKey: string, payload: unknown): Promise<void> {
    const serialized = JSON.stringify(payload);
    const now = Date.now();
    const record: CacheEntryRecord = {
      id: createCacheId(accountKey, cacheKey),
      accountKey,
      cacheKey,
      payload,
      sizeBytes: new Blob([serialized]).size,
      storedAt: now,
      lastAccessed: now,
    };
    const database = await this.database();
    const transaction = database.transaction(CACHE_STORE, "readwrite");
    transaction.objectStore(CACHE_STORE).put(record);
    await transactionDone(transaction);
    await this.evictToLimit(database);
  }

  async clearAccount(accountKey: string): Promise<void> {
    const database = await this.database();
    const readTransaction = database.transaction(CACHE_STORE, "readonly");
    const index = readTransaction.objectStore(CACHE_STORE).index("accountKey");
    const keys = await request<IDBValidKey[]>(index.getAllKeys(IDBKeyRange.only(accountKey)));
    await transactionDone(readTransaction);
    if (!keys.length) return;

    const writeTransaction = database.transaction(CACHE_STORE, "readwrite");
    const store = writeTransaction.objectStore(CACHE_STORE);
    for (const key of keys) store.delete(key);
    await transactionDone(writeTransaction);
  }

  private async database(): Promise<IDBDatabase> {
    if (!this.databasePromise) this.databasePromise = openDatabase();
    return this.databasePromise;
  }

  private async evictToLimit(database: IDBDatabase): Promise<void> {
    const readTransaction = database.transaction(CACHE_STORE, "readonly");
    const records = await request<CacheEntryRecord[]>(readTransaction.objectStore(CACHE_STORE).getAll());
    await transactionDone(readTransaction);
    let total = records.reduce((sum, record) => sum + record.sizeBytes, 0);
    if (total <= MAX_CACHE_BYTES) return;

    records.sort((left, right) => left.lastAccessed - right.lastAccessed);
    const removeIds: string[] = [];
    for (const record of records) {
      if (total <= MAX_CACHE_BYTES) break;
      total -= record.sizeBytes;
      removeIds.push(record.id);
    }
    const writeTransaction = database.transaction(CACHE_STORE, "readwrite");
    const store = writeTransaction.objectStore(CACHE_STORE);
    for (const id of removeIds) store.delete(id);
    await transactionDone(writeTransaction);
  }
}

function createCacheId(accountKey: string, cacheKey: string): string {
  return `${accountKey}\u0000${cacheKey}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(rssError("CacheFailed", "当前浏览器不支持 IndexedDB", false));
  }

  return new Promise((resolve, reject) => {
    const openRequest = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains(CREDENTIAL_STORE)) {
        database.createObjectStore(CREDENTIAL_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(CACHE_STORE)) {
        const store = database.createObjectStore(CACHE_STORE, { keyPath: "id" });
        store.createIndex("accountKey", "accountKey", { unique: false });
        store.createIndex("lastAccessed", "lastAccessed", { unique: false });
      }
    };
    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(rssError("CacheFailed", "无法打开浏览器本地存储", true));
    openRequest.onblocked = () => reject(rssError("CacheFailed", "浏览器本地存储正在被其他页面占用", true));
  });
}

function request<T>(idbRequest: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(rssError("CacheFailed", "浏览器本地存储操作失败", true));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(rssError("CacheFailed", "浏览器本地存储事务失败", true));
    transaction.onabort = () => reject(rssError("CacheFailed", "浏览器本地存储事务已取消", true));
  });
}
