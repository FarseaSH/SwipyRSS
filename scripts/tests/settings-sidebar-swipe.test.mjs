import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../src/app/hooks/useSidebarSwipe.ts", import.meta.url), "utf8");

// Run the real hook against event targets, with controlled movement times and viewport size.
function setup({ page = "settings", desktop = false, sidebarOpen = false } = {}) {
  let now = 0, opened = 0, closed = 0, restored = 0, modal = false;
  const cleanups = [], frames = [];
  class Target {
    listeners = new Map(); style = {}; captured = new Set(); clientWidth = 390;
    control = false;
    closest(selector) { return this.control && selector.includes("input") ? this : null; }
    querySelector() { return null; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeEventListener(type) { this.listeners.delete(type); }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    emit(type, values = {}) {
      const event = { type, pointerId: 1, isPrimary: true, pointerType: "touch", target: this,
        clientX: 100, clientY: 200, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...values };
      this.listeners.get(type)?.(event);
      return event;
    }
  }
  const main = new Target(), drawer = new Target(), backdrop = new Target(), win = new Target();
  main.ownerDocument = { querySelector: () => modal ? {} : null };
  Object.assign(win, { matchMedia: () => ({ matches: desktop }), clearTimeout() {}, setTimeout: () => 1,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; }, cancelAnimationFrame() {} });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Element: Target, window: win, performance: { now: () => now },
    require: name => name === "react" ? { useRef: value => ({ current: value }), useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } }
      : name.includes("gestureDebug") ? { reportGestureDebug() {} } : { markBlockedHorizontalWheel() {} },
  });
  exports.useSidebarSwipe({ current: main }, { current: drawer }, { current: backdrop }, true, sidebarOpen, 0,
    () => opened++, () => closed++, page === "list", () => restored++, page);
  const send = (type, x, y = 200, extra = {}) => { now += 100; return main.emit(type, { clientX: x, clientY: y, ...extra }); };
  return { main, drawer, backdrop, win, send, control: () => { const target = new Target(); target.control = true; return target; },
    modal: value => { modal = value; }, counts: () => ({ opened, closed, restored }),
    cleanup: () => cleanups.reverse().forEach(fn => fn()) };
}

test("settings opens only on release without moving drawer or backdrop", () => {
  const app = setup();
  app.send("pointerdown", 100); app.send("pointermove", 160); app.send("pointermove", 210);
  assert.equal(app.counts().opened, 0);
  assert.deepEqual(app.drawer.style, {}); assert.deepEqual(app.backdrop.style, {});
  app.send("pointerup", 210);
  assert.equal(app.counts().opened, 1);
  assert.equal(app.main.captured.size, 0);
  assert.equal(app.win.emit("click").prevented, true, "release click cannot close the newly opened drawer");
  assert.notEqual(app.win.emit("click").prevented, true, "a subsequent backdrop click is allowed");
  app.cleanup();
});

test("short, vertical, leftward, cancelled and desktop swipes do not open settings sidebar", () => {
  for (const [x, y, end, desktop] of [[125, 200, "pointerup", false], [210, 400, "pointerup", false],
    [0, 200, "pointerup", false], [210, 200, "pointercancel", false], [210, 200, "pointerup", true]]) {
    const app = setup({ desktop });
    app.send("pointerdown", 100); app.send("pointermove", x, y); app.send(end, x, y);
    assert.deepEqual(app.counts(), { opened: 0, closed: 0, restored: 0 });
    app.cleanup();
  }
});

test("settings controls, non-primary touches and open modal surfaces take priority", () => {
  for (const kind of ["control", "modal", "secondary"]) {
    const app = setup(); if (kind === "modal") app.modal(true);
    app.send("pointerdown", 100, 200, kind === "control" ? { target: app.control() } : { isPrimary: kind !== "secondary" });
    app.send("pointermove", 210); app.send("pointerup", 210);
    assert.equal(app.counts().opened, 0); app.cleanup();
  }
});

test("settings ignores another pointer and releases capture on cleanup", () => {
  const app = setup(); app.send("pointerdown", 100); app.send("pointermove", 140);
  app.send("pointerup", 250, 200, { pointerId: 2 });
  assert.equal(app.counts().opened, 0);
  app.cleanup(); assert.equal(app.main.captured.size, 0);
});

test("settings wheel opens sidebar but never restores the reader", () => {
  const app = setup();
  app.main.emit("wheel", { deltaX: 100, deltaY: 0 });
  assert.equal(app.counts().restored, 0);
  app.main.emit("wheel", { deltaX: -100, deltaY: 0 });
  assert.equal(app.counts().opened, 1); app.cleanup();
});

test("settings open sidebar reuses left-swipe dismissal", () => {
  const app = setup({ sidebarOpen: true });
  app.drawer.emit("pointerdown", { clientX: 220 });
  app.win.emit("pointermove", { clientX: 120 });
  assert.equal(app.counts().closed, 1); app.cleanup();
});

test("list retains its existing drag preview and reader restoration", () => {
  const app = setup({ page: "list" });
  app.send("pointerdown", 100); app.send("pointermove", 210);
  assert.match(app.drawer.style.transform, /translateX/);
  assert.notEqual(app.backdrop.style.opacity, undefined);
  app.send("pointerup", 210); assert.equal(app.counts().opened, 1); app.cleanup();
  const list = setup({ page: "list" });
  list.main.emit("wheel", { deltaX: 100, deltaY: 0 });
  assert.equal(list.counts().restored, 1); list.cleanup();
});

test("a second finger or a modal opened mid-gesture cancels settings navigation", () => {
  for (const kind of ["pinch", "modal"]) {
    const app = setup(); app.send("pointerdown", 100); app.send("pointermove", 210);
    if (kind === "pinch") app.send("pointerdown", 150, 200, { pointerId: 2, isPrimary: false });
    else app.modal(true);
    app.send("pointerup", 210);
    assert.equal(app.counts().opened, 0);
    assert.equal(app.main.captured.size, 0); app.cleanup();
  }
});
