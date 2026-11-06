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
test("toolbar defaults to Mark All and retains Read Above as an explicit action", () => {
  assert.equal(actions.getDefaultListToolbarReadAction(), "mark-all-read");
  assert.equal(actions.shouldMarkAboveRead(), false);
  assert.equal(actions.shouldMarkAboveRead("mark-all-read"), false);
  assert.equal(actions.shouldMarkAboveRead("mark-above-read"), true);
});

const app = ts.createSourceFile("App.tsx", readFileSync(new URL("../../src/app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === "markCurrentListRead") {
    callback = node.initializer.arguments[0].getText(app);
  }
  ts.forEachChild(node, visit);
}
visit(app);
assert.ok(callback);

function scenario({ mode = "all", previewMode = false, scope = { kind: "reading-list" }, write, counts } = {}) {
  const original = [
    { id: "one", feedId: "feed/a", isRead: false },
    { id: "two", feedId: "feed/b", isRead: true },
    { id: "three", feedId: "feed/a", isRead: false },
  ];
  const state = { articles: structuredClone(original), selected: "three", continuation: "page-4", refresh: 0,
    sessions: 0, replacements: 0, requests: [], notifications: [], loading: false, loadingTransitions: [], global: 5, counts: { "feed/a": 4, "feed/b": 1 } };
  const set = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const ref = (current = 0) => ({ current });
  const globals = {
    previewMode, scope, mode, articles: state.articles, feedUnreadCounts: state.counts,
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
    trackWrite: (promise) => promise, getStreamId: (value) => value.kind === "reading-list" ? "reading-list" : value.id,
    normalizeRssError: (error) => ({ message: error.message }), notify: (text) => state.notifications.push(text),
    Date: { now: () => 1000 },
    rssClient: {
      markStreamRead: async (request) => { state.requests.push(["write", { ...request }]); await write?.(globals); },
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
  globals.applyPreviewScope = () => {
    state.replacements++;
    state.articles = Array.from(globals.previewArticlesRef.current.values()).filter(article =>
      globals.articleMatchesPreviewScope(article, scope) && (mode === "all" || !article.isRead));
    return state.articles;
  };
  return { action: compile(`export const action = ${callback}`, globals).action, state, globals, original };
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
