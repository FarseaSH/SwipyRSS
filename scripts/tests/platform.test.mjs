import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

/**
 * Exercise the actual Web adapter with browser and network boundaries replaced by local fakes.
 * 使用本地替身替换浏览器和网络边界，验证真实的 Web 适配器。
 */
function createWebPlatform() {
  const opened = [];
  let registrations = 0;
  const browser = {
    location: { search: "" },
    open: (...args) => opened.push(args),
  };
  const defaults = { apiUrl: "https://rss.example.com/api/greader.php", username: "reader" };
  class WebRssClient {}
  const imports = {
    "@/services/web/FreshRssApi": {
      getDefaultWebApiUrl: () => defaults.apiUrl,
      getDefaultWebUsername: () => defaults.username,
    },
    "@/services/web/WebRssClient": { WebRssClient },
    "@/services/web/runtimeConfig": {
      registerFreshRssExtensionServiceWorker: () => { registrations += 1; },
    },
  };
  const source = readFileSync(new URL("../../src/platform/web.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
    window: browser,
    URL,
    URLSearchParams,
  }, { filename: "web-platform.js" });
  return {
    platform: exports.platform,
    browser,
    defaults,
    opened,
    WebRssClient,
    registrations: () => registrations,
  };
}

test("Web services share one client and read current host connection defaults", () => {
  const { platform, defaults, WebRssClient } = createWebPlatform();
  assert.ok(platform.rssClient instanceof WebRssClient);
  const client = platform.rssClient;
  assert.deepEqual({ ...platform.getConnectionDefaults() }, defaults);
  defaults.username = "another-reader";
  assert.equal(platform.getConnectionDefaults().username, "another-reader");
  assert.equal(platform.rssClient, client);
});

test("browser preview requires the explicit preview=1 query parameter", () => {
  const { platform, browser } = createWebPlatform();
  for (const [search, expected] of [
    ["", false], ["?preview=0", false], ["?preview=true", false],
    ["?preview=1", true], ["?other=1&preview=1", true],
  ]) {
    browser.location.search = search;
    assert.equal(platform.isPreviewRequested(), expected, search);
  }
});

test("article opening retains the user gesture and isolates the new tab", async () => {
  const { platform, opened } = createWebPlatform();
  assert.equal(platform.externalArticles.kind, "external");
  for (const url of ["https://example.com/article?q=1#section", "http://example.com/article"]) {
    const count = opened.length;
    const pending = platform.externalArticles.open(url);
    assert.equal(opened.length, count + 1);
    assert.deepEqual(opened.at(-1), [url, "_blank", "noopener,noreferrer"]);
    await pending;
  }
});

test("unsafe or malformed article URLs never open a tab", async () => {
  const { platform, opened } = createWebPlatform();
  for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///tmp/article", "ftp://example.com", "/relative", "invalid"]) {
    await assert.rejects(platform.externalArticles.open(url));
  }
  assert.equal(opened.length, 0);
});

test("Web initialization delegates Service Worker registration to its host integration", () => {
  const { platform, registrations } = createWebPlatform();
  assert.equal(registrations(), 0);
  platform.initialize();
  assert.equal(registrations(), 1);
});
