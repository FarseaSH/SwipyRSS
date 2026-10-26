import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real Sidebar effects with a controllable drawer animation, rather than
// relying on elapsed timers or a browser's background-tab rendering policy.
const source = readFileSync(new URL("../../src/features/subscriptions/components/Sidebar.tsx", import.meta.url), "utf8");
function setup(mobile = true, folderTop = 0) {
  let hooks = [], cursor = 0, effects = [], dirty = false, frames = new Map(), nextFrame = 0;
  let finishClosing;
  let now = 0;
  let treeAnimations = [];
  const listeners = new Map();
  class TreeElement { matches() { return true; } }
  const closing = { playState: "running", finished: new Promise(resolve => { finishClosing = () => { closing.playState = "finished"; resolve(); }; }) };
  const viewport = { scrollTop: 0, scrollHeight: 396, clientHeight: 180, getBoundingClientRect: () => ({ top: 0 }) };
  const feed = { dataset: { feedId: "feed7" }, offsetHeight: 36, getBoundingClientRect: () => ({ top: 216 - viewport.scrollTop }) };
  const row = { offsetHeight: 36, getBoundingClientRect: () => ({ top: folderTop - area.scrollTop, height: 36 }) };
  const group = { dataset: { folderId: "folder" }, getBoundingClientRect: () => ({ top: folderTop - area.scrollTop }), previousElementSibling: { getBoundingClientRect: () => ({ bottom: folderTop - area.scrollTop - 4 }) }, querySelector: selector => selector === ".sidebar-folder-row" ? row : viewport, querySelectorAll: () => [feed] };
  const area = { scrollTop: 0, scrollHeight: 500, clientHeight: 400, getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => [group], getAnimations: () => treeAnimations, addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
  const drawer = { getAnimations: () => [closing] };
  const react = {
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState(value) { const i = cursor++; hooks[i] ??= { value: typeof value === "function" ? value() : value }; return [hooks[i].value, next => { hooks[i].value = typeof next === "function" ? next(hooks[i].value) : next; dirty = true; }]; },
    useLayoutEffect(callback, deps) { const i = cursor++; const previous = hooks[i]; if (!previous || deps.some((value, j) => value !== previous.deps[j])) { hooks[i] = { deps, cleanup: previous?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = callback(); }); } },
  };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const scrollExports = {};
  const scrollSource = readFileSync(new URL("../../src/features/subscriptions/components/sidebarScroll.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(scrollSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: scrollExports });
  const scroll = scrollExports;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => name === "react" ? react : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : name === "./sidebarScroll" ? scroll : {},
    window: { matchMedia: query => ({ matches: query.includes("min-width") ? !mobile : false }) },
    performance: { now: () => now }, requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id), Element: TreeElement,
  });
  const props = { drawerRef: { current: drawer }, open: true, mode: "all", feeds: [], folders: [{ id: "folder", name: "Folder", feedIds: ["feed7"] }], selectedFolderId: null, selectedFeedId: null, starredSelected: false, settingsActive: false, feedUnreadCounts: {}, onClose() {} };
  function render(changes = {}) {
    Object.assign(props, changes);
    do {
      dirty = false; cursor = 0; effects = [];
      exports.Sidebar(props);
      // scrollAreaRef is the second hook, after expandedFolderIds.
      hooks[1].current = area;
      for (const effect of effects) effect();
    } while (dirty);
  }
  render();
  return { render, viewport, area, finishClosing,
    collapse() { hooks[0].value = new Set(); render(); },
    advance(time) { now += time; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); },
    interrupt() { listeners.get("wheel")?.(); },
    animateTree() {
      let finish;
      const animation = {
        currentTime: 0, playState: "running",
        pause() { this.playState = "paused"; }, play() { this.playState = "running"; },
        finish() { this.currentTime = 200; this.playState = "finished"; finish(); },
        effect: { target: new TreeElement(), getComputedTiming: () => ({ endTime: 200 }) },
        finished: new Promise(resolve => { finish = resolve; }),
      };
      treeAnimations = [animation];
      const complete = () => { treeAnimations = []; animation.finish(); };
      complete.animation = animation;
      return complete;
    },
    select: () => render({ selectedFolderId: "folder", selectedFeedId: "feed7" }) };
}

