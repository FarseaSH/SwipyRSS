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
  const captures = [];
  let captureOwner = null;
  let pendingCapture = null;
  class Element {
    constructor(kind) {
      this.kind = kind;
      this.parentElement = null;
      this.overflowX = kind === "code" || kind === "scroller" ? "auto" : "visible";
      this.attrs = new Set();
      this.style = { setProperty() {} };
      this.classList = { remove() {}, add() {} };
      this.scrollTop = 0;
      this._scrollLeft = 0;
      this.clientWidth = 390;
      this.clientHeight = 800;
      this.scrollWidth = 390;
      this.scrollHeight = 2400;
      this.handlers = new Map();
    }
    closest(selector) {
      const matches = this.kind === "link" ? selector.startsWith("a,")
        : this.kind === "code" ? selector.includes("[data-reader-horizontal-scroll]")
          : ["button", "input", "editable"].includes(this.kind);
      return matches ? this : this.parentElement?.closest(selector) ?? null;
    }
    contains(element) {
      for (let node = element; node; node = node.parentElement) if (node === this) return true;
      return false;
    }
    get scrollLeft() { return this._scrollLeft; }
    set scrollLeft(value) { this._scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, value)); }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    removeEventListener(type) { this.handlers.delete(type); }
    setPointerCapture() { pendingCapture = this; }
    hasPointerCapture() { return pendingCapture === this; }
    toggleAttribute(name, value) { if (value) this.attrs.add(name); else this.attrs.delete(name); }
    removeAttribute(name) { this.attrs.delete(name); }
  }
  const viewport = new Element();
  const panel = new Element();
  const effects = [];
  const exports = {};
  const browser = {
    getSelection: () => ({ isCollapsed: !selected }),
    getComputedStyle: element => ({ overflowX: element.overflowX }),
    clearTimeout() {},
    setTimeout: () => 1,
    cancelAnimationFrame() {},
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
  };
  vm.runInNewContext(compiled, {
    exports, Element, HTMLElement: Element, performance: { now: () => now }, window: browser,
    requestAnimationFrame: browser.requestAnimationFrame, cancelAnimationFrame() {},
    require: () => ({
      useCallback: fn => fn, useEffect: fn => effects.push(fn),
      useRef: current => ({ current }), useState: value => [value, () => {}],
    }),
  });
  const ref = current => ({ current });
  exports.useReaderInteraction(ref(viewport), ref(new Element()), ref(new Element()), ref(panel),
    () => { returned += 1; }, undefined, enabled, false,
    hasUrl ? () => { opened += 1; } : undefined);
  cleanup = effects[0]();
  const target = new Element();
  target.parentElement = viewport;
  function event(type, x, y = 300, options = {}) {
    now += options.elapsed ?? 200;
    const e = { type, pointerType: "touch", pointerId: 1, isPrimary: true, detail: 1,
      clientX: x, clientY: y, target, currentTarget: viewport,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...options };
    // Touch starts implicit capture on the hit element. Explicit transfer is processed
    // before the next pointer event and lostpointercapture bubbles from the old owner.
    if (type === "pointerdown" && e.isPrimary) pendingCapture = e.target;
    if (["pointermove", "pointerup", "pointercancel"].includes(type) && captureOwner !== pendingCapture) {
      if (captureOwner) {
        captures.push(captureOwner);
        viewport.handlers.get("lostpointercapture")?.({ ...e, type: "lostpointercapture", target: captureOwner });
      }
      captureOwner = pendingCapture;
    }
    if (type === "lostpointercapture" && e.target === viewport) {
      captureOwner = pendingCapture = null;
    }
    viewport.handlers.get(type)?.(e);
    if (type === "pointerup" || type === "pointercancel") captureOwner = pendingCapture = null;
    return e;
  }
  return { event, panel, viewport, captures, target: (kind, parent = viewport) => {
    const element = new Element(kind); element.parentElement = parent; return element;
  }, opened: () => opened, returned: () => returned, select: value => { selected = value; },
    cleanup, frames };

}

