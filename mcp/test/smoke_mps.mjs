// MPS smoke test: drive the MPS MCP tools through the real protocol and assert
// against verified figures from the FY2026-27 Revised Proposed Budget.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts"] });
const client = new Client({ name: "smoke-mps", version: "1.0" });
await client.connect(transport);

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const p = JSON.parse(r.content[0].text);
  console.log(`\n=== ${name}(${JSON.stringify(args)}) ===`);
  return p;
}
function assert(cond, msg) {
  if (!cond) { console.error("❌ ASSERT FAILED:", msg); process.exit(1); }
  console.log("  ✓", msg);
}

// 1. list_departments(mps) — schools/offices with FY2027 totals via SUM
const ld = await call("list_departments", { gov: "mps" });
console.log(`  ${ld.departments.length} MPS units; top:`, ld.departments[0]);
assert(ld.departments.length >= 200, "MPS schools/offices listed");
const ldSum = ld.departments.reduce((s, d) => s + (d.total || 0), 0);
assert(Math.abs(ldSum - 1600555548) < 1, "all school/office totals sum to the district total $1,600,555,548");

// 2. mps_fund_summary — district totals reconcile to the published figures
const fs = await call("mps_fund_summary");
console.log("  funds:", fs.by_fund.length, "| exp:", fs.total_expenditures, "| rev:", fs.total_revenue);
assert(fs.total_expenditures === 1600555548, "FY2027 MPS expenditures = $1,600,555,548 (published $1,600.6M)");
assert(Math.abs(fs.total_revenue - 1618211277.92) < 1, "FY2027 MPS revenue = $1,618,211,277.92");
assert(Math.abs(fs.surplus_or_fund_balance_use - 17655729.92) < 1, "surplus / fund-balance = $17,655,729.92");
assert(fs.by_fund.reduce((s, f) => s + f.amount, 0) === 1600555548, "fund breakdown sums to the total");

// 3. get_department_budget(mps) — a school's budget as sum of line items
const hs = await call("get_department_budget", { dept: "HIGHLAND", gov: "mps" });
console.log("  Highland:", { total: hs.total, fte: hs.total_fte, objects: hs.top_spending_by_object?.length });
assert(hs.total > 0 && hs.line_count > 0, "school budget sums its line items");
assert(hs.citations.length > 0, "school budget is cited");
assert(Array.isArray(hs.by_fund) && hs.by_fund.length > 0, "school budget breaks down by fund");

// 4. budget_breakdown(mps) district-wide — object categories + people costs
const bb = await call("budget_breakdown", { gov: "mps" });
console.log("  district total:", bb.total, "| top object:", bb.top_objects[0]);
assert(bb.total === 1600555548, "district breakdown total = $1,600,555,548");
assert(bb.people_costs.salaries.amount > 0 && bb.top_objects.length > 0, "people costs + top objects present");

// 5. compare_years(mps) — a school FY2026 → FY2027 via SUM
const cy = await call("compare_years", { dept: "HIGHLAND", gov: "mps", year_a: 2026, year_b: 2027 });
console.log("  Highland 2026→2027:", cy.grand_total);
assert(cy.grand_total?.fy2026 != null && cy.grand_total?.fy2027 != null, "compare_years works for MPS");

// 6. compare_schools — parent-facing side-by-side
const cs = await call("compare_schools", { school_a: "HIGHLAND", school_b: "STARMS EAR" });
console.log("  compare:", cs.a?.name, cs.a?.total, "vs", cs.b?.name, cs.b?.total);
assert(cs.a?.total > 0 && cs.b?.total > 0, "compare_schools returns both totals");
// and it correctly flags an ambiguous name instead of guessing
const amb = await call("compare_schools", { school_a: "HIGHLAND", school_b: "STARMS" });
assert(Array.isArray(amb.b?.ambiguous), "compare_schools flags ambiguous names, never guesses");

// 7. search_line_items + biggest_changes light up for mps
const sr = await call("search_line_items", { query: "teacher", gov: "mps", limit: 3 });
assert(sr.hits > 0, "search_line_items works for MPS");
const bc = await call("biggest_changes", { gov: "mps", year_a: 2026, year_b: 2027, limit: 5 });
assert(bc.results.length > 0, "biggest_changes works for MPS");

// 8. per_pupil_ranking — the equity lens (from the per-school dataset)
const pp = await call("per_pupil_ranking", { order: "highest", limit: 5 });
console.log("  schools ranked:", pp.schools_ranked, "| median $/pupil:", pp.district_median_per_pupil, "| top:", pp.results[0]);
assert(pp.schools_ranked >= 120, "per_pupil_ranking covers the schools");
assert(pp.results.every((s) => s.per_pupil > 0 && s.enrollment > 0), "each ranked school has per-pupil + enrollment");
assert(pp.district_median_per_pupil > 5000 && pp.district_median_per_pupil < 40000, "median per-pupil is plausible");
assert(pp.results[0].per_pupil >= pp.results[pp.results.length - 1].per_pupil, "highest order is descending");
// min_enrollment filter excludes tiny specialty schools
const ppBig = await call("per_pupil_ranking", { order: "highest", min_enrollment: 300, limit: 5 });
assert(ppBig.results.every((s) => s.enrollment >= 300), "min_enrollment filter works");

// 9. list_departments(mps) is NOT polluted by the school-name entries
const ld2 = await call("list_departments", { gov: "mps" });
const ldSum2 = ld2.departments.reduce((s, d) => s + (d.total || 0), 0);
assert(Math.abs(ldSum2 - 1600555548) < 1, "list_departments still sums to the district total (schools excluded)");

await client.close();
console.log("\n✅ MPS smoke test passed");
process.exit(0);
