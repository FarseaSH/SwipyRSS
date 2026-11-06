import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(source, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...globals });
  return exports;
}

const actions = compile(readFileSync(new URL("../../src/features/article-list/markReadAction.ts", import.meta.url), "utf8"));
const navigation = compile(readFileSync(new URL("../../src/features/article-list/bulkReadNavigation.ts", import.meta.url), "utf8"));
const { BackgroundReadQueue } = compile(readFileSync(new URL("../../src/features/article-list/BackgroundReadQueue.ts", import.meta.url), "utf8"));
test("toolbar defaults to Mark All and retains Read Above as an explicit action", () => {
  assert.equal(actions.getDefaultListToolbarReadAction(), "mark-all-read");
  assert.equal(actions.shouldMarkAboveRead(), false);
  assert.equal(actions.shouldMarkAboveRead("mark-all-read"), false);
  assert.equal(actions.shouldMarkAboveRead("mark-above-read"), true);
});

const app = ts.createSourceFile("App.tsx", readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
let advanceCallback;
let aboveCallback;
let backgroundCallback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "markCurrentListRead") {
    callback = node.initializer.arguments[0].getText(app);
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "advanceAfterRead") advanceCallback = node.initializer.arguments[0].getText(app);
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "markArticlesAboveRead") aboveCallback = node.initializer.arguments[0].getText(app);
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "startBackgroundRead") backgroundCallback = node.initializer.arguments[0].getText(app);
  ts.forEachChild(node, visit);
}
visit(app);
assert.ok(callback);

