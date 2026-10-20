import { ArrowRight, Eye, Rss } from "lucide-react";
import { useMemo } from "react";
import type { ConnectionDefaults } from "@/platform/Platform";
import type { FreshRssConnectionInput } from "@/types";
import { FreshRssConnectionForm } from "./FreshRssConnectionForm";

type Props = {
  connectionDefaults: ConnectionDefaults;
  onConnect: (connection: FreshRssConnectionInput) => Promise<void>;
  onPreview: () => void;
};

/**
 * Show connection setup when no account is configured, while retaining an explicit preview entry
 * point.
 * 未配置账号时显示的连接入口，同时保留显式的预览模式入口。
 */
export function ConnectPage({ connectionDefaults, onConnect, onPreview }: Props) {
  const emptyConnection = useMemo<FreshRssConnectionInput>(
    () => ({ ...connectionDefaults, password: "" }),
    [connectionDefaults],
  );
  return (
    <main className="connection-page">
      <div className="connection-page-glow" aria-hidden="true"/>
      <section className="connection-shell" aria-labelledby="connection-title">
        <div className="connection-brand"><span className="connection-brand-icon"><Rss size={19}/></span><span>SwipyRSS</span></div>
        <div className="connection-card">
          <div className="connection-card-heading">
            <span className="connection-kicker">FRESHRSS CONNECTION</span>
            <h1 id="connection-title">连接你的 FreshRSS</h1>
            <p>输入服务地址和账号信息，开始使用专注、连续的阅读体验。</p>
          </div>
          <FreshRssConnectionForm initialValue={emptyConnection} passwordRequired submitLabel="连接并进入" onSubmit={onConnect}/>
          <div className="connection-preview-divider"><span>或</span></div>
          <button type="button" className="connection-preview-button" onClick={onPreview}>
            <Eye size={18}/><span>进入预览</span><ArrowRight size={17}/>
          </button>
          <p className="connection-preview-help">跳过连接配置，使用示例数据体验完整界面</p>
        </div>
        <p className="connection-footnote">兼容 FreshRSS Google Reader compatible API</p>
      </section>
    </main>
  );
}
