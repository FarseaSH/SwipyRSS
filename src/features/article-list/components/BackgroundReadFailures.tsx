import { useSyncExternalStore } from "react";
import type { BackgroundReadQueue } from "../BackgroundReadQueue";

export function BackgroundReadFailures({ queue }: { queue: BackgroundReadQueue }) {
  const failures = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  if (!failures.length) return null;
  return <aside className="absolute inset-x-4 bottom-4 z-[90] mx-auto grid max-h-[35dvh] max-w-lg gap-2 overflow-y-auto" aria-label="后台已读操作">
    {failures.map(failure => <div key={failure.id} className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 shadow-lg" role="alert">
      <span className="min-w-0 flex-1 break-words">{failure.name}：{failure.retrying ? "正在重试…" : "标记已读失败，请重试。"}</span>
      <button type="button" className="shrink-0 rounded-lg border border-amber-300 px-3 py-2 font-semibold disabled:opacity-50" disabled={failure.retrying} onClick={() => queue.retry(failure.id)}>重试</button>
    </div>)}
  </aside>;
}
