import { useState } from "react";
import { useArticleTime } from "@/lib/time/ArticleTimeProvider";
import type { Article } from "@/types";
import { getTimeSectionContext, updateTimeSections } from "../timeSections";

/** Kept in App so reader/settings round trips retain the original batch boundaries. */
export function useArticleTimeSections(articles: Article[], revision: number, now: number) {
  const { timeZone } = useArticleTime();
  const context = getTimeSectionContext(revision, now, timeZone);
  const [state, setState] = useState(() => updateTimeSections(null, articles, context, now, timeZone));
  const next = updateTimeSections(state, articles, context, now, timeZone);
  if (next !== state) setState(next);
  return next.labels;
}
