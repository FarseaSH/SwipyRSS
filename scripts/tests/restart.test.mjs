import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Exercise the actual callbacks with deferred writes and a controlled browser boundary.
const app = ts.createSourceFile("App.tsx", readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["trackWrite", "restartApp"].includes(node.name.getText(app))) {
    callbacks.set(node.name.getText(app), node.initializer.arguments[0].getText(app));
  }
  ts.forEachChild(node, visit);
}
visit(app);
function scenario(historyState = null) {
  const pendingWritesRef = { current: new Set() };
  const events = [];
  const history = { state: historyState, replaceState(state, ...args) { this.state = state; events.push(["history", args]); } };
  const exports = {};
  const source = [...callbacks].map(([name, body]) => `export const ${name} = ${body};`).join("\n");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, pendingWritesRef, restartRequestedRef: { current: false },
    setRestarting: (value) => events.push(["restarting", value]),
    window: { history, location: { reload: () => events.push(["reload"]) } },
  });
  return { ...exports, pendingWritesRef, events, history };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("restart waits for every submitted write, ignores repeated activation, and retains unrelated history", async () => {
  const s = scenario({ __swipyrssReader: { session: "old", articleId: "one" }, unrelated: "keep" });
  const first = deferred(), second = deferred();
  const a = s.trackWrite(first.promise), b = s.trackWrite(second.promise);
  const restart = s.restartApp();
  await s.restartApp();
  assert.deepEqual(s.events, [["restarting", true]]);
  first.resolve("saved");
  assert.equal(await a, "saved");
  assert.equal(s.events.some(([name]) => name === "reload"), false);
  second.resolve();
  await b;
  await restart;
  assert.equal(s.pendingWritesRef.current.size, 0);
  assert.deepEqual({ ...s.history.state }, { unrelated: "keep" });
  assert.deepEqual(s.events.map(([name]) => name), ["restarting", "history", "reload"]);
  assert.deepEqual(Array.from(s.events[1][1]), [""]); // No URL replacement or navigation.
});

test("a failed write keeps its original rejection and does not block restart", async () => {
  const s = scenario();
  const write = deferred();
  const error = new Error("write failed");
  const caught = s.trackWrite(write.promise).catch((reason) => reason);
  const restart = s.restartApp();
  write.reject(error);
  assert.equal(await caught, error);
  await restart;
  assert.equal(s.pendingWritesRef.current.size, 0);
  assert.deepEqual(s.events, [["restarting", true], ["reload"]]);
});

test("restart with no pending writes reloads immediately without rewriting empty history", async () => {
  const s = scenario();
  await s.restartApp();
  assert.deepEqual(s.events, [["restarting", true], ["reload"]]);
});
