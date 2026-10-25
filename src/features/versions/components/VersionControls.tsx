import { Settings } from "lucide-react";
import { requestHostUpdate, useHostState } from "@/services/web/host";

type Props = { onSettings: () => void; active: boolean };
export function VersionControls({ onSettings, active }: Props) {
  const state = useHostState();
  if (!state) return <button className={`sidebar-item ${active ? "active" : ""}`} onClick={onSettings}><Settings size={17}/>设置</button>;
  const version = state.channel === "test" ? `Test · ${state.buildId.split("-")[1]?.slice(0, 7) || state.version}` : `v${state.version}`;
  const label = state.update === "downloading" ? "下载中…" : state.update === "ready" ? "重启" : state.mode === "direct" ? "刷新更新" : "更新";
  return <div className="flex min-w-0 items-center gap-3 px-3 text-xs text-muted">
    <span className="min-w-0 truncate" title={`${state.version} · ${state.buildId}`} data-running-build={state.buildId}>{version}</span>
    {state.update !== "idle" ? <button type="button" className="shrink-0 text-blue-600" disabled={state.update === "downloading"} onClick={requestHostUpdate}>{label}</button> : null}
    <button type="button" className={`icon-button ml-auto shrink-0 ${active ? "active" : ""}`} onClick={onSettings} aria-label="设置"><Settings size={17}/></button>
  </div>;
}

export function VersionSettings() {
  const state = useHostState();
  if (!state) return null;
  return <section className="settings-card" aria-labelledby="version-settings-title">
    <div className="settings-card-header"><div><h3 id="version-settings-title">程序版本</h3><p>{state.mode === "enhanced" ? "PWA 增强模式" : "普通网页模式"} · v{state.version}</p></div>
      <button type="button" onClick={() => void window.swipyHost?.check()}>检查更新</button>
    </div>
    <div className="settings-field"><label htmlFor="program-build">可用通道与版本</label>
      <select id="program-build" value={state.builds.some((b) => b.buildId === state.buildId) ? state.buildId : ""} disabled={state.update === "downloading"}
        onChange={(event) => void window.swipyHost?.chooseBuild(event.target.value).catch((error: unknown) => console.warn("版本切换失败", error))}>
        {!state.builds.some((b) => b.buildId === state.buildId) ? <option value="">当前本机缓存版本</option> : null}
        {state.builds.map((build) => <option key={build.buildId} value={build.buildId}>{build.channel} · {build.version}</option>)}
      </select>
      <p>{state.mode === "enhanced" ? "新版准备完成后点击重启切换。" : "选择版本后会重新打开页面。"}</p>
    </div>
    {state.update !== "idle" ? <button type="button" disabled={state.update === "downloading"} onClick={requestHostUpdate}>
      {state.update === "downloading" ? "下载中…" : state.update === "ready" ? "重启" : state.mode === "direct" ? "刷新更新" : "更新"}
    </button> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
    <div className="mt-3 flex gap-4 text-sm"><button type="button" onClick={() => window.swipyHost?.reload()}>重新打开</button>
      {state.mode === "enhanced" ? <button type="button" onClick={() => window.swipyHost?.useDirect()}>使用普通网页</button> : null}
    </div>
  </section>;
}
