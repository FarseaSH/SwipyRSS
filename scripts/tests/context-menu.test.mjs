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
const { unreadIdsThroughArticle, contextMenuPosition } = compile(readFileSync(new URL("../../src/features/article-list/contextMenu.ts", import.meta.url), "utf8"));
const articles = [
  { id: "one", feedId: "feed/a", isRead: false, publishedAt: 1 },
  { id: "two", feedId: "feed/b", isRead: false, publishedAt: 2 },
  { id: "three", feedId: "feed/a", isRead: true, publishedAt: 3 },
  { id: "four", feedId: "feed/a", isRead: false, publishedAt: 4 },
];

test("Read Above includes the target and previous loaded screens, skips read entries and excludes later entries", () => {
  assert.deepEqual(Array.from(unreadIdsThroughArticle(articles, "two")), ["one", "two"]);
  assert.deepEqual(Array.from(unreadIdsThroughArticle(articles, "three")), ["one", "two"]);
  assert.deepEqual(Array.from(unreadIdsThroughArticle(articles, "four")), ["one", "two", "four"]);
  assert.equal(unreadIdsThroughArticle(articles, "missing").length, 0);
  assert.equal(unreadIdsThroughArticle(articles.map((a) => ({ ...a, isRead: true })), "four").length, 0);
});

test("Menu independently flips all four corners, clamps, and respects visual viewport offsets", () => {
  const viewport = { left: 0, top: 0, width: 800, height: 600 };
  for (const [x, y, left, top] of [[20, 20, 20, 20], [790, 20, 510, 20], [20, 590, 20, 350], [790, 590, 510, 350]]) {
    assert.deepEqual({ ...contextMenuPosition(x, y, 280, 240, viewport) }, { left, top });
  }
  assert.deepEqual({ ...contextMenuPosition(0, 0, 280, 240, viewport) }, { left: 8, top: 8 });
  assert.deepEqual({ ...contextMenuPosition(200, 110, 200, 100, { left: 100, top: 50, width: 220, height: 120 }) }, { left: 108, top: 58 });
});

// Run the real App callback against controlled asynchronous service boundaries, as in platform.test.
const app = ts.createSourceFile("App.tsx", readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "markFeedRead") callback = node.initializer.arguments[0].getText(app);
  ts.forEachChild(node, find);
}
find(app);
assert.ok(callback);
function scenario({ mode = "all", preview = false, page, counts, write } = {}) {
  const state = { articles: structuredClone(articles), continuation: "next-page", global: 8, counts: { "feed/a": 6, "feed/b": 2 }, refresh: 0, notifications: [], requests: [], selected: "two", loading: false, sessions: 0, reconciliations: 0 };
  const set = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const ref = (current = 0) => ({ current });
  const globals = {
    scope: { kind: "folder", id: "folder/mixed" }, mode, previewMode: preview,
    continuation: state.continuation, articles: state.articles, feedUnreadCounts: state.counts,
    Date: { now: () => 1000 },
    requestSequenceRef: ref(), loadMoreRequestRef: ref(), loadMoreInFlightRef: ref(true),
    unreadMutationVersionRef: ref(), mutationSequenceRef: ref(), latestMutationRef: ref(new Map()),
    unreadRefreshSequenceRef: ref(), unreadRefreshRequestedAtRef: ref(),
    setArticles: set("articles"), setContinuation: set("continuation"), setLoadingList: set("loading"),
    setLoadingMore: set("loadingMore"), setReadingListUnreadCount: set("global"), setFeedUnreadCounts: set("counts"),
    setSelectedId: set("selected"), setListRefreshKey: set("refresh"),
    recordFeedsMarkedRead: () => {}, beginReadingSession: () => state.sessions++,
    reconcileUnreadCounts: () => state.reconciliations++,
    getStreamId: (scope) => scope.id,
    normalizeRssError: (error) => ({ message: error.message }), notify: (text) => state.notifications.push(text),
    rssClient: {
      markStreamRead: async (request) => { state.requests.push(["write", { ...request }]); if (write) await write(globals); },
      getStream: async (request) => { state.requests.push(["page", { ...request }]); if (page) return await page(); return { items: [articles[1]], continuation: "fresh" }; },
      refreshUnreadCounts: async () => { if (counts) return await counts(); return { readingListUnreadCount: 2, feedUnreadCounts: { "feed/a": 0, "feed/b": 2 } }; },
    },
    previewArticlesRef: ref(new Map([...articles, { id: "unloaded", feedId: "feed/a", publishedAt: 5, isRead: false }].map((a) => [a.id, { ...a }]))),
    previewFeeds: [{ id: "feed/a" }, { id: "feed/b" }],
    createPreviewFeedUnreadCounts: (feeds, all) => Object.fromEntries(feeds.map((feed) => [feed.id, all.filter((a) => a.feedId === feed.id && !a.isRead).length])),
  };
  globals.applyPreviewScope = () => {
    const visible = Array.from(globals.previewArticlesRef.current.values()).filter((a) => mode === "all" || !a.isRead);
    state.articles = visible;
    return visible;
  };
  const { action } = compile(`export const action = ${callback}`, globals);
  return { action, state, globals };
}

