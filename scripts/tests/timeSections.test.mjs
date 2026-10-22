import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadModule(path, extra = "", dependencies = {}) {
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Date, Intl, require: (name) => dependencies[name] });
  return exports;
}

const { getTimeSection, getTimeSectionContext, updateTimeSections } = loadModule("src/features/article-list/timeSections.ts");
const at = (day, hour = 0, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const now = at(22, 23, 59);
const item = (id, time) => ({ id: String(id), publishedAt: time });
const labels = (state) => Array.from(state.labels.values());

test("six-hour boundaries, calendar weeks, seven-day cutoff, and invalid dates", () => {
  for (const [hour, label] of [[0, "凌晨"], [5, "凌晨"], [6, "早上"], [11, "早上"], [12, "下午"], [17, "下午"], [18, "晚上"], [23, "晚上"]]) {
    assert.equal(getTimeSection(at(22, hour), now).label, `今天${label}`);
    assert.equal(getTimeSection(at(21, hour), now).label, `昨天${label}`);
  }
  for (const [day, label] of [[20, "周二"], [19, "周一"], [18, "上周日"], [16, "上周五"], [15, "更早"], [1, "更早"]]) {
    assert.equal(getTimeSection(at(day), now).label, label);
  }
  assert.equal(getTimeSection(NaN, now), null);
  assert.equal(getTimeSection(Infinity, now), null);
  assert.equal(getTimeSection(1e20, now), null);
  assert.equal(getTimeSection(at(23), now).label, "今天晚上");
});

test("out-of-order first batch uses the latest suffix time without sorting articles", () => {
  const articles = [item(1, at(22, 9)), item(2, at(21, 22)), item(3, at(22, 15)), item(4, at(22, 8)), item(5, at(21, 20)), item(6, at(20, 13))];
  const state = updateTimeSections(null, articles, "list", now);
  assert.deepEqual(labels(state), ["今天下午", undefined, undefined, "今天早上", "昨天晚上", "周二"]);
  assert.deepEqual(Array.from(state.labels.keys()), ["1", "2", "3", "4", "5", "6"]);
});

test("appending newer, equal, older and unknown times freezes existing text and positions", () => {
  const first = [item(1, at(22, 15)), item(2, at(22, 8))];
  const before = updateTimeSections(null, first, "list", now);
  const second = [item(3, at(21, 22)), item(4, at(22, 20)), item(5, NaN), item(6, at(21, 15)), item(7, at(20))];
  const after = updateTimeSections(before, [...first, ...second], "list", now);
  assert.deepEqual(labels(after), ["今天下午", "今天早上", undefined, undefined, undefined, "昨天下午", "周二"]);
  for (const [id, label] of before.labels) assert.equal(after.labels.get(id), label);
  assert.deepEqual(labels(before), ["今天下午", "今天早上"]);
  assert.equal(updateTimeSections(after, [...first, ...second], "list", now), after);
});

test("unknown entries do not host labels or prematurely end a batch", () => {
  const state = updateTimeSections(null, [item(1, NaN), item(2, at(22, 9)), item(3, NaN), item(4, at(21, 20)), item(5, NaN)], "list", now);
  assert.deepEqual(labels(state), [undefined, "今天早上", undefined, "昨天晚上", undefined]);
  const unknown = updateTimeSections(null, [item(1, NaN)], "list", now);
  const appended = updateTimeSections(unknown, [item(1, NaN), item(2, at(20))], "list", now);
  assert.deepEqual(labels(appended), [undefined, "周二"]);
});

test("older is terminal; state changes, removals and reappearance cannot move boundaries", () => {
  const articles = [item(1, at(20)), item(2, at(1))];
  const state = updateTimeSections(null, articles, "list", now);
  const extended = updateTimeSections(state, [...articles, item(3, at(22)), item(4, at(1))], "list", now);
  assert.deepEqual(labels(extended), ["周二", "更早", undefined, undefined]);
  assert.equal(updateTimeSections(extended, [articles[1]], "list", now), extended);
  assert.equal(updateTimeSections(extended, articles.map((article) => ({ ...article, isRead: true, isStarred: true })), "list", now), extended);
});

test("refresh, midnight, year boundary and time-zone changes rebuild the calendar", () => {
  const articles = [item(1, at(22, 15))];
  const context = getTimeSectionContext(0, now);
  const state = updateTimeSections(null, articles, context, now);
  assert.equal(getTimeSectionContext(0, at(22, 9)), context);
  assert.notEqual(getTimeSectionContext(1, now), context);
  const tomorrow = at(23);
  assert.equal(updateTimeSections(state, articles, getTimeSectionContext(0, tomorrow), tomorrow).labels.get("1"), "昨天下午");
  const oldZone = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    const west = getTimeSectionContext(0, at(22, 12));
    process.env.TZ = "Asia/Shanghai";
    assert.notEqual(getTimeSectionContext(0, at(22, 12)), west);
    const newYear = new Date(2027, 0, 1, 9).getTime();
    assert.equal(getTimeSection(new Date(2026, 11, 31, 19).getTime(), newYear).label, "昨天晚上");
  } finally {
    if (oldZone === undefined) delete process.env.TZ;
    else process.env.TZ = oldZone;
  }
});

test("first-line inset is included in fixed-height pagination without accumulating gaps", () => {
  const { paginateArticles } = loadModule("src/features/article-list/hooks/useArticlePages.ts", "\nexport { paginateArticles };", { react: {} });
  const articles = Array.from({ length: 12 }, (_, index) => item(index, now));
  const layouts = Object.fromEntries(articles.map((article, index) => [article.id, { heightClass: ["compact", "title-only", "standard"][index % 3] }]));
  const pages = paginateArticles(articles, layouts, 400);
  assert.equal(pages[0].snapOffset, 0);
  assert.equal(pages[0].startOffset, 18);
  assert.equal(pages[1].startOffset, 18 + 82 + 92 + 104 + 82);
  assert.equal(pages[1].snapOffset, pages[1].startOffset - 49);
  assert.equal(pages[0].bottomMaskOffset, pages[1].startOffset);
  assert.equal(pages.flatMap((page) => page.articles).length, articles.length);
});
