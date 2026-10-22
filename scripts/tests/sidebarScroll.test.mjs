import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../src/features/subscriptions/components/sidebarScroll.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const { secondRowScrollTop, scrollbarGeometry } = exports;

test("selected feeds retain one preceding row, without blank space at either boundary", () => {
  assert.equal(secondRowScrollTop(0, 36, 396, 180), 0);
  assert.equal(secondRowScrollTop(216, 36, 396, 180), 180); // seventh item is second
  assert.equal(secondRowScrollTop(360, 36, 396, 180), 216); // last item stays at bottom
  assert.equal(secondRowScrollTop(36, 36, 72, 180), 0);
});

test("scrollbar follows visible proportion and reaches both ends", () => {
  for (const count of [6, 11, 100]) {
    const top = scrollbarGeometry(180, count * 36, 0);
    const bottom = scrollbarGeometry(180, count * 36, count * 36 - 180);
    assert.equal(top.thumbTop, 0);
    assert.equal(bottom.thumbTop + bottom.thumbHeight, 180);
    assert.ok(top.thumbHeight >= 24);
    assert.equal(scrollbarGeometry(180, count * 36, top.maxScroll / 2).thumbTop, top.travel / 2);
  }
  assert.ok(scrollbarGeometry(180, 216, 0).thumbHeight > scrollbarGeometry(180, 720, 0).thumbHeight);
});

test("five or fewer feeds have no scroll range, including zero-height empty lists", () => {
  for (const [viewport, content] of [[180, 180], [72, 72], [0, 0]]) {
    const geometry = scrollbarGeometry(viewport, content, 0);
    assert.equal(geometry.maxScroll, 0);
    assert.equal(geometry.thumbTop, 0);
    assert.equal(geometry.travel, 0);
    assert.ok(Number.isFinite(geometry.thumbHeight));
  }
});
