export type ListToolbarReadAction = "mark-all-read" | "mark-above-read";

// Future toolbar customization can select either action. The default is independent of
// swipe-to-mark preferences, which only control paging gestures.
// 后续自定义工具栏可选择任一动作；默认动作不再跟随上滑标记设置。
export function getDefaultListToolbarReadAction(): ListToolbarReadAction {
  return "mark-all-read";
}

/**
 * Keep Read Above available for future custom toolbar buttons, including its boundary snapshot,
 * confirmation and exact-ID write path. It is not displayed by default.
 * 保留“上方已读”的边界快照、确认和精确 ID 提交流程，供后续自定义工具栏使用，默认不展示。
 */
export function shouldMarkAboveRead(action: ListToolbarReadAction = getDefaultListToolbarReadAction()): boolean {
  return action === "mark-above-read";
}
