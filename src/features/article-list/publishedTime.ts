/**
 * Use a list-specific format without changing the publishedLabel used by the reader.
 * 列表独立格式，不改动正文使用的 publishedLabel。
 */
export function formatListPublishedTime(milliseconds: number, nowMilliseconds: number) {
  const date = new Date(milliseconds);
  const now = new Date(nowMilliseconds);
  if (!Number.isFinite(date.getTime())) return { label: "时间未知", recency: "older", dateTime: undefined };
  const dayNumber = (value: Date) => Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000);
  const daysAgo = dayNumber(now) - dayNumber(date);
  const past = milliseconds <= nowMilliseconds;
  const pad = (value: number) => String(value).padStart(2, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const dateTime = date.toISOString();
  if (past && daysAgo === 0) return { label: `今天 ${time}`, recency: "today", dateTime };
  if (past && daysAgo === 1) return { label: `昨天 ${time}`, recency: "yesterday", dateTime };
  const dateLabel = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (past && daysAgo >= 2 && daysAgo <= 6) {
    const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
    const prefix = daysAgo <= (now.getDay() + 6) % 7 ? "周" : "上周";
    return { label: `${prefix}${weekday} ${dateLabel}`, recency: "older", dateTime };
  }
  return { label: date.getFullYear() === now.getFullYear() ? dateLabel : `${date.getFullYear()}-${dateLabel}`, recency: "older", dateTime };
}
