import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../../src/lib/time/articleTime.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, Intl, Date, Map });
const { formatArticleTime: format, nextZonedDay, validTimeZone } = exports;
const at = Date.parse;
test("same instant crosses calendar dates in selected zones, with unchanged ISO metadata", () => {
  const instant = at("2026-10-22T01:00Z"), now = at("2026-10-22T08:00Z");
  assert.equal(format(instant, now, "Asia/Shanghai").label, "今天 09:00");
  assert.equal(format(instant, now, "America/Los_Angeles").label, "昨天 18:00");
  assert.equal(format(instant, now, "America/Los_Angeles").dateTime, new Date(instant).toISOString());
});
test("list and reader share week/year rules and differ only in time detail", () => {
  const now = at("2026-10-22T12:00Z"), instant = at("2026-10-20T02:30Z");
  assert.equal(format(instant, now, "Asia/Shanghai").label, "周二 10-20");
  assert.equal(format(instant, now, "Asia/Shanghai", "reader").label, "周二 10-20 10:30");
  assert.equal(format(at("2026-10-16T02:30Z"), now, "UTC").label, "上周五 10-16");
  assert.equal(format(at("2025-12-31T20:30Z"), at("2026-01-10T12:00Z"), "UTC").label, "2025-12-31");
  assert.equal(format(at("2025-12-31T20:30Z"), at("2026-01-02T12:00Z"), "Asia/Shanghai").label, "昨天 04:30");
});
test("DST offsets are determined by publication date, including repeated hours", () => {
  const now = at("2026-11-02T12:00Z");
  for (const iso of ["2026-11-01T05:30Z", "2026-11-01T06:30Z"]) assert.equal(format(at(iso), now, "America/New_York").label, "昨天 01:30");
  assert.equal(format(at("2026-03-08T06:30Z"), at("2026-03-08T08:00Z"), "America/New_York").label, "今天 01:30");
  assert.equal(format(at("2026-03-08T07:30Z"), at("2026-03-08T08:00Z"), "America/New_York").label, "今天 03:30");
});
test("next midnight handles 23/25-hour days and fractional offsets", () => {
  for (const [now, zone, expected] of [
    ["2026-03-08T05:00Z", "America/New_York", "2026-03-09T04:00Z"],
    ["2026-11-01T04:00Z", "America/New_York", "2026-11-02T05:00Z"],
    ["2026-10-22T01:00Z", "Asia/Kathmandu", "2026-10-22T18:15Z"],
  ]) assert.equal(nextZonedDay(at(now), zone), at(expected));
});
test("invalid timestamps degrade safely and future dates are not marked today", () => {
  assert.equal(format(NaN, Date.now(), "UTC").dateTime, undefined);
  assert.equal(format(at("2026-10-23T01:00Z"), at("2026-10-22T01:00Z"), "UTC").label, "10-23");
  assert.equal(validTimeZone("invalid/zone"), false);
  assert.equal(validTimeZone("UTC"), true);
});

function timeModule(detected) {
  const result = {};
  let attempts = 0;
  function DateTimeFormat(locale, options) {
    if (!options) return { resolvedOptions() {
      const value = detected();
      if (value instanceof Error) throw value;
      return { timeZone: value };
    } };
    if (options.timeZone === "unknown") attempts++;
    return new Intl.DateTimeFormat(locale, options);
  }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../../src/lib/time/articleTime.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: result, Intl: { DateTimeFormat }, Date, Map });
  return { api: result, attempts: () => attempts };
}
test("device detection rejects unknown, empty, missing and throwing results, and recovers", () => {
  let zone;
  const { api } = timeModule(() => zone);
  for (zone of ["unknown", "Etc/Unknown", "", "   ", undefined, null, new Error("unavailable")]) {
    assert.equal(api.deviceTimeZone(), "UTC");
    assert.equal(api.detectDeviceTimeZone().fallback, true);
  }
  for (zone of ["UTC", "Asia/Shanghai", "America/New_York"]) {
    assert.equal(api.deviceTimeZone(), zone);
    assert.equal(api.detectDeviceTimeZone().fallback, false);
  }
  for (const value of [undefined, null, "", "   ", 42, {}]) assert.equal(api.validTimeZone(value), false);
});
test("invalid direct formatter inputs use cached UTC for labels and midnight arithmetic", () => {
  const { api, attempts } = timeModule(() => "UTC");
  const instant = at("2026-10-22T01:00Z"), now = at("2026-10-22T08:00Z");
  for (const zone of ["unknown", "Etc/Unknown", ""]) {
    assert.equal(api.formatArticleTime(instant, now, zone).label, format(instant, now, "UTC").label);
    assert.equal(api.formatArticleTime(instant, now, zone, "reader").label, format(instant, now, "UTC", "reader").label);
    assert.equal(api.nextZonedDay(now, zone), at("2026-10-23T00:00Z"));
  }
  assert.equal(attempts(), 1, "invalid zone formatter is attempted only once across repeated calls");
});