function scenario({ mode = "all", previewMode = false, scope = { kind: "reading-list" }, write, counts,
  setting = "off", nextTarget = { kind: "folder", id: "folder/next", name: "Next group" }, aboveSucceeded = true } = {}) {
  const original = [
    { id: "one", feedId: "feed/a", isRead: false, publishedAt: 1 },
    { id: "two", feedId: "feed/b", isRead: true, publishedAt: 2 },
    { id: "three", feedId: "feed/a", isRead: false, publishedAt: 3 },
  ];
  const state = { articles: structuredClone(original), selected: "three", continuation: "page-4", refresh: 0,
    sessions: 0, replacements: 0, requests: [], notifications: [], loading: false, loadingTransitions: [], navigations: [], global: 5, counts: { "feed/a": 4, "feed/b": 1 } };
  const pending = new Set();
  const set = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const ref = (current = 0) => ({ current });
  const globals = {
    previewMode, scope, mode, articles: state.articles, feedUnreadCounts: state.counts,
    bulkReadAutoAdvance: setting, nextListTarget: nextTarget, shouldAdvanceAfterRead: navigation.shouldAdvanceAfterRead,
    markAllReadScopeName: "Original list", accountKey: "account-a", accountKeyRef: ref("account-a"),
    articlesRef: { get current() { return state.articles; } }, backgroundReadQueue: new BackgroundReadQueue(),
    applyFeedUnreadDeltas: (current, deltas) => {
      const next = { ...current };
      for (const [feed, delta] of deltas) next[feed] = Math.max(0, (next[feed] ?? 0) + delta);
      return next;
    },
    viewRef: ref("list"),
    folders: [{ id: "folder/a", feedIds: ["feed/a"] }],
    requestSequenceRef: ref(), loadMoreRequestRef: ref(), loadMoreInFlightRef: ref(true),
    unreadMutationVersionRef: ref(), mutationSequenceRef: ref(), latestMutationRef: ref(new Map()),
    unreadRefreshSequenceRef: ref(), unreadRefreshRequestedAtRef: ref(),
    setArticles: set("articles"), setSelectedId: set("selected"), setContinuation: set("continuation"),
    setListRefreshKey: set("refresh"),
    setLoadingList: (value) => { state.loadingTransitions.push(value); state.loading = value; },
    setLoadingMore: set("loadingMore"),
    setReadingListUnreadCount: set("global"), setFeedUnreadCounts: set("counts"),
    beginReadingSession: () => state.sessions++,
    replaceArticleList: (items) => { state.replacements++; state.articles = items; },
    recordFeedsMarkedRead() {}, reconcileUnreadCounts: () => { state.reconciled = true; },
    trackWrite: async (promise) => { pending.add(promise); try { return await promise; } finally { pending.delete(promise); } },
    getStreamId: (value) => value.kind === "reading-list" ? "reading-list" : value.id,
    normalizeRssError: (error) => ({ message: error.message }), notify: (text) => state.notifications.push(text),
    Date: { now: () => 1000 },
    rssClient: {
      markStreamRead: async (request) => { state.requests.push(["write", { ...request }]); await write?.(globals); },
      editEntryStates: async (request) => {
        state.requests.push(["article-write", Array.from(request.articleIds)]);
        await write?.(globals);
        if (!aboveSucceeded) throw Error("上方文章标记已读失败");
        return { reauthenticated: false };
      },
      getStream: async (request) => { state.requests.push(["page", { ...request }]); return { items: [], continuation: "fresh-page" }; },
      refreshUnreadCounts: async () => {
        state.requests.push(["counts"]);
        if (counts) return counts();
        return { readingListUnreadCount: 0, feedUnreadCounts: { "feed/a": 0, "feed/b": 0 } };
      },
    },
    previewArticlesRef: ref(new Map([...structuredClone(original), { id: "unloaded", feedId: "feed/a", isRead: false }].map(article => [article.id, article]))),
    previewFolders: [], previewFeeds: [{ id: "feed/a" }, { id: "feed/b" }],
    articleMatchesPreviewScope: (article, target) => target.kind === "reading-list" || article.feedId === target.id,
    createPreviewFeedUnreadCounts: (feeds, all) => Object.fromEntries(feeds.map(feed => [feed.id, all.filter(article => article.feedId === feed.id && !article.isRead).length])),
  };
  globals.selectScope = (target) => { state.navigations.push({ ...target }); globals.requestSequenceRef.current++; };
  globals.commitArticleState = async (ids) => {
    state.requests.push(["article-write", Array.from(ids)]);
    await write?.(globals);
    return aboveSucceeded;
  };
  globals.advanceAfterRead = compile(`export const advanceAfterRead = ${advanceCallback}`, globals).advanceAfterRead;
  globals.startBackgroundRead = compile(`export const startBackgroundRead = ${backgroundCallback}`, globals).startBackgroundRead;
  globals.applyPreviewScope = () => {
    state.replacements++;
    state.articles = Array.from(globals.previewArticlesRef.current.values()).filter(article =>
      globals.articleMatchesPreviewScope(article, scope) && (mode === "all" || !article.isRead));
    return state.articles;
  };
  return { action: compile(`export const action = ${callback}`, globals).action,
    aboveAction: compile(`export const action = ${aboveCallback}`, globals).action, state, globals, original, pending,
    flush: async () => { await Promise.allSettled([...pending]); await Promise.resolve(); await Promise.resolve(); } };
}

test("All mode marks the entire selected scope without fetching or replacing pages", async () => {
  for (const scope of [{ kind: "reading-list" }, { kind: "feed", id: "feed/a" }, { kind: "folder", id: "folder/a" }, { kind: "starred", id: "starred" }]) {
    const { action, state, globals, original } = scenario({ scope });
    await action();
    assert.deepEqual(state.requests, [["write", { streamId: scope.id ?? "reading-list", beforeTimestampUsec: "1000000" }], ["counts"]]);
    assert.deepEqual(state.articles.map(article => article.id), original.map(article => article.id));
    assert.ok(state.articles.every(article => article.isRead));
    assert.equal(state.continuation, "page-4");
    assert.equal(state.selected, "three");
    assert.equal(state.refresh, 0);
    assert.equal(state.sessions, 0);
    assert.equal(state.replacements, 0);
    assert.equal(state.global, 0);
    assert.equal(globals.latestMutationRef.current.size, original.length);
    assert.equal(state.loading, false);
    assert.deepEqual(state.loadingTransitions, [], "All mode never shows the list loading overlay");
  }
});

