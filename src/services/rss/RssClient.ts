import type {
  AccountBootstrap,
  EntryStateResult,
  FreshRssConnectionInput,
  SavedFreshRssConnection,
  StreamPage,
  UnreadCountSnapshot,
} from "@/types";
import type { EntryStateMutation, MarkStreamReadRequest, StreamRequest } from "./types";

/**
 * The UI depends only on this RSS capability interface; concrete adapters handle runtime
 * differences.
 * UI 唯一依赖的 RSS 能力边界；运行时差异由具体适配器负责。
 */
export interface RssClient {
  testConnection(input: FreshRssConnectionInput): Promise<void>;
  saveConnection(input: FreshRssConnectionInput): Promise<SavedFreshRssConnection>;
  loadSavedConnection(): Promise<SavedFreshRssConnection | null>;
  bootstrapAccount(): Promise<AccountBootstrap>;
  getStream(request: StreamRequest): Promise<StreamPage>;
  editEntryStates(mutation: EntryStateMutation): Promise<EntryStateResult>;
  markStreamRead(request: MarkStreamReadRequest): Promise<void>;
  refreshUnreadCounts(): Promise<UnreadCountSnapshot>;
  clearAccount(): Promise<void>;
}
