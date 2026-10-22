/** Clamp an item's second-row placement to the real scrollable content. */
export function secondRowScrollTop(itemTop: number, rowHeight: number, scrollHeight: number, viewportHeight: number) {
  return Math.max(0, Math.min(itemTop - rowHeight, scrollHeight - viewportHeight));
}

export function scrollbarGeometry(viewportHeight: number, contentHeight: number, scrollTop: number) {
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const thumbHeight = maxScroll > 0 ? Math.min(viewportHeight, Math.max(24, viewportHeight * viewportHeight / contentHeight)) : viewportHeight;
  const travel = Math.max(0, viewportHeight - thumbHeight);
  return { maxScroll, thumbHeight, travel, thumbTop: maxScroll > 0 ? Math.max(0, Math.min(scrollTop, maxScroll)) / maxScroll * travel : 0 };
}
