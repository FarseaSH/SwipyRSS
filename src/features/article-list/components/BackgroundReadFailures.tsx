import { useSyncExternalStore } from "react";
import type { BackgroundReadQueue } from "../BackgroundReadQueue";

export function BackgroundReadFailures({ queue }: { queue: BackgroundReadQueue }) {
  const failures = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  if (!failures.length) return null;
  return <>{failures.map(failure => <div key={failure.id} className="notification visible" role="alert">
    <div className="notification-surface notification-action">
      <span>{failure.name}：{failure.retrying ? "正在重试…" : "标记已读失败，请重试。"}</span>
      <button type="button" disabled={failure.retrying} onClick={() => queue.retry(failure.id)}>重试</button>
    </div>
  </div>)}</>;
}
