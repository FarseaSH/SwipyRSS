// Mark only events consumed by horizontal momentum protection, leaving later independent scrolling
// and navigation unaffected.
// 只标记已被横向惯性保护消费的事件，不影响后续独立滚动或其他导航。
const blockedHorizontalWheelEvents = new WeakSet<Event>();

export function markBlockedHorizontalWheel(event: WheelEvent) {
  blockedHorizontalWheelEvents.add(event);
}

export function isBlockedHorizontalWheel(event: Event): boolean {
  return blockedHorizontalWheelEvents.has(event);
}