test("touch swipe opens synchronously on release and never moves the panel", () => {
  const r = reader();
  r.event("pointerdown", 300);
  r.event("pointermove", 250);
  r.event("pointermove", 200);
  assert.equal(r.panel.style.transform, undefined);
  assert.equal(r.opened(), 0);
  r.event("pointerup", 200);
  assert.equal(r.opened(), 1);
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

test("pointer cancellation and a second finger cancel opening", () => {
  for (const cancel of [r => r.event("pointercancel", 180), r => r.event("lostpointercapture", 180, 300, { target: r.viewport }), r => r.event("pointerdown", 150, 310, { pointerId: 2, isPrimary: false })]) {
    const r = reader();
    r.event("pointerdown", 300);
    r.event("pointermove", 180);
    cancel(r);
    r.event("pointerup", 180);
    assert.equal(r.opened(), 0);
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

test("controls, editors and overflowing code blocks do not trigger navigation", () => {
  for (const kind of ["button", "input", "editable", "code"]) {
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

test("cleanup removes handlers", () => {
  const r = reader();
  r.event("pointerdown", 300);
  r.event("pointermove", 180);
  r.cleanup();
  assert.equal(r.viewport.handlers.size, 0);
});

test("implicit capture transfer from a paragraph or image does not cancel either swipe", () => {
  for (const kind of ["paragraph", "image"]) for (const direction of [-1, 1]) {
    const r = reader();
    const target = r.target(kind);
    r.event("pointerdown", 200, 300, { target });
    r.event("pointermove", 200 + direction * 20, 300, { target });
    r.event("pointermove", 200 + direction * 110, 300, { target });
    assert.ok(r.captures.includes(target), "simulate descendant lostpointercapture during transfer");
    r.event("pointerup", 200 + direction * 110, 300, { target });
    while (r.frames.length) r.frames.shift()();
    assert.equal(r.opened(), direction < 0 ? 1 : 0, kind);
    assert.equal(r.returned(), direction > 0 ? 1 : 0, kind);
  }
});

test("links, linked images and short code support both navigation directions", () => {
  for (const kind of ["link", "linked-image", "code"]) for (const direction of [-1, 1]) {
    const r = reader();
    const target = kind === "linked-image" ? r.target("image", r.target("link")) : r.target(kind);
    r.event("pointerdown", 200, 300, { target });
    r.event("pointermove", 200 + direction * 110, 300, { target });
    r.event("pointerup", 200 + direction * 110, 300, { target });
    while (r.frames.length) r.frames.shift()();
    assert.equal(r.opened(), direction < 0 ? 1 : 0, kind);
    assert.equal(r.returned(), direction > 0 ? 1 : 0, kind);
    const click = r.event("click", 200 + direction * 110, 300, { target });
    assert.ok(click.prevented && click.stopped, "the swipe must not also activate the content link");
  }
});

test("ordinary link taps, keyboard activation and fresh taps after a swipe still work", () => {
  const r = reader();
  const target = r.target("link");
  r.event("pointerdown", 300, 300, { target });
  r.event("pointerup", 300, 300, { target });
  assert.ok(!r.event("click", 300, 300, { target }).prevented);
  r.event("pointerdown", 300, 300, { target });
  r.event("pointermove", 180, 300, { target });
  r.event("pointerup", 180, 300, { target });
  assert.ok(!r.event("click", 0, 0, { target, detail: 0, pointerType: "", elapsed: 1 }).prevented);
  r.event("pointerdown", 300, 300, { target, elapsed: 1 });
  r.event("pointerup", 300, 300, { target, elapsed: 1 });
  assert.ok(!r.event("click", 300, 300, { target, elapsed: 1 }).prevented);
});

test("horizontal containers retain the whole gesture at either scroll boundary", () => {
  for (const kind of ["code", "scroller"]) for (const direction of [-1, 1]) {
    const r = reader();
    const container = r.target(kind);
    container.scrollWidth = 1000;
    container.scrollLeft = direction < 0 ? 610 : 0;
    const child = r.target("image", container);
    r.event("pointerdown", 200, 300, { target: child });
    r.event("pointermove", 200 + direction * 20, 300, { target: child });
    r.event("pointermove", 200 + direction * 120, 300, { target: child });
    assert.equal(container.scrollLeft, direction < 0 ? 610 : 0);
    r.event("pointerup", 200 + direction * 120, 300, { target: child });
    assert.equal(r.opened(), 0);
    assert.equal(r.returned(), 0);
  }
});

test("overflow hidden images and containers with no horizontal overflow remain swipeable", () => {
  for (const config of [{ width: 1000, overflow: "hidden" }, { width: 390, overflow: "auto" }]) {
    const r = reader();
    const target = r.target("scroller");
    target.scrollWidth = config.width;
    target.overflowX = config.overflow;
    r.event("pointerdown", 300, 300, { target });
    r.event("pointermove", 180, 300, { target });
    r.event("pointerup", 180, 300, { target });
    assert.equal(r.opened(), 1);
  }
});

test("selection starting during a swipe cancels both directions", () => {
  for (const direction of [-1, 1]) {
    const r = reader();
    r.event("pointerdown", 200);
    r.event("pointermove", 200 + direction * 20);
    r.select(true);
    r.event("pointermove", 200 + direction * 120);
    r.event("pointerup", 200 + direction * 120);
    while (r.frames.length) r.frames.shift()();
    assert.equal(r.opened(), 0);
    assert.equal(r.returned(), 0);
  }
});

test("actual viewport capture loss cancels right-swipe return", () => {
  const r = reader();
  r.event("pointerdown", 100);
  r.event("pointermove", 220);
  r.event("lostpointercapture", 220, 300, { target: r.viewport });
  r.event("pointerup", 220);
  while (r.frames.length) r.frames.shift()();
  assert.equal(r.returned(), 0);
});

test("horizontal wheel scrolling in nested scroll containers does not return to the list", () => {
  const r = reader();
  const container = r.target("scroller");
  container.scrollWidth = 1000;
  const child = r.target("image", container);
  assert.ok(!r.event("wheel", 0, 0, { target: child, deltaX: -200, deltaY: 0 }).prevented);
  assert.equal(r.returned(), 0);
});
