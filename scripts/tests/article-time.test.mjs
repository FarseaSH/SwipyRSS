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
