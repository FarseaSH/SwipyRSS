import type { ComponentType } from "react";
import type { RssClient } from "@/services/rss/RssClient";
import type { FreshRssConnectionInput } from "@/types";

export type ConnectionDefaults = Pick<FreshRssConnectionInput, "apiUrl" | "username">;

export type ExternalArticleViewProps = {
  url: string;
  onClose: () => void;
  onError: (error: unknown) => void;
  onToast: (message: string) => void;
};

/**
 * Open articles externally or supply an embedded view without exposing a native SDK to the app.
 * 在外部打开文章或提供内嵌视图，不让公共应用依赖原生 SDK。
 */
export type ExternalArticles =
  | { kind: "external"; open: (url: string) => Promise<void> }
  | { kind: "embedded"; View: ComponentType<ExternalArticleViewProps> };

/**
 * Select one stable platform instance at startup; shared pages depend only on these capabilities.
 * 在启动入口选择一个稳定的平台实例；共享页面只依赖这里定义的能力。
 */
export interface AppPlatform {
  rssClient: RssClient;
  getConnectionDefaults(): ConnectionDefaults;
  isPreviewRequested(): boolean;
  externalArticles: ExternalArticles;
  initialize?(): void;
}
