import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import postcss from 'postcss';

// Deterministic hook host: run actual hook effects against DOM-shaped event targets
// and a virtual clock without browser/dependency downloads.
class Target {
  listeners = new Map();
  parent = null;
  body = false;
  focusVisible = false;
  attributes = new Map();
  classes = new Set();
  pressable = false;
  card = false;
  popover = false;
  classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value) };
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelectorAll() { return []; }
  addEventListener(type, fn) { const list = this.listeners.get(type) ?? new Set(); list.add(fn); this.listeners.set(type, list); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, data = {}) {
    const event = { target: this, detail: 1, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; }, ...data };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  contains(node) { for (; node; node = node.parent) if (node === this) return true; return false; }
  closest(selector) {
    for (let node = this; node; node = node.parent) {
      if (selector === '[data-list-toolbar-body]' && node.body) return node;
      if (selector.includes('.article-card') && node.card) return node;
      if (selector.includes('button') && node.pressable) return node;
      if (selector === '.mark-read-confirm-popover' && node.popover) return node;
      const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
      if (match && node.attributes.has(match[1]) && (match[2] === undefined || node.getAttribute(match[1]) === match[2])) return node;
    }
    return null;
  }
  matches(selector) { return selector === ':focus-visible' && this.focusVisible; }
}
function host(file, exportName, initialArgs) {
  let slots = [], index = 0, dirty = false, pending = [], now = 0, nextTimer = 0;
  const timers = new Map();
  const document = new Target(); document.hidden = false; document.activeElement = null;
  const window = new Target();
  window.setTimeout = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; };
  window.clearTimeout = id => timers.delete(id);
  window.requestAnimationFrame = fn => window.setTimeout(fn, 16);
  window.cancelAnimationFrame = window.clearTimeout;
  const equal = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState(value) { const i = index++; slots[i] ??= { value }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(value) { const i = index++; slots[i] ??= { current: value }; return slots[i]; },
    useCallback(fn, deps) { const i = index++; if (!equal(slots[i]?.deps, deps)) slots[i] = { deps, value: fn }; return slots[i].value; },
    useEffect(fn, deps) { const i = index++; if (!equal(slots[i]?.deps, deps)) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const exports = {};
  const sourcePath = file === 'useTouchPressFeedback' ? '../../src/app/hooks/useTouchPressFeedback.ts' : `../../src/features/article-list/hooks/${file}.ts`;
  const js = ts.transpileModule(readFileSync(new URL(sourcePath, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const helperExports = {};
  const helper = ts.transpileModule(readFileSync(new URL('../../src/components/touchPressFeedback.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(helper, { exports: helperExports, Element: Target });
  vm.runInNewContext(js, { exports, require: name => name === 'react' ? react : helperExports, window, document, Element: Target, Node: Target });
  let args = initialArgs, result;
  const render = () => { let iterations = 0; do { dirty = false; index = 0; pending = []; result = exports[exportName](...args); for (const effect of pending) effect(); assert.ok(++iterations < 20, 'effects settle'); } while (dirty); return result; };
  render();
  return { document, window, get needsRender() { return dirty; }, get result() { return result; }, render, update(next) { args = next; render(); }, advance(ms) { const end = now + ms; for (;;) { const candidate = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0]; if (!candidate) break; now = candidate[1].at; timers.delete(candidate[0]); candidate[1].fn(); render(); } now = end; }, unmount() { for (const slot of slots) slot?.cleanup?.(); }, timers };
}
function clock() {
  const toolbar = new Target(); const ref = { current: toolbar }; let collapsed = 0;
  const collapse = () => collapsed++;
  const h = host('useListToolbarAutoCollapse', 'useListToolbarAutoCollapse', [ref, false, false, collapse]);
  return { h, toolbar, ref, collapse, get collapsed() { return collapsed; }, enable(paused = false) { h.update([ref, true, paused, collapse]); }, disable() { h.update([ref, false, false, collapse]); } };
}
test('four second timeout and activity restart, with cleanup on inactive/unmount', () => {
  const c = clock(); c.h.advance(10000); assert.equal(c.collapsed, 0);
  c.enable(); c.h.advance(3000); c.h.result.bumpActivity(); c.h.render();
  c.h.advance(3999); assert.equal(c.collapsed, 0); c.h.advance(1); assert.equal(c.collapsed, 1);
  c.disable(); c.enable(); c.h.advance(2000); c.disable(); c.h.advance(10000); assert.equal(c.collapsed, 1);
  c.enable(); c.h.unmount(); c.h.advance(10000); assert.equal(c.collapsed, 1);
});
test('touch and activity do not request list renders, collapsed or expanded', () => {
  const c = clock();
  for (const expanded of [false, true]) {
    if (expanded) c.enable();
    c.toolbar.emit('pointerdown', { pointerType: 'touch' });
    assert.equal(c.h.needsRender, false, 'press must not render the article list');
    c.h.window.emit('pointerup');
    assert.equal(c.h.needsRender, false, 'release must not render the article list');
    c.toolbar.emit('click');
    c.h.result.bumpActivity();
    assert.equal(c.h.needsRender, false, 'restarting the timeout must not render the article list');
  }
  c.h.advance(3999); assert.equal(c.collapsed, 0);
  c.h.advance(1); assert.equal(c.collapsed, 1);
});
test('waking during a press waits a full interval after release', () => {
  const c = clock();
  c.toolbar.emit('pointerdown', { pointerType: 'touch' });
  c.enable(); c.h.advance(12000); assert.equal(c.collapsed, 0);
  c.h.window.emit('pointerup'); c.h.advance(3999); assert.equal(c.collapsed, 0);
  c.h.advance(1); assert.equal(c.collapsed, 1);
});
test('mouse hover pauses beyond ten seconds; leaving restarts full interval', () => {
  const c = clock(); c.toolbar.emit('pointerenter', { pointerType: 'mouse' }); c.h.render(); c.enable();
  c.h.advance(12000); assert.equal(c.collapsed, 0);
  c.toolbar.emit('pointerleave', { pointerType: 'mouse' }); c.h.render(); c.h.advance(3999); assert.equal(c.collapsed, 0); c.h.advance(1); assert.equal(c.collapsed, 1);
});
test('touch does not retain hover; long press pauses until release', () => {
  const c = clock(); c.enable(); c.toolbar.emit('pointerenter', { pointerType: 'touch' }); c.h.render();
  c.toolbar.emit('pointerdown', { pointerType: 'touch' }); c.h.render(); c.h.advance(12000); assert.equal(c.collapsed, 0);
  c.h.window.emit('pointerup'); c.h.render(); c.h.advance(4000); assert.equal(c.collapsed, 1);
});
test('sidebar, loading, reader and confirmation pause restart without stale timeout', () => {
  const c = clock(); c.enable(); c.h.advance(3000); c.enable(true); c.h.advance(12000); assert.equal(c.collapsed, 0);
  c.enable(); c.h.advance(3999); assert.equal(c.collapsed, 0); c.h.advance(1); assert.equal(c.collapsed, 1);
});
test('keyboard focus and hidden document pause countdown', () => {
  const c = clock(); c.enable(); const button = new Target(); button.parent = c.toolbar; button.focusVisible = true; c.h.document.activeElement = button;
  c.toolbar.emit('focusin'); c.h.render(); c.h.advance(10000); assert.equal(c.collapsed, 0);
  c.h.document.activeElement = null; c.toolbar.emit('focusout'); c.h.render(); c.h.advance(16);
  c.h.document.hidden = true; c.h.document.emit('visibilitychange'); c.h.render(); c.h.advance(10000); assert.equal(c.collapsed, 0);
  c.h.document.hidden = false; c.h.document.emit('visibilitychange'); c.h.render(); c.h.advance(4000); assert.equal(c.collapsed, 1);
});
function interactions() {
  const toolbar = new Target(), popover = new Target(), body = new Target(), item = new Target(), header = new Target(); body.body = true; item.parent = body; popover.parent = toolbar;
  let collapsed = 0, closed = 0;
  let options = { toolbarRef: { current: toolbar }, popoverRef: { current: popover }, enabled: true, expanded: true, confirmationOpen: false, submitting: false, collapse() { collapsed++; }, closeConfirmation() { closed++; } };
  const h = host('useListToolbarDismiss', 'useListToolbarDismiss', [options]);
  return { h, item, body, toolbar, popover, header, get collapsed() { return collapsed; }, get closed() { return closed; }, update(next) { options = { ...options, ...next }; h.update([options]); }, click(target) { return h.document.emit('click', { target }); } };
}
test('first Item/internal control/empty body click is consumed, second click passes', () => {
  const c = interactions(); assert.equal(c.click(c.item).prevented, true); assert.equal(c.collapsed, 1);
  c.update({ expanded: false }); assert.equal(c.click(c.item).prevented, undefined);
  c.update({ expanded: true }); assert.equal(c.click(c.body).prevented, true);
  const star = new Target(); star.parent = c.item; assert.equal(c.click(star).prevented, true);
  assert.equal(c.click(c.header).prevented, undefined); assert.equal(c.click(c.toolbar).prevented, undefined);
});
test('popup outside click only closes popup; header, Item and toolbar cannot leak actions', () => {
  const c = interactions(); c.update({ confirmationOpen: true });
  for (const target of [c.item, c.header, c.toolbar]) assert.equal(c.click(target).prevented, true);
  assert.equal(c.closed, 3); assert.equal(c.collapsed, 0); assert.equal(c.click(c.popover).prevented, undefined);
  c.update({ submitting: true }); c.click(c.item); assert.equal(c.closed, 3);
});
test('horizontal swipe preserves state; vertical swipe collapses without cancelling pointer events', () => {
  const c = interactions(); const down = c.h.document.emit('pointerdown', { target: c.item, pointerId: 1, clientX: 0, clientY: 0 });
  c.h.document.emit('pointermove', { pointerId: 1, clientX: 100, clientY: 2 }); assert.equal(c.collapsed, 0); assert.equal(down.prevented, undefined);
  assert.equal(c.click(c.item).prevented, true); assert.equal(c.collapsed, 0);
  c.h.document.emit('pointerdown', { target: c.item, pointerId: 2, clientX: 0, clientY: 0 });
  const move = c.h.document.emit('pointermove', { pointerId: 2, clientX: 2, clientY: 100 }); assert.equal(c.collapsed, 1); assert.equal(move.prevented, undefined);
});
test('vertical wheel closes confirmation and collapses; horizontal wheel is untouched', () => {
  const c = interactions(); c.update({ confirmationOpen: true });
  c.h.document.emit('wheel', { target: c.item, deltaX: 80, deltaY: 2 }); assert.equal(c.closed, 0); assert.equal(c.collapsed, 0);
  c.h.document.emit('wheel', { target: c.item, deltaX: 0, deltaY: 80 }); assert.equal(c.closed, 1); assert.equal(c.collapsed, 1);
});
test('disabled hook leaves bottom, reader and sidebar surfaces unchanged', () => {
  const c = interactions(); c.update({ enabled: false }); assert.equal(c.click(c.item).prevented, undefined); assert.equal(c.collapsed, 0);
});

test('consumed touch skips button feedback and keeps suppression after collapse until next press', () => {
  const h = host('useTouchPressFeedback', 'useTouchPressFeedback', []);
  const body = new Target(); body.setAttribute('data-list-feedback-suppressed', 'true');
  const star = new Target(); star.pressable = true; star.parent = body;
  const pointer = { target: star, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 0, clientY: 0 };
  h.document.emit('pointerdown', pointer);
  assert.equal(star.classes.has('touch-pressed'), false);
  assert.equal(star.attributes.has('data-touch-feedback-suppressed'), true);
  body.removeAttribute('data-list-feedback-suppressed');
  h.document.emit('pointerup', pointer); h.advance(180);
  assert.equal(star.classes.has('touch-pressed'), false);
  assert.equal(star.attributes.has('data-touch-feedback-suppressed'), true);
  h.document.emit('pointerdown', { ...pointer, pointerId: 2 });
  assert.equal(star.attributes.has('data-touch-feedback-suppressed'), false);
  assert.equal(star.classes.has('touch-pressed'), true);
  h.document.emit('pointerup', { ...pointer, pointerId: 2 }); h.advance(180);
  assert.equal(star.classes.has('touch-pressed'), false);
});
test('confirmation outside press is silent; inside submit and ordinary Header retain feedback', () => {
  const h = host('useTouchPressFeedback', 'useTouchPressFeedback', []);
  const page = new Target(); page.setAttribute('data-list-confirmation-open', 'true');
  const header = new Target(); header.parent = page; header.pressable = true;
  const popover = new Target(); popover.parent = page; popover.popover = true;
  const submit = new Target(); submit.parent = popover; submit.pressable = true;
  const down = target => h.document.emit('pointerdown', { target, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 });
  down(header); assert.equal(header.classes.has('touch-pressed'), false);
  down(submit); assert.equal(submit.classes.has('touch-pressed'), true);
  page.removeAttribute('data-list-confirmation-open'); down(header);
  assert.equal(header.classes.has('touch-pressed'), true);
});

test('all desktop Item hover selectors, including generic icons and separators, respect feedback gate', () => {
  const css = postcss.parse(readFileSync(new URL('../../src/styles/index.css', import.meta.url), 'utf8'));
  let covered = 0;
  css.walkRules(rule => {
    for (const selector of rule.selector.split(',')) {
      if (!selector.includes(':hover')) continue;
      if (/\.(?:article-card|article-read-button|article-star-button|article-source-link|article-end|icon-button)\b/.test(selector)) {
        assert.ok(selector.includes(':where(:not([data-list-feedback-suppressed="true"] *))'), `ungated hover: ${selector}`);
        covered++;
      } else {
        assert.ok(!selector.includes('data-list-feedback-suppressed'), `unrelated hover altered: ${selector}`);
      }
    }
  });
  assert.ok(covered >= 15, 'card, separator, read, star, source, end and generic icon hover rules checked');
});
