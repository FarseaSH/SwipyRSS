import type { Feed } from "@/types";
import { IndexedDbStore, type FeedIconRecord } from "./IndexedDbStore";

const RECHECK_AFTER_MS = 24 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 15_000;
const CONCURRENCY = 3;
const store = new IndexedDbStore();

// FreshRSS p/themes/icons/default_favicon.ico
const DEFAULT_FAVICON_SHA256 = "b4102b529df88d9333930f861788eb03a32a67352542b527a98c3bf3b3ed37fe";

function cacheKey(feed: Feed): string {
  return JSON.stringify([feed.id, feed.feedUrl ?? ""]);
}

async function fetchIcon(rawUrl: string, signal: AbortSignal): Promise<{ blob: Blob; hash: string } | null> {
  const url = new URL(rawUrl, window.location.href);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted || !globalThis.crypto?.subtle) return null;
  signal.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(abort, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    // FreshRSS identifies its default response in this header when it is readable.
    if (/\bfilename="?default_favicon\.ico"?(?:\s*;|\s*$)/i.test(response.headers.get("Content-Disposition") ?? "")) {
      return null;
    }

    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("image/")) return null;
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash === DEFAULT_FAVICON_SHA256 || controller.signal.aborted) return null;

    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    try {
      image.src = objectUrl;
      await image.decode();
      return controller.signal.aborted ? null : { blob, hash };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** One scheduler and one object URL per feed for the active account. */
export class FeedIconCache {
  private readonly sources = new Map<string, { url: string; hash: string }>();
  private readonly listeners = new Set<() => void>();
  private controller?: AbortController;

  constructor(private readonly accountKey: string, private readonly feeds: Feed[]) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  source(feedId: string | undefined): string | undefined {
    return feedId === undefined ? undefined : this.sources.get(feedId)?.url;
  }

  start() {
    const controller = new AbortController();
    this.controller = controller;
    void this.load(controller.signal);

    return () => {
      this.controller?.abort();
      this.controller = undefined;
      this.releaseSources();
    };
  }

  async clearAndRefresh(): Promise<number | undefined> {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const revision = await store.clearFeedIcons(this.accountKey);
    if (controller.signal.aborted) return;
    this.releaseSources();
    const count = await this.refresh(new Map(), revision, controller.signal);
    if (!controller.signal.aborted) return count;
  }

  private async load(signal: AbortSignal) {
    const cached = await store.loadFeedIcons(this.accountKey).catch(() => null);
    if (signal.aborted) return;
    const records = new Map(cached?.icons.map((record) => [record.key, record]));
    for (const feed of this.feeds) {
      const record = records.get(cacheKey(feed));
      if (record) this.show(feed.id, record);
    }
    this.publish();
    await this.refresh(records, cached?.revision, signal);
  }

  private async refresh(records: Map<string, FeedIconRecord>, revision: number | undefined, signal: AbortSignal): Promise<number> {
    const now = Date.now();
    const queue = Array.from(new Map(this.feeds.map((feed) => [feed.id, feed])).values()).flatMap((feed) => {
      const key = cacheKey(feed);
      const record = records.get(key);
      const url = feed.iconUrl?.trim();
      return url && (!record || now - record.checkedAt >= RECHECK_AFTER_MS) ? [{ id: feed.id, key, url }] : [];
    });
    let index = 0;
    let updated = 0;

    const worker = async () => {
      while (!signal.aborted && index < queue.length) {
        const { id, key, url } = queue[index++];
        try {
          const icon = await fetchIcon(url, signal);
          if (!icon || signal.aborted) continue;
          const record = { ...icon, accountKey: this.accountKey, key, checkedAt: Date.now() };
          if (revision !== undefined) {
            // Storage may be unavailable. Keep showing verified images in memory in that case.
            const accepted = await store.putFeedIcon(record, revision, signal).catch(() => true);
            if (!accepted || signal.aborted) continue;
          }
          if (this.show(id, record)) this.publish();
          updated += 1;
        } catch {
          // A failed request or undecodable response leaves the last verified icon in place.
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return updated;
  }

  private show(feedId: string, record: FeedIconRecord): boolean {
    const previous = this.sources.get(feedId);
    if (previous?.hash === record.hash) return false;
    this.sources.set(feedId, { url: URL.createObjectURL(record.blob), hash: record.hash });
    if (previous) URL.revokeObjectURL(previous.url);
    return true;
  }

  private releaseSources() {
    for (const { url } of this.sources.values()) URL.revokeObjectURL(url);
    this.sources.clear();
    this.publish();
  }

  private publish() {
    for (const listener of this.listeners) listener();
  }
}
