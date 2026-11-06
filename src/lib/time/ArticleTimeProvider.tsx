import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectDeviceTimeZone, nextZonedDay, validTimeZone } from "./articleTime";
export const TIME_ZONE_STORAGE_KEY = "swipyrss.display-timezone.v1";
function loadPreference() {
  try {
    const value = localStorage.getItem(TIME_ZONE_STORAGE_KEY);
    return value && value !== "auto" && validTimeZone(value) ? value : "auto";
  } catch { return "auto"; }
}
const Context = createContext({ preference: "auto", timeZone: "UTC", deviceTimeZone: "UTC", deviceTimeZoneFallback: false, now: 0, setPreference: (_value: string) => {} });
export function ArticleTimeProvider({ children }: { children: ReactNode }) {
  const [preference, setValue] = useState(loadPreference);
  const [clock, setClock] = useState(() => ({ now: Date.now(), device: detectDeviceTimeZone() }));
  const timeZone = preference === "auto" ? clock.device.timeZone : preference;
  useEffect(() => {
    let timer = 0;
    const update = () => {
      clearTimeout(timer);
      const now = Date.now();
      const device = detectDeviceTimeZone();
      setClock({ now, device });
      // A bounded check also detects device zone/clock changes while the app stays open.
      timer = window.setTimeout(update, Math.min(60_000, nextZonedDay(now, preference === "auto" ? device.timeZone : preference) - now + 50));
    };
    const resume = () => { if (!document.hidden) update(); };
    const sync = (event: StorageEvent) => { if (event.key === TIME_ZONE_STORAGE_KEY || event.key === null) setValue(loadPreference()); };
    update();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("storage", sync);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("focus", resume); window.removeEventListener("storage", sync); };
  }, [preference]);
  const value = useMemo(() => ({ preference, timeZone, deviceTimeZone: clock.device.timeZone, deviceTimeZoneFallback: clock.device.fallback, now: clock.now, setPreference: (next: string) => {
    if (next !== "auto" && !validTimeZone(next)) return;
    setValue(next);
    setClock({ now: Date.now(), device: detectDeviceTimeZone() });
    try { localStorage.setItem(TIME_ZONE_STORAGE_KEY, next); } catch { /* Keep the session preference when storage is unavailable. */ }
  } }), [preference, timeZone, clock]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useArticleTime() { return useContext(Context); }
