import { test } from "node:test";
import assert from "node:assert/strict";
import { biggestChanges, traceAdoption } from "../src/index.js";

test("biggestChanges(city) ranks departments with citations", async () => {
  const r = await biggestChanges({ gov: "city", year_a: 2025, year_b: 2026, measure: "dollars", direction: "both", limit: 5 });
  assert.ok(r.results.length > 0 && r.results.length <= 5);
  assert.ok(r.citations.length > 0);
  const deltas = r.results.map((x: any) => Math.abs(x.delta));
  assert.deepEqual(deltas, [...deltas].sort((a, b) => b - a), "sorted by |delta| desc");
});

test("traceAdoption throws on an unknown department", async () => {
  await assert.rejects(() => traceAdoption({ dept: "Nope Bureau", fiscal_year: 2026, gov: "city" }), /No department matches/);
});
