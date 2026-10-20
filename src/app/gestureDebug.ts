export const GESTURE_DEBUG_EVENT = "swipyrss:gesture-debug";

export function isGestureDebugEnabled() {
  return new URLSearchParams(window.location.search).get("gestureDebug") === "1";
}

/**
 * Send recognition results only in diagnostic mode; do not modify or cancel the original touch
 * events.
 * 仅诊断模式发送判断结果；不修改或取消原始触摸事件。
 */
export function reportGestureDebug(message: string) {
  if (!isGestureDebugEnabled()) return;
  window.dispatchEvent(new CustomEvent(GESTURE_DEBUG_EVENT, { detail: message }));
}
