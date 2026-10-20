/**
 * A touch used to collapse the toolbar or dismiss confirmation does not activate the controls
 * underneath.
 * 一次用于收缩工具栏或关闭确认层的触摸，不表示下层控件被操作。
 */
export function shouldSuppressTouchPress(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-touch-feedback-suppressed]")) return true;
  if (target.closest('[data-list-feedback-suppressed="true"]')) return true;
  const confirmationPage = target.closest('[data-list-confirmation-open="true"]');
  return Boolean(confirmationPage && !target.closest(".mark-read-confirm-popover"));
}
