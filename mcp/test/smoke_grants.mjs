// Smoke test: federal grants, driven through the real MCP protocol.
// Verifies the loaded data reconciles to USAspending's own anchors AND that the
// award-lifetime columns are never summed. See docs/FEDERAL-GRANTS-DESIGN.md.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts"] });
const client = new Client({ name: "smoke-grants", version: "1.0" });
await client.connect(transport);

let failed = 0;
const check = (name, cond, detail = "") => {
  console.log(cond ? `  ok   ${name}` : `  FAIL ${name} ${detail}`);
  if (!cond) failed++;
};
const call = async (name, args = {}) =>
  JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

const names = (await client.listTools()).tools.map((t) => t.name);
console.log("\n=== registration ===");
for (const t of ["search_grants", "get_top_grant_recipients", "grant_summary"]) {
  check(`${t} registered`, names.includes(t));
}

console.log("\n=== reconciliation: loaded data vs verified anchors ===");
const tot = await call("run_sql", {
  query: "SELECT COUNT(*) n, SUM(obligated) total FROM fact_federal_grant",
});
const n = Number(tot.rows[0].n), sum = Number(tot.rows[0].total);
console.log(`  ${n.toLocaleString()} txns · $${sum.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
check("13,465 transactions", n === 13465, `got ${n}`);
check("$5,150,848,674.55 total", Math.abs(sum - 5150848674.55) < 0.01, `delta ${sum - 5150848674.55}`);

// Per-year anchors, independently verified at acquisition time.
const YEARS = { 2018: 370067217.56, 2019: 412308861.84, 2020: 567911063.20,
                2021: 909965672.21, 2022: 564667956.08, 2023: 689596646.94,
                2024: 666063355.47, 2025: 691699019.28, 2026: 278568881.97 };
const byYear = await call("grant_summary", { group_by: "year" });
for (const b of byYear.buckets) {
  const want = YEARS[Number(b.bucket)];
  check(`FY${b.bucket} = $${want.toLocaleString()}`, Math.abs(b.net_obligated - want) < 0.01,
        `got ${b.net_obligated}`);
}

console.log("\n=== tools + basis ===");
const s = await call("search_grants", { recipient: "MEDICAL COLLEGE", limit: 5 });
check("search_grants returns hits", s.hits > 0);
check("carries comparable_to_budget:false", s.basis?.comparable_to_budget === false);
check("cites award_key + source row", !!s.citations?.[0]?.award_key);

const t = await call("get_top_grant_recipients", { limit: 5 });
check("top recipients returned", t.recipients?.length === 5);
check("sorted desc", t.recipients[0].net_obligated >= t.recipients[4].net_obligated);
check("deobligations exposed separately", t.recipients.every((r) => typeof r.deobligations === "number"));
console.log(`  top recipient: ${t.recipients[0].recipient} — $${Number(t.recipients[0].net_obligated).toLocaleString()}`);

console.log("\n=== guardrail: award-lifetime columns are never summed ===");
// The danger: award_lifetime_* repeats the whole award value on every row.
// Summing it across rows overstates FY2024 by ~10.7x. No tool offers that —
// prove the inflation is real, so the guardrail is protecting against something.
const inflated = await call("run_sql", {
  query: `SELECT SUM(obligated) real_total, SUM(award_lifetime_obligated) inflated
            FROM fact_federal_grant WHERE fiscal_year = 2024`,
});
const real = Number(inflated.rows[0].real_total), infl = Number(inflated.rows[0].inflated);
console.log(`  FY2024 obligated $${real.toLocaleString()} vs lifetime-summed $${infl.toLocaleString()} (${(infl / real).toFixed(1)}x)`);
check("summing award_lifetime IS inflationary (guardrail is load-bearing)", infl > real * 5);

const shapes = JSON.stringify(await call("get_top_grant_recipients", { limit: 1 }));
check("no tool returns an award_lifetime field", !/award_lifetime/i.test(shapes));
const sm = JSON.stringify(await call("grant_summary", { group_by: "agency" }));
check("grant_summary returns no award_lifetime field", !/award_lifetime/i.test(sm));

await client.close();
console.log(failed === 0 ? "\n✅ grants smoke test passed\n" : `\n❌ ${failed} checks failed\n`);
process.exit(failed === 0 ? 0 : 1);
