import { Check, Copy, Download, FileJson, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Feed } from "@/types";
import { parseSettingsBackup, planSettingsImport, type SettingsBackup } from "../settingsBackup";

type Props = {
  feeds: readonly Feed[];
  onExport: () => SettingsBackup;
  onImport: (backup: SettingsBackup) => void;
  onClose: () => void;
};

export function SettingsBackupDialog({ feeds, onExport, onImport, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const exportTabRef = useRef<HTMLButtonElement>(null);
  const importTabRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [tab, setTab] = useState<"export" | "import">("export");
  const [exportText, setExportText] = useState(() => JSON.stringify(onExport(), null, 2));
  const [importText, setImportText] = useState("");
  const [pending, setPending] = useState<SettingsBackup | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [success, setSuccess] = useState(false);
  const backdropPress = useRef(false);
  const summary = pending ? planSettingsImport(pending, feeds) : null;

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus({ preventScroll: true });
    confirmRef.current?.scrollIntoView({ block: "nearest" });
  }, [pending]);

  useEffect(() => {
    if (error || status) feedbackRef.current?.scrollIntoView({ block: "nearest" });
  }, [error, status]);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    const viewport = window.visualViewport;
    const resize = () => {
      dialog.style.setProperty("--backup-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
      dialog.style.setProperty("--backup-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  function switchTab(next: "export" | "import") {
    setTab(next);
    setPending(null);
    setError("");
    setStatus("");
    setSuccess(false);
    if (next === "export") setExportText(JSON.stringify(onExport(), null, 2));
  }

  async function copySettings() {
    setError("");
    setStatus("");
    try {
      await navigator.clipboard.writeText(exportText);
      setStatus("设置已复制，可以粘贴到其他设备或保存为备份。");
    } catch {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setStatus("已选中备份文本，请使用系统的复制操作。");
    }
  }

  function downloadSettings() {
    const url = URL.createObjectURL(new Blob([exportText], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "swipyrss-settings.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("已开始下载 swipyrss-settings.json。");
  }

  function checkImport() {
    setError("");
    setStatus("");
    try {
      setPending(parseSettingsBackup(importText));
    } catch (cause) {
      setPending(null);
      setError(cause instanceof Error ? cause.message : "无法读取备份，请检查文本。");
      textareaRef.current?.focus();
    }
  }

  function confirmImport() {
    if (!pending || !summary) return;
    try {
      onImport(pending);
      setStatus(`设置导入成功。已恢复 ${summary.settingCount} 项应用设置、${summary.generalListCount} 项通用列表偏好；Feed 匹配 ${summary.matchedFeeds} 项，未匹配 ${summary.skippedFeeds} 项已跳过。`);
      setSuccess(true);
      setPending(null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导入失败，请重试。");
    }
  }

  return createPortal(
    <dialog ref={dialogRef} className="backup-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-backup-title" aria-describedby="settings-backup-description"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), textarea'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget; }}
      onClick={(event) => { if (event.target === event.currentTarget && backdropPress.current) onClose(); }}>
      <section className="backup-card">
        <header className="backup-header">
          <div><FileJson size={20}/><h2 id="settings-backup-title">导入 / 导出设置</h2></div>
          <button autoFocus type="button" className="icon-button" onClick={onClose} aria-label="关闭设置备份"><X size={20}/></button>
        </header>
        <div className="backup-content">
        <p id="settings-backup-description" className="backup-description">通过 JSON 文本迁移应用偏好和列表阅读模式。不包含 FreshRSS 连接信息、文章数据或阅读记录。</p>
        <div className="backup-tabs" role="tablist" aria-label="设置备份方式" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "export" : event.key === "End" ? "import" : tab === "export" ? "import" : "export";
          switchTab(next);
          (next === "export" ? exportTabRef : importTabRef).current?.focus();
        }}>
          <button ref={exportTabRef} id="backup-export-tab" type="button" role="tab" aria-selected={tab === "export"} aria-controls="backup-panel" tabIndex={tab === "export" ? 0 : -1} onClick={() => switchTab("export")}>导出设置</button>
          <button ref={importTabRef} id="backup-import-tab" type="button" role="tab" aria-selected={tab === "import"} aria-controls="backup-panel" tabIndex={tab === "import" ? 0 : -1} onClick={() => switchTab("import")}>导入设置</button>
        </div>
        <div className="backup-panel" id="backup-panel" role="tabpanel" aria-labelledby={`backup-${tab}-tab`}>
          <label htmlFor="backup-json">{tab === "export" ? "当前设置 · JSON" : "粘贴备份 · JSON"}</label>
          <textarea ref={textareaRef} id="backup-json" wrap="off" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-invalid={Boolean(error)} aria-describedby={error ? "backup-error" : "backup-hint"}
            readOnly={tab === "export" || Boolean(pending) || success} value={tab === "export" ? exportText : importText}
            placeholder="在这里粘贴从另一台设备复制的 SwipyRSS 设置备份…"
            onChange={(event) => { setImportText(event.target.value); setError(""); setStatus(""); }}/>
          <p id="backup-hint" className="backup-hint">{tab === "export" ? "仅包含已保存的 Feed 偏好；Feed 组和上次访问位置不在备份中。" : "仅覆盖备份中包含的设置。Feed 按订阅 URL 匹配，未匹配的来源会跳过。"}</p>
        </div>
        {summary && <div ref={confirmRef} className="backup-confirm" role="status" tabIndex={-1}>
          <strong>确认导入这些设置？</strong>
          <p>{summary.settingCount} 项应用设置 · {summary.generalListCount} 项通用列表偏好 · Feed 匹配 {summary.matchedFeeds} 项，跳过 {summary.skippedFeeds} 项。</p>
          <p>覆盖当前设备的对应设置，其余设置保留。不会修改文章的实际已读或收藏状态。</p>
        </div>}
        {error && <p ref={feedbackRef} id="backup-error" className="backup-feedback error" role="alert">{error}</p>}
        {status && <p ref={feedbackRef} className={`backup-feedback ${success ? "success" : ""}`} role="status">{success && <Check size={16}/>}<span>{status}</span></p>}
        </div>
        <footer className="backup-actions">
          {tab === "export" ? <>
            <button type="button" className="connection-secondary-button" onClick={downloadSettings}><Download size={16}/>下载 JSON</button>
            <button type="button" className="connection-primary-button" onClick={() => void copySettings()}><Copy size={16}/>复制设置</button>
          </> : success ? <>
            <button type="button" className="connection-secondary-button" onClick={() => { setSuccess(false); setImportText(""); setStatus(""); textareaRef.current?.focus(); }}>继续导入</button>
            <button type="button" className="connection-primary-button" onClick={onClose}>完成</button>
          </> : pending ? <>
            <button type="button" className="connection-secondary-button" onClick={() => { setPending(null); setError(""); textareaRef.current?.focus(); }}>返回编辑</button>
            <button type="button" className="connection-primary-button" onClick={confirmImport}>确认导入</button>
          </> : <>
            <button type="button" className="connection-secondary-button" onClick={onClose}>取消</button>
            <button type="button" className="connection-primary-button" disabled={!importText.trim()} onClick={checkImport}>检查并导入</button>
          </>}
        </footer>
      </section>
    </dialog>, document.body,
  );
}
