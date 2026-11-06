import { useLayoutEffect, useState } from "react";
import type { AppView } from "@/types";
import type { BackgroundReadQueue } from "@/features/article-list/BackgroundReadQueue";
import { BackgroundReadFailures } from "@/features/article-list/components/BackgroundReadFailures";
import { useRetainedNoticeText } from "./useRetainedNoticeText";

export function NotificationCenter({ message, view, queue }: {
  message: string;
  view: AppView;
  queue: BackgroundReadQueue;
}) {
  const text = useRetainedNoticeText(message);
  const [present, setPresent] = useState(Boolean(message));
  useLayoutEffect(() => {
    if (message) {
      setPresent(true);
      return;
    }
    // Remove the empty slot only after the bubble has faded out, retaining its exit dimensions.
    const timer = window.setTimeout(() => setPresent(false), 220);
    return () => window.clearTimeout(timer);
  }, [message]);

  return <aside className="notification-region" data-view={view} aria-label="消息通知">
    <div className={`notification ${message ? "visible" : ""}`} hidden={!present} role="status" aria-atomic="true" aria-hidden={!message}>
      <div className="notification-surface">{text}</div>
    </div>
    <BackgroundReadFailures queue={queue}/>
  </aside>;
}
