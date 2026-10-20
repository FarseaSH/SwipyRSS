/**
 * The side toolbar is a temporary overlay and does not participate in list pagination or
 * reading-boundary calculations.
 * 侧边工具栏是临时浮层，不参与列表的分页与阅读边界计算。
 */
export function getBottomToolbar(toolbar: HTMLElement | null): HTMLElement | null {
  return toolbar?.dataset.toolbarPosition === "left" || toolbar?.dataset.toolbarPosition === "right" ? null : toolbar;
}
