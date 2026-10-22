import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../src/features/settings/settingsBackup.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = {};
vm.runInNewContext(compiled, { exports: api, URL }, { filename: "settingsBackup.js" });
const plain = (value) => JSON.parse(JSON.stringify(value));
const base = { format: "swipyrss-settings", version: 1 };
const parse = (value) => api.parseSettingsBackup(JSON.stringify({ ...base, ...value }));
const feeds = [
  { id: "new-100", title: "Same name", feedUrl: "https://Example.com:443/rss?token=one", folderIds: [] },
  { id: "new-200", title: "Same name", feedUrl: "https://example.com/rss?token=two", folderIds: [] },
];

test("export contains only allowed settings and explicitly remembered URL-based modes", () => {
  const backup = api.createSettingsBackup({ startupPage: "last-list", toolbarPosition: "right", swipeMarkRead: "both", username: "SECRET" }, {
    "reading-list:root": "unread", "starred:root": "all", "feed:new-100": "all",
    "feed:deleted": "unread", "folder:private-folder": "unread",
  }, [...feeds, { id: "missing-url", title: "Private", folderIds: [] }]);
  assert.deepEqual(plain(backup), { ...base,
    settings: { startupPage: "last-list", toolbarPosition: "right", swipeMarkRead: "both" },
    listModes: { readingList: "unread", starred: "all", feeds: { "https://example.com/rss?token=one": "all" } },
  });
  assert.doesNotMatch(JSON.stringify(backup), /SECRET|new-100|deleted|private-folder|missing-url/);
  assert.deepEqual(plain(api.parseSettingsBackup(JSON.stringify(backup))), plain(backup));
});

test("URL matching remaps IDs, skips absent feeds, and does not match titles or strip query parameters", () => {
  const backup = parse({ listModes: { starred: "unread", feeds: {
    "https://EXAMPLE.com:443/rss?token=one#fragment": "unread",
    "https://other.example/rss": "all",
  } } });
  const plan = api.planSettingsImport(backup, feeds);
  assert.deepEqual(plain(plan), { modes: { "feed:new-100": "unread", "starred:root": "unread" }, matchedFeeds: 1, skippedFeeds: 1, settingCount: 0, generalListCount: 1 });
});

test("partial backup omits absent settings and ignores unknown or sensitive fields", () => {
  const backup = parse({ settings: { toolbarPosition: "left", futureSetting: true, password: "SECRET" }, account: { username: "SECRET" }, listModes: { folders: { hidden: "unread" } } });
  assert.deepEqual(plain(backup), { ...base, settings: { toolbarPosition: "left" }, listModes: { feeds: {} } });
});

test("malformed JSON, future versions, invalid shapes, enums and feed URLs are rejected as a whole", () => {
  assert.throws(() => api.parseSettingsBackup("{"), /JSON/);
  for (const value of [
    [], null, { format: "other", version: 1 }, { ...base, version: 2 },
    { ...base, settings: [] }, { ...base, settings: { startupPage: "all", toolbarPosition: "invalid" } },
    { ...base, settings: { startupPage: 1 } }, { ...base, settings: { swipeMarkRead: null } },
    { ...base, listModes: { readingList: "read" } }, { ...base, listModes: { feeds: [] } },
    { ...base, listModes: { feeds: { "javascript:alert(1)": "all" } } },
    { ...base, listModes: { feeds: { "https://example.com/rss": "invalid" } } },
    { ...base, listModes: { feeds: { "https://EXAMPLE.com/rss": "all", "https://example.com/rss": "unread" } } },
    { ...base, settings: { unknown: 1 } },
  ]) assert.throws(() => api.parseSettingsBackup(JSON.stringify(value)), JSON.stringify(value));
  assert.throws(() => api.parseSettingsBackup(" ".repeat(1_048_577)), /1 MB/);
});

test("unsafe object keys cannot become application modes or pollute prototypes", () => {
  const text = '{"format":"swipyrss-settings","version":1,"settings":{"toolbarPosition":"left","__proto__":{"polluted":true}},"listModes":{"feeds":{"__proto__":"all"}}}';
  assert.throws(() => api.parseSettingsBackup(text), /URL/);
  assert.equal({}.polluted, undefined);
});

test("duplicate current subscriptions for the same URL restore each current ID", () => {
  const backup = parse({ listModes: { feeds: { "https://example.com/rss?token=one": "all" } } });
  const plan = api.planSettingsImport(backup, [...feeds, { ...feeds[0], id: "new-300" }]);
  assert.deepEqual(plain(plan.modes), { "feed:new-100": "all", "feed:new-300": "all" });
  assert.equal(plan.matchedFeeds, 1);
});

test("storage failure rolls back earlier changes and preserves unrelated device data", () => {
  const data = new Map([["existing", "original"], ["account", "untouched"]]);
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) { if (key === "fail") throw new Error("quota"); data.set(key, value); },
    removeItem: (key) => data.delete(key),
  };
  assert.throws(() => api.persistSettingsImport(storage, [["existing", "changed"], ["new", "new"], ["fail", "value"]]), /quota/);
  assert.deepEqual([...data], [["existing", "original"], ["account", "untouched"]]);
  api.persistSettingsImport(storage, [["existing", "success"]]);
  assert.equal(data.get("existing"), "success");
  assert.equal(data.get("account"), "untouched");
});
