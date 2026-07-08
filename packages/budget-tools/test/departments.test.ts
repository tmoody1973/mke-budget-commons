import { test } from "node:test";
import assert from "node:assert/strict";
import { listDepartments, getDepartmentBudget, budgetBreakdown } from "../src/index.js";

test("listDepartments(city) returns cited, totaled departments", async () => {
  const r = await listDepartments({ gov: "city" });
  assert.ok(r.departments.length > 0);
  assert.equal(r.total_label, "adopted");
  assert.equal(typeof r.departments[0].dept_id, "string");
});

test("getDepartmentBudget throws on an unknown department", async () => {
  await assert.rejects(() => getDepartmentBudget({ dept: "Ministry of Silly Walks", gov: "city" }), /No department matches/);
});

test("getDepartmentBudget(Fire) returns reserved-code totals + citations", async () => {
  const r = await getDepartmentBudget({ dept: "Fire Department", gov: "city" });
  assert.ok(r.citations.length > 0, "must carry provenance");
  assert.ok(r.totals.grand_total > 0);
});

test("budgetBreakdown(city) sums to ~100% and carries a total", async () => {
  const r = await budgetBreakdown({ gov: "city" });
  assert.ok(r.total > 0);
  const pcts = Object.values(r.breakdown).map((x: any) => x.pct);
  const sum = pcts.reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(sum - 100) < 1.0, `breakdown pct sum ${sum} should be ~100`);
});

test("getDepartmentBudget returns {ambiguous, candidates} for a multi-match name (does not throw)", async () => {
  const r = await getDepartmentBudget({ dept: "commission", gov: "city" });
  assert.equal(r.ambiguous, true);
  assert.ok(Array.isArray(r.candidates) && r.candidates.length >= 2, "should return >=2 candidates");
  assert.ok(r.candidates.every((c: any) => c.dept_id && c.canonical_name), "candidates carry dept_id + canonical_name");
});
