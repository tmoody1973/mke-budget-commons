// Smoke test: vendor payments + the budget-comparison guardrail, driven through
// the real MCP protocol. Verifies the loaded data reconciles to the published
// totals AND that the guardrail behaves. See docs/CHECKBOOK-GUARDRAIL.md.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts"] });
const client = new Client({ name: "smoke-payments", version: "1.0" });
await client.connect(transport);

let failed = 0;
const check = (name, cond, detail = "") => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${detail}`);
  if (!cond) failed++;
};
const call = async (name, args = {}) =>
  JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

const names = (await client.listTools()).tools.map((t) => t.name);
console.log("\n=== tool registration ===");
for (const t of ["search_vendor_payments", "get_top_vendors", "vendor_payment_summary",
                 "compare_budget_to_payments"]) {
  check(`${t} registered`, names.includes(t));
}

console.log("\n=== reconciliation: loaded data vs published totals ===");
const tot = await call("run_sql", {
  query: "SELECT COUNT(*) n, SUM(amount_paid) total FROM fact_vendor_payment",
});
const n = Number(tot.rows[0].n), sum = Number(tot.rows[0].total);
console.log(`  ${n.toLocaleString()} rows · $${sum.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
check("row count == 404,120", n === 404120, `got ${n}`);
check("total == $4,937,976,866.16", Math.abs(sum - 4937976866.16) < 0.01, `delta ${sum - 4937976866.16}`);

console.log("\n=== tools return data + basis ===");
const s = await call("search_vendor_payments", { vendor: "UNITED HEALTHCARE", limit: 5 });
check("search returns hits", s.hits > 0);
check("search carries comparable_to_budget:false", s.basis?.comparable_to_budget === false);
check("search cites source rows", s.citations?.[0]?.locator === "row");

const t = await call("get_top_vendors", { year: 2025, limit: 5 });
check("top vendors returned", t.vendors?.length === 5);
check("sorted by net_paid desc", t.vendors[0].net_paid >= t.vendors[4].net_paid);
check("refunds exposed separately", t.vendors.every((v) => typeof v.refunds === "number"));
console.log(`  top 2025 vendor: ${t.vendors[0].vendor} — $${Number(t.vendors[0].net_paid).toLocaleString()}`);

const g = await call("vendor_payment_summary", { unit: "Police", year: 2025, group_by: "account" });
check("summary groups buckets", g.buckets?.length > 0);
check("summary carries basis", g.basis?.comparable_to_budget === false);
console.log(`  top Police 2025 category: ${g.buckets[0].bucket} — $${Number(g.buckets[0].net_paid).toLocaleString()}`);

console.log("\n=== guardrail ===");
const c = await call("compare_budget_to_payments", { department: "City Attorney" });
check("compare_budget_to_payments refuses", c.comparable === false);
check("refusal explains why", (c.reason ?? "").length > 100);
check("refusal offers alternatives", c.what_you_can_ask_instead?.length >= 3);
check("budget_execution_available false", c.budget_execution_available === false);

const joined = await call("run_sql", {
  query: `SELECT u.unit_name, SUM(p.amount_paid) paid
            FROM fact_vendor_payment p JOIN dim_spending_unit u USING (unit_id)
           WHERE EXISTS (SELECT 1 FROM fact_budget_line b WHERE b.division = u.unit_name)
           GROUP BY u.unit_name LIMIT 3`,
});
check("run_sql warns on cross-basis join", (joined.warning ?? "").includes("NOT comparable"));

const clean = await call("run_sql", { query: "SELECT COUNT(*) n FROM fact_vendor_payment" });
check("run_sql silent on single-table query", clean.warning === undefined);

console.log("\n=== structural: the two fact tables share no key ===");
// information_schema is blocked by the run_sql CATALOG guard, so probe the
// columns directly: selecting a column that exists succeeds, one that doesn't
// errors. (An earlier version of this test queried information_schema, got an
// empty result, and passed vacuously — absence of rows is not absence of a column.)
const exists = async (col) => {
  const r = await call("run_sql", { query: `SELECT ${col} FROM fact_vendor_payment LIMIT 1` });
  return r.error === undefined && Array.isArray(r.rows);
};
check("amount_paid exists", await exists("amount_paid"));
check("paid_on exists", await exists("paid_on"));
check("unit_id exists", await exists("unit_id"));
check("no dept_id column (no join key to dim_department)", !(await exists("dept_id")));
check("no bare 'amount' column", !(await exists("amount")));
check("no fiscal_year column", !(await exists("fiscal_year")));

await client.close();
console.log(failed === 0 ? "\n✅ payments smoke test passed\n" : `\n❌ ${failed} checks failed\n`);
process.exit(failed === 0 ? 0 : 1);
