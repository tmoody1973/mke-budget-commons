// County smoke test: drive the county MCP branches through the real protocol
// and assert against known printed figures from the 2026 Adopted Operating Budget.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts"] });
const client = new Client({ name: "smoke-county", version: "1.0" });
await client.connect(transport);

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const payload = JSON.parse(r.content[0].text);
  console.log(`\n=== ${name}(${JSON.stringify(args)}) ===`);
  return payload;
}

function assert(cond, msg) {
  if (!cond) { console.error("❌ ASSERT FAILED:", msg); process.exit(1); }
  console.log("  ✓", msg);
}

// 1. list_departments county — grand totals must resolve via the unified predicate
const ld = await call("list_departments", { gov: "county" });
console.log(`  ${ld.departments.length} county depts; top:`, ld.departments[0]);
assert(ld.departments.length >= 30, "county departments listed");
assert(ld.departments.some((d) => d.total > 0), "county depts carry adopted totals");

// 2. get_department_budget county — County Board (no revenues, tax-levy-only)
const cb = await call("get_department_budget", { dept: "County Board", gov: "county" });
console.log("  County Board totals:", cb.totals, "| FTE:", cb.fte);
assert(cb.totals.total_expenditures === 1243016, "County Board 2026 Total Expenditures = 1,243,016");
assert(cb.totals.tax_levy === 1243016, "County Board Tax Levy = Total Expenditures (tax-levy-only)");
assert(cb.citations.length > 0, "County Board budget is cited");

// 3. get_department_budget county — Treasurer (revenue-heavy, negative tax levy)
const tr = await call("get_department_budget", { dept: "Treasurer", gov: "county" });
console.log("  Treasurer totals:", tr.totals);
assert(tr.totals.personnel_costs === 710559, "Treasurer Personnel = 710,559");
assert(tr.totals.total_revenues === 2230000, "Treasurer Total Revenues = 2,230,000");
assert(tr.totals.tax_levy === -1234262, "Treasurer Tax Levy = -1,234,262 (revenue exceeds cost)");
// identity: components sum to Total Expenditures
const t = tr.totals;
assert(t.personnel_costs + t.operations_costs + t.debt_and_depreciation + t.interdepartmental_charges
       === t.total_expenditures, "Treasurer components sum to Total Expenditures");

// 4. budget_breakdown county — per department and countywide
const bb = await call("budget_breakdown", { gov: "county", dept: "County Board" });
console.log("  County Board breakdown:", bb.breakdown, "| total:", bb.total_expenditures);
assert(bb.total_expenditures === 1243016, "breakdown total = Total Expenditures");
assert(Math.abs(bb.breakdown.personnel.pct + bb.breakdown.operations.pct
       + bb.breakdown.debt_and_depreciation.pct + bb.breakdown.interdepartmental_charges.pct - 100) < 0.2,
       "breakdown percentages sum to ~100%");

const bbAll = await call("budget_breakdown", { gov: "county" });
console.log("  countywide total_expenditures:", bbAll.total_expenditures);
assert(bbAll.total_expenditures > 1_000_000_000, "countywide expenditures over $1B");

// 5. compare_years county — grand total across vintages
const cy = await call("compare_years", { dept: "County Board", gov: "county", year_a: 2025, year_b: 2026 });
console.log("  County Board 2025→2026:", cy.grand_total);
assert(cy.grand_total?.fy2025 === 1198763 && cy.grand_total?.fy2026 === 1243016,
       "compare_years county grand totals correct (1,198,763 → 1,243,016)");

// 6. reconciliation_status still reports (city + county)
const rc = await call("reconciliation_status");
console.log("  reconciliation summary:", rc.summary);

await client.close();
console.log("\n✅ county smoke test passed");
process.exit(0);
