import { Rss } from "lucide-react";
import { useState } from "react";

type Props = {
  iconUrl?: string;
  color?: string;
  size?: number;
  className?: string;
};

/**
 * Prefer the feed icon returned by FreshRSS; fall back to a generic RSS icon if it is missing or
 * fails to load.
 * 优先显示 FreshRSS 返回的来源图标，缺失或加载失败时回退到通用 RSS 图标。
 */
export function FeedIcon({ iconUrl, color, size = 14, className = "" }: Props) {
  const source = iconUrl?.trim();
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const classes = ["feed-icon", className].filter(Boolean).join(" ");

  if (source && source !== failedSource) {
    return (
      <img
        className={`${classes} feed-icon-image`}
        src={source}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        alt=""
        aria-hidden="true"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSource(source)}
      />
    );
  }

  return <Rss className={`${classes} feed-icon-fallback`} size={size} style={{ color }} aria-hidden="true"/>;
}
