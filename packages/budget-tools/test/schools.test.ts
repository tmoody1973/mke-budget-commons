import { test } from "node:test";
import assert from "node:assert/strict";
import { perPupilRanking, mpsFundSummary, cite } from "../src/index.js";

test("perPupilRanking returns cited, ranked schools + a median", async () => {
  const r = await perPupilRanking({ fiscal_year: 2027, order: "highest", min_enrollment: 0, limit: 10 });
  assert.ok(r.results.length > 0);
  assert.ok(r.citations.length > 0);
  assert.ok(r.district_median_per_pupil > 0);
});

test("mpsFundSummary returns expenditure/revenue and a fund breakdown", async () => {
  const r = await mpsFundSummary({ fiscal_year: 2027 });
  assert.ok(r.total_expenditures > 0);
  assert.ok(Array.isArray(r.by_fund) && r.by_fund.length > 0);
});

test("cite throws on a nonexistent line_id", async () => {
  await assert.rejects(() => cite({ line_id: -1 }), /No line with id/);
});
