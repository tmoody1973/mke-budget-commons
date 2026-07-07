// Smoke test: drive the stdio MCP server through the real protocol.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/index.ts"] });
const client = new Client({ name: "smoke", version: "1.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const payload = JSON.parse(r.content[0].text);
  console.log(`\n=== ${name}(${JSON.stringify(args)}) ===`);
  return payload;
}

const rc = await call("reconciliation_status");
console.log("  summary:", rc.summary, "| findings:", rc.findings.length);

const ld = await call("list_departments", { gov: "city" });
console.log(`  ${ld.departments.length} depts; top:`, ld.departments[0]);

const dept = await call("get_department_budget", { dept: "Fire Department" });
console.log("  Fire totals:", dept.totals, "| divisions:", dept.divisions.length, "| citations:", dept.citations.length);

const search = await call("search_line_items", { query: "librarian", limit: 3 });
console.log(`  ${search.hits} hits; e.g.`, search.results[0]);

const pos = await call("get_positions", { dept: "City Attorney" });
console.log(`  ${pos.position_rows} positions, ${pos.total_units} FTE; e.g.`, pos.positions[0]);

const cited = await call("cite", { line_id: search.results[0].line_id });
console.log("  cite:", cited.citation);

const guard = await call("run_sql", { query: "DELETE FROM fact_budget_line" });
console.log("  run_sql(DELETE) →", guard.error);

const sql = await call("run_sql", { query: "SELECT count(*) AS n FROM fact_budget_line" });
console.log("  run_sql(SELECT count) →", sql.rows);

await client.close();
console.log("\n✅ smoke test passed");
process.exit(0);