test("Feed bulk read sends exactly the target Feed and confirmation timestamp, preserving all-mode list position", async () => {
  const { action, state, globals } = scenario();
  await action("feed/a");
  assert.deepEqual(state.requests, [["write", { streamId: "feed/a", beforeTimestampUsec: "1000000" }]]);
  assert.deepEqual(state.articles.map((a) => [a.id, a.isRead]), [["one", true], ["two", false], ["three", true], ["four", true]]);
  assert.equal(state.continuation, "next-page");
  assert.equal(state.refresh, 0);
  assert.equal(state.selected, "two");
  assert.equal(state.global, 2);
  assert.ok(globals.loadMoreRequestRef.current >= 2);
  assert.ok(globals.latestMutationRef.current.has("read:one"));
});

test("Unread bulk read reloads the current mixed scope and discards old continuation", async () => {
  const { action, state } = scenario({ mode: "unread" });
  await action("feed/a");
  assert.deepEqual(state.requests[1], ["page", { streamId: "folder/mixed", unreadOnly: true }]);
  assert.deepEqual(state.articles.map((a) => a.id), ["two"]);
  assert.equal(state.continuation, "fresh");
  assert.ok(state.refresh > 0);
});

test("Successful write survives failed or cached refresh without resurrecting target Feed entries", async () => {
  for (const page of [async () => { throw Error("offline"); }, async () => ({ items: articles, continuation: "stale", fromCache: true })]) {
    const { action, state } = scenario({ mode: "unread", page, counts: async () => { throw Error("offline"); } });
    await action("feed/a");
    assert.deepEqual(state.articles.map((a) => a.feedId), ["feed/b"]);
    assert.equal(state.continuation, undefined);
    assert.equal(state.counts["feed/a"], 0);
    assert.match(state.notifications.at(-1), /已标记为已读.*刷新失败/);
  }
});

test("Failed write leaves articles and counts intact and permits retry", async () => {
  const { action, state } = scenario({ write: async () => { throw Error("write failed"); } });
  await assert.rejects(action("feed/a"), /write failed/);
  assert.deepEqual(state.articles, articles);
  assert.equal(state.counts["feed/a"], 6);
  assert.equal(state.continuation, "next-page");
  assert.equal(state.loading, false);
});

test("A scope change during the write prevents stale list replacement", async () => {
  const { action, state } = scenario({ mode: "unread", write: async (globals) => { globals.requestSequenceRef.current++; } });
  await action("feed/a");
  assert.deepEqual(state.articles, articles);
  assert.equal(state.requests.length, 1);
  assert.equal(state.reconciliations, 1);
});

test("Preview bulk read covers unloaded mock entries and never calls FreshRSS", async () => {
  for (const mode of ["all", "unread"]) {
    const { action, state, globals } = scenario({ mode, preview: true });
    await action("feed/a");
    assert.equal(globals.previewArticlesRef.current.get("unloaded").isRead, true);
    assert.equal(globals.previewArticlesRef.current.get("two").isRead, false);
    assert.equal(state.requests.length, 0);
    assert.equal(state.counts["feed/a"], 0);
  }
});
