import { invoke } from "@tauri-apps/api/core";
import type {
  AccountBootstrap,
  EntryStateResult,
  FreshRssConnectionInput,
  SavedFreshRssConnection,
  StreamPage,
  UnreadCountSnapshot,
} from "@/types";
import type { EntryStateMutation, MarkStreamReadRequest, StreamRequest } from "@/services/rss/types";
import { isTauriRuntime } from "./runtime";

/**
 * Test connection details without overwriting the account already saved on disk.
 * 测试连接信息，但不会覆盖磁盘上已经保存的账号。
 */
export async function testConnection(input: FreshRssConnectionInput): Promise<void> {
  assertTauriRuntime();
  await invoke("test_connection", { input });
}

/**
 * Validate and save the connection; Rust alone handles password persistence.
 * 验证并保存连接，密码保存操作完全由 Rust 负责。
 */
export async function saveConnection(input: FreshRssConnectionInput): Promise<SavedFreshRssConnection> {
  assertTauriRuntime();
  return invoke<SavedFreshRssConnection>("save_connection", { input });
}

/**
 * Read connection fields safe for display; the result never contains the API password.
 * 读取可安全回显的连接字段，返回值永远不包含 API 密码。
 */
export async function loadSavedConnection(): Promise<SavedFreshRssConnection | null> {
  assertTauriRuntime();
  return invoke<SavedFreshRssConnection | null>("load_saved_connection");
}

/**
 * Fetch subscriptions, folders, and unread counts as startup data for the authenticated UI.
 * 获取订阅、文件夹和未读数，作为登录后界面的启动数据。
 */
export async function bootstrapAccount(): Promise<AccountBootstrap> {
  assertTauriRuntime();
  return invoke<AccountBootstrap>("bootstrap_account");
}

/**
 * Fetch one article page; pass a continuation to load the current stream's next page.
 * 获取一页文章；传 continuation 时加载当前 stream 的下一页。
 */
export async function getStream(request: StreamRequest): Promise<StreamPage> {
  assertTauriRuntime();
  return invoke<StreamPage>("get_stream", { request });
}

/**
 * Set explicit final states for a batch of articles and report whether automatic reauthentication
 * occurred.
 * 将一批文章更新为明确的最终状态，并返回是否经历过自动重登。
 */
export async function editEntryStates(mutation: EntryStateMutation): Promise<EntryStateResult> {
  assertTauriRuntime();
  return invoke<EntryStateResult>("edit_entry_states", { mutation });
}

/**
 * Mark all articles in the specified FreshRSS stream as read before the time boundary.
 * 将指定 FreshRSS stream 在时间边界以前的所有文章标记为已读。
 */
export async function markStreamRead(request: MarkStreamReadRequest): Promise<void> {
  assertTauriRuntime();
  await invoke("mark_stream_read", { request });
}

/**
 * Read only global and per-feed unread counts for explicitly requested lightweight reconciliation.
 * 只读取全局和 Feed 未读数量，用于明确触发的轻量校准。
 */
export async function refreshUnreadCounts(): Promise<UnreadCountSnapshot> {
  assertTauriRuntime();
  return invoke<UnreadCountSnapshot>("refresh_unread_counts");
}

/**
 * Clear the saved connection, in-memory session, and lightweight cache for this account.
 * 清除保存的连接、内存会话以及该账号对应的轻量缓存。
 */
export async function clearAccount(): Promise<void> {
  assertTauriRuntime();
  await invoke("clear_account");
}

/**
 * Prevent browser preview from accidentally invoking native commands. Preview must explicitly use
 * mock data; a missing bridge must not masquerade as an ordinary network error.
 *
 * 防止浏览器预览误调用原生命令。预览模式应显式使用 mock 数据，不能把
 * bridge 缺失伪装成一次普通网络错误。
 */
function assertTauriRuntime(): void {
  if (!isTauriRuntime()) {
    throw new Error("当前运行在浏览器预览中，无法调用 Tauri 原生命令。");
  }
}
