import type { Article } from "@/types";

type TimedArticle = Pick<Article, "id" | "publishedAt">;
type TimeSection = { label: string; order: number };

export type TimeSectionState = {
  context: string;
  labels: ReadonlyMap<string, string | undefined>;
  lastSection: TimeSection | null;
};

const DAY = 86_400_000;
const dayNumber = (date: Date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
const validTime = (time: number) => Number.isFinite(time) && Number.isFinite(new Date(time).getTime());

/** Share the list's local calendar and Monday-based week convention. */
export function getTimeSection(time: number, now: number): TimeSection | null {
  if (!validTime(time)) return null;
  // Incorrect future dates must not introduce a future section or hold back the time axis.
  const date = new Date(Math.min(time, now));
  const today = new Date(now);
  const day = dayNumber(date);
  const daysAgo = dayNumber(today) - day;
  if (daysAgo <= 1) {
    const slot = Math.floor(date.getHours() / 6);
    return { label: `${daysAgo === 0 ? "今天" : "昨天"}${["凌晨", "早上", "下午", "晚上"][slot]}`, order: day * 4 + slot };
  }
  if (daysAgo <= 6) {
    const prefix = daysAgo <= (today.getDay() + 6) % 7 ? "周" : "上周";
    return { label: `${prefix}${["日", "一", "二", "三", "四", "五", "六"][date.getDay()]}`, order: day * 4 };
  }
  return { label: "更早", order: -Infinity };
}

/** A focus event within the same calendar day must not rebuild frozen sections. */
export function getTimeSectionContext(revision: number, now: number): string {
  const date = new Date(now);
  return `${revision}:${date.getFullYear()}-${date.getMonth()}-${date.getDate()}:${Intl.DateTimeFormat().resolvedOptions().timeZone}:${date.getTimezoneOffset()}`;
}

/**
 * Freeze both label text and article IDs. Only unseen articles form the next suffix-max batch;
 * read/star updates and removals cannot move an existing boundary. A successful list replacement
 * or a calendar/time-zone change supplies a new context and rebuilds the timeline.
 * 冻结文案及其所在文章；每批新文章独立逆向求最新时间，只允许向更早区间推进。
 */
export function updateTimeSections(
  previous: TimeSectionState | null,
  articles: readonly TimedArticle[],
  context: string,
  now: number,
): TimeSectionState {
  const current = previous?.context === context ? previous : null;
  const seen = new Set(current?.labels.keys());
  const added = articles.filter((article) => {
    if (seen.has(article.id)) return false;
    seen.add(article.id);
    return true;
  });
  if (current && !added.length) return current;

  const suffixTimes: (number | undefined)[] = new Array(added.length);
  let latest: number | undefined;
  for (let index = added.length - 1; index >= 0; index -= 1) {
    const time = added[index].publishedAt;
    if (validTime(time)) latest = latest === undefined ? time : Math.max(latest, time);
    suffixTimes[index] = latest;
  }

  const labels = new Map(current?.labels);
  let lastSection = current?.lastSection ?? null;
  added.forEach((article, index) => {
    let label: string | undefined;
    // Unknown dates neither participate nor host a boundary, even when later dates are known.
    if (validTime(article.publishedAt) && suffixTimes[index] !== undefined) {
      const candidate = getTimeSection(suffixTimes[index]!, now)!;
      if (!lastSection || candidate.order < lastSection.order) {
        lastSection = candidate;
        label = candidate.label;
      }
    }
    labels.set(article.id, label);
  });
  return { context, labels, lastSection };
}
