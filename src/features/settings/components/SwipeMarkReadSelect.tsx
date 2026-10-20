import type { SwipeMarkReadMode } from "@/types";
import { SettingsSelect } from "./SettingsSelect";

const OPTIONS: Array<{ value: SwipeMarkReadMode; label: string }> = [
  { value: "off", label: "不标记已读" },
  { value: "both", label: "标记已读" },
  { value: "unread", label: "仅未读页面" },
  { value: "all", label: "仅全部页面" },
];

export function SwipeMarkReadSelect({ value, onChange }: { value: SwipeMarkReadMode; onChange: (value: SwipeMarkReadMode) => void }) {
  return <SettingsSelect id="swipe-mark-read-mode" labelId="swipe-mark-read-label" options={OPTIONS} value={value} onChange={onChange}/>;
}
