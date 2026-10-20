import type { RssClient } from "@/services/rss/RssClient";
import * as commands from "./client";

/**
 * Provide a thin adapter that preserves existing Rust commands, SQLite caching, and credential
 * handling.
 * 保持现有 Rust commands、SQLite 缓存和凭据模型完全不变的薄适配器。
 */
export class TauriRssClient implements RssClient {
  testConnection = commands.testConnection;
  saveConnection = commands.saveConnection;
  loadSavedConnection = commands.loadSavedConnection;
  bootstrapAccount = commands.bootstrapAccount;
  getStream = commands.getStream;
  editEntryStates = commands.editEntryStates;
  markStreamRead = commands.markStreamRead;
  refreshUnreadCounts = commands.refreshUnreadCounts;
  clearAccount = commands.clearAccount;
}
