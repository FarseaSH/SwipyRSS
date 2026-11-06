import { Rss } from "lucide-react";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import type { FeedIconCache } from "@/services/web/FeedIconCache";

export const FeedIconContext = createContext<FeedIconCache | null>(null);
const subscribeWithoutCache = () => () => {};

type Props = {
  feedId?: string;
  color?: string;
  size?: number;
  className?: string;
};

export function FeedIcon({ feedId, color, size = 14, className = "" }: Props) {
  const cache = useContext(FeedIconContext);
  const source = useSyncExternalStore(cache?.subscribe ?? subscribeWithoutCache, () => cache?.source(feedId));
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
        onError={() => setFailedSource(source)}
      />
    );
  }

  return <Rss className={`${classes} feed-icon-fallback`} size={size} style={{ color }} aria-hidden="true"/>;
}
