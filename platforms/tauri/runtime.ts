/**
 * Determine whether the current page runs in a Tauri WebView. Browser development has no native
 * invoke bridge; explicit detection keeps preview independent and avoids misreporting a missing
 * bridge as a FreshRSS connection failure.
 *
 * 判断当前页面是否运行在 Tauri WebView 中。
 *
 * 浏览器开发模式没有原生 invoke bridge，显式判断可以让预览模式继续
 * 单独运行，同时避免将“找不到 bridge”误报为 FreshRSS 连接失败。
 */
export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