test("All-mode preview updates unloaded entries while retaining visible pages and selection", async () => {
  const { action, state, globals } = scenario({ previewMode: true });
  await action();
  assert.equal(globals.previewArticlesRef.current.get("unloaded").isRead, true);
  assert.ok(state.articles.every(article => article.isRead));
  assert.equal(state.articles.length, 3);
  assert.equal(state.replacements, 0);
  assert.equal(state.refresh, 0);
  assert.equal(state.sessions, 0);
  assert.equal(state.selected, "three");
  assert.equal(state.continuation, "page-4");
  assert.equal(state.requests.length, 0);
});

test("Unread mode still fetches a fresh list and resets its session", async () => {
  for (const previewMode of [false, true]) {
    const { action, state } = scenario({ mode: "unread", previewMode });
    await action();
    assert.equal(state.articles.length, 0);
    assert.equal(state.replacements, 1);
    assert.equal(state.sessions, 1);
    assert.equal(state.refresh, 1);
    assert.equal(state.selected, null);
    if (!previewMode) {
      assert.deepEqual(state.requests[1], ["page", { streamId: "reading-list", unreadOnly: true }]);
      assert.deepEqual(state.loadingTransitions, [true, false]);
    }
  }
});

test("Failed bulk writes preserve All-mode article states, counts and pagination", async () => {
  const { action, state, original } = scenario({ write: async () => { throw Error("offline"); } });
  await assert.rejects(action(), /offline/);
  assert.deepEqual(state.articles, original);
  assert.equal(state.global, 5);
  assert.equal(state.continuation, "page-4");
  assert.equal(state.selected, "three");
  assert.equal(state.refresh, 0);
  assert.equal(state.loading, false);
  assert.deepEqual(state.loadingTransitions, []);
  assert.equal(state.requests.length, 1);
});

test("A counts refresh failure does not undo a successful write or reload All-mode articles", async () => {
  const { action, state } = scenario({ counts: async () => { throw Error("offline"); } });
  await action();
  assert.ok(state.articles.every(article => article.isRead));
  assert.equal(state.continuation, "page-4");
  assert.equal(state.replacements, 0);
  assert.equal(state.refresh, 0);
  assert.match(state.notifications.at(-1), /已全部标记为已读/);
});

test("A scope change during submission cannot overwrite the newly selected list", async () => {
  const { action, state, original } = scenario({ write: async (globals) => { globals.requestSequenceRef.current++; } });
  await action();
  assert.deepEqual(state.articles, original);
  assert.equal(state.reconciled, true);
  assert.equal(state.replacements, 0);
  assert.equal(state.requests.length, 1);
});

test("auto-advance policy distinguishes toolbar All, context Above and excluded actions", () => {
  for (const setting of ["off", "all", "above", "both"]) {
    assert.equal(navigation.shouldAdvanceAfterRead(setting, "all"), setting === "all" || setting === "both");
    assert.equal(navigation.shouldAdvanceAfterRead(setting, "context-above"), setting === "above" || setting === "both");
    assert.equal(navigation.shouldAdvanceAfterRead(setting, "feed-all"), false);
    assert.equal(navigation.shouldAdvanceAfterRead(setting, "toolbar-above"), false);
  }
});

test("preference persists on this device, defaults safely and tolerates unavailable storage", () => {
  let saved = null;
  const prefs = compile(readFileSync(new URL("../../src/features/article-list/bulkReadNavigation.ts", import.meta.url), "utf8"), {
    window: { localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } } },
  });
  assert.equal(prefs.loadBulkReadAutoAdvance(), "off");
  for (const setting of ["off", "all", "above", "both"]) {
    prefs.saveBulkReadAutoAdvance(setting);
    assert.equal(prefs.loadBulkReadAutoAdvance(), setting);
  }
  saved = "invalid";
  assert.equal(prefs.loadBulkReadAutoAdvance(), "off");
  const unavailable = compile(readFileSync(new URL("../../src/features/article-list/bulkReadNavigation.ts", import.meta.url), "utf8"), {
    window: { get localStorage() { throw Error("blocked"); } },
  });
  assert.equal(unavailable.loadBulkReadAutoAdvance(), "off");
  assert.doesNotThrow(() => unavailable.saveBulkReadAutoAdvance("both"));
});

