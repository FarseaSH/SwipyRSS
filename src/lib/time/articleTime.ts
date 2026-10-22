/** Calendar arithmetic uses the selected zone's civil dates, never 24-hour elapsed days. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function deviceTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}
export function validTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}
export function zonedDate(milliseconds: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(milliseconds).map(({ type, value }) => [type, value]));
  const dayNumber = Math.floor(Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86_400_000);
  return { year: parts.year, month: parts.month, day: parts.day, time: `${parts.hour}:${parts.minute}`,
    dayNumber, weekday: new Date(dayNumber * 86_400_000).getUTCDay() };
}
export function formatArticleTime(milliseconds: number, nowMilliseconds: number, timeZone = deviceTimeZone(), mode: "list" | "reader" = "list") {
  if (!Number.isFinite(new Date(milliseconds).getTime())) return { label: "时间未知", recency: "older", dateTime: undefined };
  const date = zonedDate(milliseconds, timeZone);
  const now = zonedDate(nowMilliseconds, timeZone);
  const daysAgo = now.dayNumber - date.dayNumber;
  const past = milliseconds <= nowMilliseconds;
  const dateTime = new Date(milliseconds).toISOString();
  if (past && daysAgo === 0) return { label: `今天 ${date.time}`, recency: "today", dateTime };
  if (past && daysAgo === 1) return { label: `昨天 ${date.time}`, recency: "yesterday", dateTime };
  const dateLabel = `${date.month}-${date.day}${mode === "reader" ? ` ${date.time}` : ""}`;
  if (past && daysAgo >= 2 && daysAgo <= 6) {
    const prefix = daysAgo <= (now.weekday + 6) % 7 ? "周" : "上周";
    return { label: `${prefix}${["日", "一", "二", "三", "四", "五", "六"][date.weekday]} ${dateLabel}`, recency: "older", dateTime };
  }
  return { label: date.year === now.year ? dateLabel : `${date.year}-${dateLabel}`, recency: "older", dateTime };
}
/** Find the next civil date boundary; handles DST and zones whose midnight is skipped. */
export function nextZonedDay(now: number, timeZone: string) {
  const day = zonedDate(now, timeZone).dayNumber;
  let low = now, high = now + 48 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (zonedDate(middle, timeZone).dayNumber === day) low = middle;
    else high = middle;
  }
  return high;
}
