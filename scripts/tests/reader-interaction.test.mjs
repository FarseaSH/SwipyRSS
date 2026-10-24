import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real hook's registered handlers; replace only React and browser boundaries.
const compiled = ts.transpileModule(readFileSync(new URL("../../src/features/reader/hooks/useReaderInteraction.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function reader({ enabled = true, hasUrl = true } = {}) {
  let now = 0;
  let opened = 0;
  let returned = 0;
  let selected = false;
  let cleanup;
  const frames = [];
  class Element {
    constructor(kind) {
      this.kind = kind;
      this.attrs = new Set();
      this.style = { setProperty() {} };
      this.classList = { remove() {}, add() {} };
      this.scrollTop = 0;
      this.scrollLeft = 0;
      this.clientWidth = 390;
      this.clientHeight = 800;
      this.scrollWidth = 390;
      this.scrollHeight = 2400;
      this.handlers = new Map();
    }
    closest(selector) {
      if (selector === "[data-reader-horizontal-scroll]") return this.kind === "code" ? this : null;
      return ["link", "button", "input", "editable", "code"].includes(this.kind) ? this : null;
    }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    removeEventListener(type) { this.handlers.delete(type); }
    setPointerCapture() {}
    toggleAttribute(name, value) { if (value) this.attrs.add(name); else this.attrs.delete(name); }
    removeAttribute(name) { this.attrs.delete(name); }
  }
  const viewport = new Element();
  const panel = new Element();
  const hint = new Element();
  const effects = [];
  const exports = {};
  const browser = {
    getSelection: () => ({ isCollapsed: !selected }),
    clearTimeout() {},
    setTimeout: () => 1,
    cancelAnimationFrame() {},
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
  };
  vm.runInNewContext(compiled, {
    exports, Element, performance: { now: () => now }, window: browser,
    requestAnimationFrame: browser.requestAnimationFrame, cancelAnimationFrame() {},
    require: () => ({
      useCallback: fn => fn, useEffect: fn => effects.push(fn),
      useRef: current => ({ current }), useState: value => [value, () => {}],
    }),
  });
  const ref = current => ({ current });
  exports.useReaderInteraction(ref(viewport), ref(new Element()), ref(new Element()), ref(panel),
    () => { returned += 1; }, undefined, enabled, false,
    hasUrl ? () => { opened += 1; } : undefined, ref(hint));
  cleanup = effects[0]();
  const target = new Element();
  function event(type, x, y = 300, options = {}) {
    now += options.elapsed ?? 200;
    const e = { type, pointerType: "touch", pointerId: 1, isPrimary: true,
      clientX: x, clientY: y, target, preventDefault() { this.prevented = true; }, ...options };
    viewport.handlers.get(type)?.(e);
    return e;
  }
  return { event, hint, panel, viewport, target: kind => new Element(kind),
    opened: () => opened, returned: () => returned, select: value => { selected = value; },
    cleanup, frames };
}

test("touch swipe opens synchronously on release, shows feedback, and never moves the panel", () => {
  const r = reader();
  r.event("pointerdown", 300);
  r.event("pointermove", 250);
  assert.ok(r.hint.attrs.has("data-visible"));
  assert.ok(!r.hint.attrs.has("data-ready"));
  r.event("pointermove", 200);
  assert.ok(r.hint.attrs.has("data-ready"));
  assert.equal(r.panel.style.transform, undefined);
  assert.equal(r.opened(), 0);
  r.event("pointerup", 200);
  assert.equal(r.opened(), 1);
  assert.ok(!r.hint.attrs.has("data-visible"));
  r.event("pointerup", 200);
  assert.equal(r.opened(), 1);
});

test("short swipes and tiny fast flicks do not open", () => {
  for (const [distance, elapsed] of [[50, 200], [20, 5]]) {
    const r = reader();
    r.event("pointerdown", 300);
    r.event("pointermove", 300 - distance, 300, { elapsed });
    r.event("pointerup", 300 - distance, 300, { elapsed: 1 });
    assert.equal(r.opened(), 0);
  }
});

test("fast swipe needs minimum travel and a recent velocity", () => {
  for (const [pause, expected] of [[1, 1], [150, 0]]) {
    const r = reader();
    r.event("pointerdown", 300);
    r.event("pointermove", 260, 300, { elapsed: 40 });
    r.event("pointerup", 260, 300, { elapsed: pause });
    assert.equal(r.opened(), expected);
  }
});

test("pointer cancellation and a second finger cancel opening and hide feedback", () => {
  for (const cancel of [r => r.event("pointercancel", 180), r => r.event("lostpointercapture", 180), r => r.event("pointerdown", 150, 310, { pointerId: 2, isPrimary: false })]) {
    const r = reader();
    r.event("pointerdown", 300);
    r.event("pointermove", 180);
    cancel(r);
    r.event("pointerup", 180);
    assert.equal(r.opened(), 0);
    assert.ok(!r.hint.attrs.has("data-visible"));
  }
});

test("reversing below the threshold cancels an otherwise complete swipe", () => {
  const r = reader();
  r.event("pointerdown", 300);
  r.event("pointermove", 180);
  r.event("pointermove", 280);
  r.event("pointerup", 280);
  assert.equal(r.opened(), 0);
});

test("vertical and diagonal gestures retain native scrolling", () => {
  for (const [x, y] of [[290, 170], [200, 180], [200, 210]]) {
    const r = reader();
    r.event("pointerdown", 300);
    assert.ok(!r.event("pointermove", x, y).prevented);
    r.event("pointerup", x, y);
    assert.equal(r.opened(), 0);
  }
});

test("links, controls, editors and code blocks do not trigger original article navigation", () => {
  for (const kind of ["link", "button", "input", "editable", "code"]) {
    const r = reader();
    const target = r.target(kind);
    target.scrollWidth = 1000;
    r.event("pointerdown", 300, 300, { target });
    r.event("pointermove", 180, 300, { target });
    r.event("pointerup", 180, 300, { target });
    assert.equal(r.opened(), 0, kind);
    if (kind === "code") assert.equal(target.scrollLeft, 120);
  }
});

test("mouse, pen and trackpad cannot trigger the new action", () => {
  for (const pointerType of ["mouse", "pen"]) {
    const r = reader();
    r.event("pointerdown", 300, 300, { pointerType });
    r.event("pointermove", 150, 300, { pointerType });
    r.event("pointerup", 150, 300, { pointerType });
    assert.equal(r.opened(), 0);
  }
  const r = reader();
  r.event("wheel", 0, 0, { deltaX: 200, deltaY: 0 });
  assert.equal(r.opened(), 0);
});

test("missing URL, inactive reader and text selections disable opening", () => {
  for (const config of [{ hasUrl: false }, { enabled: false }, { selection: true }, { selectAfterMove: true }]) {
    const r = reader(config);
    if (config.selection) r.select(true);
    r.event("pointerdown", 300);
    r.event("pointermove", 180);
    if (config.selectAfterMove) r.select(true);
    r.event("pointerup", 180);
    assert.equal(r.opened(), 0);
    assert.ok(!r.hint.attrs.has("data-visible"));
  }
});

test("existing right-swipe return still follows the finger and returns", () => {
  const r = reader();
  r.event("pointerdown", 100);
  r.event("pointermove", 200);
  assert.equal(r.panel.style.transform, "translate3d(100px, 0, 0)");
  r.event("pointerup", 200);
  r.frames.shift()();
  assert.equal(r.returned(), 1);
  assert.equal(r.opened(), 0);
});

test("cleanup removes handlers and any in-progress external feedback", () => {
  const r = reader();
  r.event("pointerdown", 300);
  r.event("pointermove", 180);
  r.cleanup();
  assert.equal(r.viewport.handlers.size, 0);
  assert.ok(!r.hint.attrs.has("data-visible"));
});
