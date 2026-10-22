const test = require("node:test");
const assert = require("node:assert/strict");

const xp = require("../js/xp/integrity.js");
const pagination = require("../js/supabase/pagination.js");

test("official floor is applied after every ordered series", () => {
  const series = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.equal(xp.computeFlooredSeriesXp(series, { a: -50, b: 40, c: -10, d: 5 }), 35);
  assert.equal(xp.computeFlooredSeriesXp(series, { a: 10, b: -30, c: -5, d: 2 }), 2);
});

test("consecutive losses cannot make the persisted projection negative", () => {
  const series = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.equal(xp.computeFlooredSeriesXp(series, { a: -15, b: -15, c: 10, d: -15 }), 0);
  assert.equal(xp.computeFlooredSeriesXp(series, { a: 5, b: -15, c: -15, d: 20 }), 20);
});

test("level thresholds cannot be bypassed by replay", () => {
  assert.equal(xp.getGeneralLevelEligibility("beginner", 699).allowed, true);
  assert.equal(xp.getGeneralLevelEligibility("beginner", 700).allowed, false);
  assert.equal(xp.getGeneralLevelEligibility("intermediate", 1499).allowed, true);
  assert.equal(xp.getGeneralLevelEligibility("intermediate", 1500).allowed, false);
  assert.equal(xp.getGeneralLevelEligibility("beginner", 700, { resumeExistingSeries: false }).allowed, false);
  assert.equal(xp.getGeneralLevelEligibility("beginner", 700, { resumeExistingSeries: true }).allowed, true);
  assert.equal(xp.getGeneralLevelEligibility("intermediate", 1500, { resumeExistingSeries: true }).allowed, true);
  assert.equal(xp.getGeneralLevelEligibility("expert", 999999).allowed, true);
});

for (const size of [999, 1000, 1001]) {
  test(`pagination returns all ${size} rows`, async () => {
    const rows = Array.from({ length: size }, (_, id) => ({ id }));
    const result = await pagination.fetchAllRows(
      () => ({
        range: async (from, to) => ({
          data: rows.slice(from, to + 1),
          count: rows.length,
          error: null
        })
      }),
      { pageSize: 1000, label: "test rows" }
    );
    assert.equal(result.length, size);
    assert.deepEqual(result, rows);
  });
}

test("pagination aborts when exact count proves the snapshot is incomplete", async () => {
  await assert.rejects(
    pagination.fetchAllRows(
      () => ({ range: async () => ({ data: [{ id: 1 }], count: 2, error: null }) }),
      { label: "incomplete" }
    ),
    /lecture incomplète/
  );
});
