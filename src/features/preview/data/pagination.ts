import type { Article } from "@/types";

/** Use the same append path in preview and live mode, with ten mock articles per batch. */
export function getPreviewArticlePage(articles: Article[], continuation?: string) {
  const offset = continuation ? Number(continuation.slice("preview:".length)) : 0;
  const end = offset + 10;
  return {
    items: articles.slice(offset, end),
    continuation: end < articles.length ? `preview:${end}` : undefined,
  };
}