// Exercise the Provider's state and event lifecycle with deterministic hook/event adapters.
function providerHarness(saved, detected) {
  const storage = new Map(saved ? [["swipyrss.display-timezone.v1", saved]] : []);
  const listeners = new Map(), timers = new Map(), states = [], effects = [];
  let cursor = 0, timerId = 0;
  const react = {
    createContext: () => ({ Provider: "Provider" }),
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = value; }];
    },
    useMemo: fn => fn(),
    useEffect: fn => effects.push(fn),
  };
  const events = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
  const result = {};
  const api = timeModule(detected).api;
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../../src/lib/time/ArticleTimeProvider.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports: result, Date,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }) };
      if (name === "./articleTime") return api;
      throw new Error(name);
    },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    window: { ...events, setTimeout: fn => { timers.set(++timerId, fn); return timerId; } },
    document: { ...events, hidden: false }, clearTimeout: id => timers.delete(id),
  });
  return {
    storage, listeners, timers,
    render() { cursor = 0; effects.length = 0; return result.ArticleTimeProvider({ children: null }).props.value; },
    mountEffect() { return effects[0](); },
  };
}
test("Provider keeps auto on detection failure, recovers on focus/timer, and respects manual selection", () => {
  let zone = "unknown";
  const harness = providerHarness("auto", () => zone);
  let value = harness.render();
  assert.equal(value.timeZone, "UTC");
  assert.equal(value.deviceTimeZoneFallback, true);
  let cleanup = harness.mountEffect();
  assert.equal(harness.timers.size, 1);
  assert.equal(harness.storage.get("swipyrss.display-timezone.v1"), "auto");
  zone = "Asia/Shanghai";
  harness.listeners.get("focus")();
  value = harness.render();
  assert.equal(value.timeZone, zone);
  assert.equal(value.deviceTimeZoneFallback, false);
  zone = "unknown";
  [...harness.timers.values()][0]();
  value = harness.render();
  assert.equal(value.timeZone, "UTC");
  value.setPreference("America/New_York");
  cleanup();
  value = harness.render();
  cleanup = harness.mountEffect();
  zone = "Asia/Tokyo";
  harness.listeners.get("focus")();
  value = harness.render();
  assert.equal(value.timeZone, "America/New_York");
  assert.equal(value.deviceTimeZone, "Asia/Tokyo");
  assert.equal(harness.storage.get("swipyrss.display-timezone.v1"), "America/New_York");
  cleanup();
  assert.equal(harness.timers.size, 0);
});
test("Provider rejects invalid saved, selected and cross-tab preferences", () => {
  const harness = providerHarness("unknown", () => "unknown");
  let value = harness.render();
  assert.equal(value.preference, "auto");
  assert.equal(value.timeZone, "UTC");
  const cleanup = harness.mountEffect();
  value.setPreference("Etc/Unknown");
  assert.equal(harness.render().preference, "auto");
  harness.storage.set("swipyrss.display-timezone.v1", "Asia/Shanghai");
  harness.listeners.get("storage")({ key: "swipyrss.display-timezone.v1" });
  assert.equal(harness.render().timeZone, "Asia/Shanghai");
  harness.storage.set("swipyrss.display-timezone.v1", "unknown");
  harness.listeners.get("storage")({ key: "swipyrss.display-timezone.v1" });
  value = harness.render();
  assert.equal(value.preference, "auto");
  assert.equal(value.timeZone, "UTC");
  cleanup();
});
