/** Place an item on the second row, clamped to the available scroll range. */
export function secondRowScrollTop(itemTop: number, rowHeight: number, scrollHeight: number, viewportHeight: number) {
  return Math.max(0, Math.min(itemTop - rowHeight, Math.max(0, scrollHeight - viewportHeight)));
}

/** A gentle start/stop allowance plus travel time, with no maximum duration. */
export function sidebarScrollDuration(distance: number) {
  return distance === 0 ? 0 : 160 + Math.abs(distance) * 1.2;
}

/** Match CSS ease so expansion and scrolling follow the same motion curve. */
export function sidebarMotionProgress(progress: number) {
  if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress));
  const bezier = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let low = 0, high = 1;
  for (let index = 0; index < 16; index += 1) {
    const middle = (low + high) / 2;
    if (bezier(middle, .25, .25) < progress) low = middle;
    else high = middle;
  }
  return bezier((low + high) / 2, .1, 1);
}

export function scrollbarGeometry(viewportHeight: number, contentHeight: number, scrollTop: number) {
  const maxScroll = Math.max(0, contentHeight - viewportHeight);
  const thumbHeight = maxScroll > 0 ? Math.min(viewportHeight, Math.max(24, viewportHeight * viewportHeight / contentHeight)) : viewportHeight;
  const travel = Math.max(0, viewportHeight - thumbHeight);
  return { maxScroll, thumbHeight, travel, thumbTop: maxScroll > 0 ? Math.max(0, Math.min(scrollTop, maxScroll)) / maxScroll * travel : 0 };
}