test("mobile selection waits for the drawer animation to finish before positioning", async () => {
  const app = setup();
  app.select();
  assert.equal(app.viewport.scrollTop, 0);
  app.render({ open: false });
  assert.equal(app.viewport.scrollTop, 0);
  app.finishClosing();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.viewport.scrollTop, 180);
  app.viewport.scrollTop = 46;
  app.render({ open: true });
  assert.equal(app.viewport.scrollTop, 46, "ordinary reopen preserves manual scroll");
});

test("quick reopen settles pending selection and ignores stale closing completion", async () => {
  const app = setup();
  app.select();
  app.render({ open: false });
  app.render({ open: true });
  assert.equal(app.viewport.scrollTop, 180);
  app.viewport.scrollTop = 46;
  app.finishClosing();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.viewport.scrollTop, 46);
});

test("desktop placement does not wait for a drawer closing animation", () => {
  const app = setup(false);
  app.select();
  assert.equal(app.viewport.scrollTop, 0, "scroll starts from the current position");
  app.advance(60);
  assert.ok(app.viewport.scrollTop > 0 && app.viewport.scrollTop < 180);
  app.advance(60);
  assert.ok(app.viewport.scrollTop < 180, "longer travel is not forced to finish in 120ms");
  app.advance(1000);
  assert.equal(app.viewport.scrollTop, 180);
});


test("height transitions and second-row scroll share one frame clock without waiting", () => {
  const app = setup(false);
  const tree = app.animateTree();
  app.select();
  assert.equal(tree.animation.playState, "paused");
  assert.equal(tree.animation.currentTime, 0);
  app.advance(100);
  assert.ok(tree.animation.currentTime > 0 && tree.animation.currentTime < 200);
  assert.ok(app.viewport.scrollTop > 0 && app.viewport.scrollTop < 180);
  app.advance(1000);
  assert.equal(app.viewport.scrollTop, 180);
  assert.equal(tree.animation.playState, "finished");
});

test("manual scrolling cancels both pending stages and an active scroll", async () => {
  const app = setup(false);
  const finish = app.animateTree();
  app.select();
  app.interrupt();
  app.viewport.scrollTop = 42;
  finish();
  await new Promise(resolve => setImmediate(resolve));
  app.advance(500);
  assert.equal(app.viewport.scrollTop, 42);
  app.render({ selectedFeedId: null });
  app.select();
  app.advance(50);
  app.interrupt();
  app.viewport.scrollTop = 63;
  app.advance(500);
  assert.equal(app.viewport.scrollTop, 63);
});


test("quick mobile reopen completes expansion before placing a previously closed group", () => {
  const app = setup();
  app.collapse();
  app.select();
  app.render({ open: false });
  app.render({ open: true });
  assert.equal(app.viewport.scrollTop, 180);
});


test("selecting a visible Feed still smoothly aligns it on the second row", () => {
  const app = setup(false);
  app.viewport.scrollTop = 108;
  app.select();
  app.advance(500);
  assert.equal(app.viewport.scrollTop, 180);
});


test("manual input stops scrolling and releases the height transition from its current position", () => {
  const app = setup(false);
  const tree = app.animateTree();
  app.select();
  app.advance(100);
  const currentTime = tree.animation.currentTime;
  app.interrupt();
  assert.equal(tree.animation.playState, "running");
  assert.equal(tree.animation.currentTime, currentTime);
  app.viewport.scrollTop = 42;
  app.advance(1000);
  assert.equal(app.viewport.scrollTop, 42);
});


test("folder selection changes only the outer offset; Feed selection retains second-row placement", () => {
  const app = setup(false, 120);
  app.render({ selectedFolderId: "folder" });
  app.advance(1000);
  assert.equal(app.area.scrollTop, 57);
  app.select();
  app.advance(1000);
  assert.equal(app.area.scrollTop, 80);
  assert.equal(app.viewport.scrollTop, 180);
});
