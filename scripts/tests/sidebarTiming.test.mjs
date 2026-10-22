import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the real Sidebar effects with a controllable drawer animation, rather than
// relying on elapsed timers or a browser's background-tab rendering policy.
const source = readFileSync(new URL("../../src/features/subscriptions/components/Sidebar.tsx", import.meta.url), "utf8");
function setup(mobile = true) {
  let hooks = [], cursor = 0, effects = [], dirty = false, frames = new Map(), nextFrame = 0;
  let finishClosing;
  const closing = { playState: "running", finished: new Promise(resolve => { finishClosing = () => { closing.playState = "finished"; resolve(); }; }) };
  const viewport = { scrollTop: 108, scrollHeight: 396, clientHeight: 180, getBoundingClientRect: () => ({ top: 0 }) };
  const feed = { dataset: { feedId: "feed7" }, offsetHeight: 36, getBoundingClientRect: () => ({ top: 216 - viewport.scrollTop }) };
  const row = { offsetHeight: 36, getBoundingClientRect: () => ({ top: 0 }) };
  const group = { dataset: { folderId: "folder" }, querySelector: selector => selector === ".sidebar-folder-row" ? row : viewport, querySelectorAll: () => [feed] };
  const area = { scrollTop: 0, scrollHeight: 500, clientHeight: 400, getBoundingClientRect: () => ({ top: 0 }), querySelectorAll: () => [group], getAnimations: () => [], addEventListener() {}, removeEventListener() {} };
  const drawer = { getAnimations: () => [closing] };
  const react = {
    useRef(value) { const i = cursor++; return hooks[i] ??= { current: value }; },
    useState(value) { const i = cursor++; hooks[i] ??= { value: typeof value === "function" ? value() : value }; return [hooks[i].value, next => { hooks[i].value = typeof next === "function" ? next(hooks[i].value) : next; dirty = true; }]; },
    useLayoutEffect(callback, deps) { const i = cursor++; const previous = hooks[i]; if (!previous || deps.some((value, j) => value !== previous.deps[j])) { hooks[i] = { deps, cleanup: previous?.cleanup }; effects.push(() => { hooks[i].cleanup?.(); hooks[i].cleanup = callback(); }); } },
  };
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const scroll = { secondRowScrollTop: (top, height, total, visible) => Math.min(Math.max(0, top - height), Math.max(0, total - visible)) };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => name === "react" ? react : name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : name === "./sidebarScroll" ? scroll : {},
    window: { matchMedia: query => ({ matches: query.includes("min-width") ? !mobile : false }) },
    performance: { now: () => 0 }, requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: id => frames.delete(id), Element: class {},
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
  return { render, viewport, finishClosing, select: () => render({ selectedFolderId: "folder", selectedFeedId: "feed7" }) };
}

test("mobile selection waits for the drawer animation to finish before positioning", async () => {
  const app = setup();
  app.select();
  assert.equal(app.viewport.scrollTop, 108);
  app.render({ open: false });
  assert.equal(app.viewport.scrollTop, 108);
  app.finishClosing();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.viewport.scrollTop, 180);
  app.viewport.scrollTop = 72;
  app.render({ open: true });
  assert.equal(app.viewport.scrollTop, 72, "ordinary reopen preserves manual scroll");
});

test("quick reopen settles pending selection and ignores stale closing completion", async () => {
  const app = setup();
  app.select();
  app.render({ open: false });
  app.render({ open: true });
  assert.equal(app.viewport.scrollTop, 180);
  app.viewport.scrollTop = 72;
  app.finishClosing();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.viewport.scrollTop, 72);
});

test("desktop placement does not wait for a drawer closing animation", () => {
  const app = setup(false);
  app.select();
  assert.equal(app.viewport.scrollTop, 180);
});
