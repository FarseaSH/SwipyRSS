import { useArticleTime } from "@/lib/time/ArticleTimeProvider";

export function useListDate() { return useArticleTime().now; }