test("successful All actions advance once and skip reloading the old unread scope", async () => {
  for (const previewMode of [false, true]) for (const mode of ["all", "unread"]) {
    const { action, state } = scenario({ setting: "all", mode, previewMode });
    await action();
    assert.deepEqual(state.navigations, [{ kind: "folder", id: "folder/next" }]);
    assert.equal(state.requests.some(([kind]) => kind === "page"), false);
    assert.equal(state.replacements, 0);
    assert.equal(state.sessions, 0);
  }
});

test("All actions honor separate preferences and retain the captured Feed destination", async () => {
  const aboveOnly = scenario({ setting: "above" });
  await aboveOnly.action();
  assert.deepEqual(aboveOnly.state.navigations, []);
  const captured = scenario({ setting: "both", nextTarget: { kind: "feed", id: "feed/next", name: "Next feed" },
    write: async (globals) => { globals.nextListTarget = { kind: "feed", id: "feed/reordered", name: "Reordered" }; } });
  await captured.action();
  assert.deepEqual(captured.state.navigations, [{ kind: "feed", id: "feed/next" }]);
});

test("no next target keeps the current list and does not wrap", async () => {
  const { action, state } = scenario({ setting: "both", nextTarget: null });
  await action();
  assert.deepEqual(state.navigations, []);
  assert.equal(state.continuation, "page-4");
  assert.match(state.notifications.at(-1), /最后一个/);
  const unread = scenario({ setting: "both", nextTarget: null, mode: "unread" });
  await unread.action();
  assert.deepEqual(unread.state.navigations, []);
  assert.equal(unread.state.replacements, 1);
  assert.equal(unread.state.requests.some(([kind]) => kind === "page"), true);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("All advances before the write finishes and tracks the pending write for restart", async () => {
  const gate = deferred();
  const s = scenario({ setting: "both", write: () => gate.promise });
  await s.action();
  assert.equal(s.state.navigations.length, 1);
  assert.equal(s.pending.size, 1);
  assert.equal(s.state.requests.some(([kind]) => kind === "page"), false);
  assert.deepEqual(s.state.loadingTransitions, []);
  assert.ok(s.state.articles.every(article => article.isRead));
  // Moving elsewhere while the write is pending cannot cause a second navigation on completion.
  s.globals.requestSequenceRef.current++;
  gate.resolve();
  await s.flush();
  assert.equal(s.pending.size, 0);
  assert.equal(s.state.navigations.length, 1);
  assert.equal(s.globals.backgroundReadQueue.getSnapshot().length, 0);
});

test("background failure rolls back, stays on the new list, and retries the frozen request only", async () => {
  let fail = true;
  const s = scenario({ setting: "both", write: async () => { if (fail) throw Error("offline"); } });
  await s.action();
  await s.flush();
  assert.equal(s.state.navigations.length, 1);
  assert.deepEqual(structuredClone(s.state.articles), s.original);
  assert.equal(s.state.global, 5);
  const [failure] = s.globals.backgroundReadQueue.getSnapshot();
  assert.equal(failure.name, "Original list");
  assert.equal(failure.retrying, false);
  fail = false;
  s.globals.Date.now = () => 9000;
  s.globals.backgroundReadQueue.retry(failure.id);
  await s.flush();
  assert.equal(s.state.navigations.length, 1);
  assert.equal(s.globals.backgroundReadQueue.getSnapshot().length, 0);
  const writes = s.state.requests.filter(([kind]) => kind === "write");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1], "retry preserves the original stream and confirmation timestamp");
});

