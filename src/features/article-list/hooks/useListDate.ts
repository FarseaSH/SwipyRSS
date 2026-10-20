import { useEffect, useState } from "react";

/**
 * Share one midnight timer across the list; synchronize the date and device time zone when
 * returning to the foreground.
 * 整个列表共用一次午夜计时；恢复前台时同步日期和设备时区。
 */
export function useListDate() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      const current = new Date();
      setNow(current.getTime());
      const midnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = window.setTimeout(update, midnight.getTime() - current.getTime() + 50);
    };
    const resume = () => { if (!document.hidden) update(); };
    update();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, []);
  return now;
}
