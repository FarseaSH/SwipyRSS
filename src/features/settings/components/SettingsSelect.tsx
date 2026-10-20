import { Check, ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

/**
 * Provide a shared reading-settings dropdown with keyboard selection and automatic screen-edge
 * avoidance.
 * 阅读设置共用的下拉框，支持键盘选择和自动避开屏幕边缘。
 */
export function SettingsSelect<T extends string>({ id, labelId, options, value, onChange }: {
  id: string;
  labelId: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const close = () => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); };
  const choose = (index: number) => { onChange(options[index].value); close(); };
  const show = () => { setActiveIndex(selectedIndex); setOpen(true); };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 190), window.innerWidth - 24);
      const above = Math.max(0, rect.top - 20);
      const below = Math.max(0, window.innerHeight - rect.bottom - 20);
      const upward = below < 200 && above > below;
      const maxHeight = Math.min(200, upward ? above : below);
      setPosition({ width, maxHeight, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: upward ? rect.top - 8 - maxHeight : rect.bottom + 8 });
    };
    place();
    menuRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(".settings-select-option.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  const handleMenuKey = (event: KeyboardEvent) => {
    if (event.key === "Tab") { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") close();
    else if (event.key === "Enter" || event.key === " ") choose(activeIndex);
    else setActiveIndex((index) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
  };

  return <>
    <button ref={triggerRef} id={id} type="button" className="settings-select-trigger"
      aria-labelledby={`${labelId} ${id}-value`} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? `${id}-options` : undefined}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); } }}>
      <span id={`${id}-value`}>{options[selectedIndex].label}</span><ChevronDown size={17} className={open ? "open" : ""}/>
    </button>
    {open && createPortal(<div ref={menuRef} id={`${id}-options`} className="settings-select-menu"
      role="listbox" aria-labelledby={labelId} tabIndex={-1}
      aria-activedescendant={`${id}-option-${options[activeIndex].value}`} style={position} onKeyDown={handleMenuKey}>
      {options.map((option, index) => <div key={option.value} id={`${id}-option-${option.value}`}
        role="option" aria-selected={option.value === value}
        className={`settings-select-option ${index === activeIndex ? "active" : ""}`}
        onPointerMove={() => setActiveIndex(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>{option.value === value && <Check size={17} aria-hidden="true"/>}
      </div>)}
    </div>, document.body)}
  </>;
}