test("background rollback preserves newer edits and never replaces the destination list", async () => {
  const gate = deferred();
  const s = scenario({ setting: "all", write: () => gate.promise });
  await s.action();
  s.globals.latestMutationRef.current.set("read:one", 999);
  s.state.articles = [{ ...s.state.articles[0], title: "Newer edit", isRead: true },
    { id: "destination", feedId: "feed/new", isRead: false }];
  gate.reject(Error("offline"));
  await s.flush();
  assert.deepEqual(s.state.articles.map(article => article.id), ["one", "destination"]);
  assert.equal(s.state.articles[0].isRead, true);
  assert.equal(s.state.articles[0].title, "Newer edit");
  assert.equal(s.state.articles[1].isRead, false);
  assert.equal(s.state.replacements, 0);
  assert.equal(s.state.navigations.length, 1);
});

test("old-account results and retries cannot modify or submit using a different account", async () => {
  const gate = deferred();
  const s = scenario({ setting: "all", write: () => gate.promise });
  await s.action();
  s.globals.accountKeyRef.current = "account-b";
  s.state.articles = [{ id: "one", feedId: "feed/new", isRead: true }];
  s.state.global = 99;
  gate.reject(Error("offline"));
  await s.flush();
  assert.equal(s.state.global, 99);
  assert.equal(s.state.articles[0].isRead, true);
  const [failure] = s.globals.backgroundReadQueue.getSnapshot();
  s.globals.backgroundReadQueue.retry(failure.id);
  await s.flush();
  assert.equal(s.state.requests.filter(([kind]) => kind === "write").length, 1);
  assert.equal(s.globals.backgroundReadQueue.getSnapshot().length, 1);
});

test("context Above advances immediately, while toolbar Above and no-op actions stay put", async () => {
  const gate = deferred();
  const success = scenario({ setting: "above", write: () => gate.promise });
  await success.aboveAction(["one"], "context-menu");
  assert.equal(success.state.navigations.length, 1);
  assert.equal(success.pending.size, 1);
  gate.resolve();
  await success.flush();
  assert.equal(success.state.navigations.length, 1);
  const toolbar = scenario({ setting: "both" });
  await toolbar.aboveAction(["one"]);
  assert.deepEqual(toolbar.state.navigations, []);
  const failed = scenario({ setting: "both", aboveSucceeded: false });
  await failed.aboveAction(["one"], "context-menu");
  await failed.flush();
  assert.equal(failed.state.navigations.length, 1);
  assert.equal(failed.globals.backgroundReadQueue.getSnapshot().length, 1);
  const empty = scenario({ setting: "both" });
  await empty.aboveAction(["two"], "context-menu");
  assert.deepEqual(empty.state.navigations, []);
});

function waitForQueue(queue, predicate) {
  if (predicate(queue.getSnapshot())) return Promise.resolve();
  return new Promise(resolve => {
    const unsubscribe = queue.subscribe(() => {
      if (predicate(queue.getSnapshot())) { unsubscribe(); resolve(); }
    });
  });
}

test("retry is single-flight and does not drop failures from other jobs", async () => {
  const queue = new BackgroundReadQueue();
  const gate = deferred();
  let attempts = 0;
  queue.enqueue("first", async () => { if (++attempts === 1) throw Error("offline"); await gate.promise; });
  queue.enqueue("second", async () => { throw Error("offline"); });
  await waitForQueue(queue, failures => failures.length === 2);
  const first = queue.getSnapshot().find(item => item.name === "first");
  assert.equal(queue.getSnapshot().length, 2);
  queue.retry(first.id);
  queue.retry(first.id);
  assert.equal(attempts, 2);
  assert.equal(queue.getSnapshot().find(item => item.id === first.id).retrying, true);
  gate.resolve();
  await waitForQueue(queue, failures => failures.length === 1);
  assert.equal(queue.getSnapshot().length, 1);
  assert.equal(queue.getSnapshot()[0].name, "second");
});
