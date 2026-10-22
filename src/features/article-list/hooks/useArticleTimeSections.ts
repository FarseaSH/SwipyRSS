import { useState } from "react";
import type { Article } from "@/types";
import { getTimeSectionContext, updateTimeSections } from "../timeSections";

/** Kept in App so reader/settings round trips retain the original batch boundaries. */
export function useArticleTimeSections(articles: Article[], revision: number, now: number) {
  const context = getTimeSectionContext(revision, now);
  const [state, setState] = useState(() => updateTimeSections(null, articles, context, now));
  const next = updateTimeSections(state, articles, context, now);
  if (next !== state) setState(next);
  return next.labels;
}
