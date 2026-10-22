import { Check, ChevronDown, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useArticleTime } from "@/lib/time/ArticleTimeProvider";
import { fallbackTimeZones } from "@/lib/time/timeZones";
import { deviceTimeZone } from "@/lib/time/articleTime";

const cityNames: Record<string, string> = {
  "Asia/Shanghai": "上海 北京", "Asia/Hong_Kong": "香港", "Asia/Taipei": "台北", "Asia/Tokyo": "东京", "Asia/Singapore": "新加坡",
  "Asia/Seoul": "首尔", "Asia/Kolkata": "加尔各答 印度", "Asia/Calcutta": "加尔各答 印度", "Asia/Dubai": "迪拜",
  "America/Los_Angeles": "洛杉矶", "America/New_York": "纽约", "America/Chicago": "芝加哥", "America/Denver": "丹佛",
  "America/Toronto": "多伦多", "America/Vancouver": "温哥华", "Europe/London": "伦敦", "Europe/Paris": "巴黎", "Europe/Berlin": "柏林",
  "Australia/Sydney": "悉尼", "Pacific/Auckland": "奥克兰", "UTC": "协调世界时",
};
function zoneLabel(zone: string, now: number) {
  const offset = new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(now).find(part => part.type === "timeZoneName")?.value.replace("GMT", "UTC");
  const name = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(now).find(part => part.type === "timeZoneName")?.value;
  return `${cityNames[zone] ?? name ?? zone} · ${zone} (${offset})`;
}
export function TimeZoneSelect() {
  const { preference, timeZone, now, setPreference } = useArticleTime();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    const zones = [...new Set(["UTC", deviceTimeZone(), timeZone, ...(supported ? supported("timeZone") : fallbackTimeZones)])].sort();
    return [{ value: "auto", label: `自动跟随设备 · ${deviceTimeZone()}` }, ...zones.map(zone => ({ value: zone, label: zoneLabel(zone, now) }))];
  }, [now, timeZone]);
  const filtered = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase().replaceAll(" ", "_")) || option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (value: string) => { setPreference(value); dialog.current?.close(); };
  return <div className="timezone-field settings-field">
    <label id="display-timezone-label" htmlFor="display-timezone">显示时区</label>
    <button id="display-timezone" type="button" className="settings-select-trigger timezone-trigger" aria-haspopup="dialog"
      aria-labelledby="display-timezone-label display-timezone-value" onClick={() => { setQuery(""); dialog.current?.showModal(); }}>
      <span id="display-timezone-value">{preference === "auto" ? `自动跟随设备（${timeZone}）` : zoneLabel(timeZone, now)}</span><ChevronDown size={17}/>
    </button>
    <p>仅调整文章发布时间的显示，不影响文章排序和原始数据。设置保存在当前设备。</p>
    <dialog ref={dialog} className="timezone-dialog" aria-labelledby="timezone-dialog-title" onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <div className="timezone-dialog-header"><h3 id="timezone-dialog-title">选择显示时区</h3><button type="button" className="icon-button" aria-label="关闭时区选择" onClick={() => dialog.current?.close()}><X size={18}/></button></div>
      <div className="timezone-search"><Search size={18}/><input autoFocus aria-label="搜索时区" placeholder="搜索城市、地区或 IANA 时区" value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); dialog.current?.querySelector<HTMLButtonElement>(".timezone-options button")?.focus(); } else if (event.key === "Enter" && filtered.length === 1) { event.preventDefault(); choose(filtered[0].value); } }}/></div>
      <div className="timezone-options" onKeyDown={event => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}>
        {filtered.map(option => <button type="button" className="settings-select-option" key={option.value} aria-pressed={preference === option.value} onClick={() => choose(option.value)}>
          <span>{option.label}</span>{preference === option.value && <Check size={17}/>}</button>)}
        {!filtered.length && <p role="status">没有匹配的时区</p>}
      </div>
      <p className="timezone-note">UTC 偏移为当前值；文章时间会按其发布日期自动应用夏令时。</p>
    </dialog>
  </div>;
}
