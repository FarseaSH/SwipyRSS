import type { AppError } from "@/types";

/**
 * Normalize Tauri IPC, Web fetch, and ordinary exceptions into errors the UI can display
 * consistently.
 * 将 Tauri IPC、Web fetch 和普通异常统一成 UI 可稳定展示的错误。
 */
export function normalizeRssError(error: unknown): AppError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<AppError>;
    if (typeof candidate.kind === "string" && typeof candidate.message === "string") {
      return {
        kind: candidate.kind,
        message: candidate.message,
        retryable: Boolean(candidate.retryable),
      };
    }
  }

  return {
    kind: "Unknown",
    message: error instanceof Error ? error.message : "发生了无法识别的错误",
    retryable: false,
  };
}

export function rssError(kind: string, message: string, retryable = false): AppError {
  return { kind, message, retryable };
}
