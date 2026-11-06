import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the card's real event handlers without a DOM or layout effects.
const source = readFileSync(new URL("../../src/features/article-list/components/ArticleCard.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, {
  exports,
  require(name) {
    if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === "react") return { useState: (value) => [value, () => {}], useRef: (current) => ({ current }), useLayoutEffect: () => {} };
    return {};
  },
});

test("article clicks select the reader, background or foreground intent with Shift priority", () => {
  const opened = [];
  let suppressed = false;
  let read = 0;
  let starred = 0;
  const card = exports.ArticleCard({
    article: { id: "1", title: "Article", summaryText: "Summary" },
    active: true,
    highlightPhase: "idle",
    onOpen: (mode) => opened.push(mode),
    onToggleRead: () => { read += 1; },
    onToggleStar: () => { starred += 1; },
    suppressClick: () => suppressed,
  });
  for (const [modifiers, expected] of [
    [{}, "reader"],
    [{ ctrlKey: true }, "original-background"],
    [{ metaKey: true }, "original-background"],
    [{ shiftKey: true }, "original-foreground"],
    [{ ctrlKey: true, shiftKey: true }, "original-foreground"],
    [{ metaKey: true, shiftKey: true }, "original-foreground"],
  ]) {
    card.props.onClick({ target: { closest: () => null }, ...modifiers });
    assert.equal(opened.at(-1), expected);
  }
  const count = opened.length;
  card.props.onClick({ target: { closest: () => ({}) }, shiftKey: true });
  suppressed = true;
  card.props.onClick({ target: { closest: () => null }, shiftKey: true });
  assert.equal(opened.length, count);
  suppressed = false;
  const element = {};
  card.props.onKeyDown({ target: element, currentTarget: element, key: "Enter", preventDefault() {} });
  assert.equal(opened.at(-1), "reader");
  const visual = card.props.children[1];
  visual.props.readAction.props.onClick({ stopPropagation() {}, shiftKey: true });
  visual.props.starAction.props.onClick({ stopPropagation() {}, shiftKey: true });
  assert.equal(read, 1);
  assert.equal(starred, 1);
  assert.equal(opened.length, count + 1);
});
