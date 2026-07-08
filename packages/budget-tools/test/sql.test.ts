import { test } from "node:test";
import assert from "node:assert/strict";
import { runSql } from "../src/index.js";

test("runSql runs a read-only SELECT and returns rows + the shaped sql", async () => {
  const r = await runSql({ query: "SELECT count(*) AS n FROM fact_budget_line" });
  assert.equal(r.row_count, 1);
  assert.ok(Number(r.rows[0].n) > 0, "fact_budget_line should have rows");
  assert.match(r.sql, /limit/i, "a LIMIT should be appended");
});

test("runSql rejects a non-SELECT via guardSelect", async () => {
  await assert.rejects(
    () => runSql({ query: "DELETE FROM fact_budget_line" }),
    /SELECT \/ WITH/,
  );
});
