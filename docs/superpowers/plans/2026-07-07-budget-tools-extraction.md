# @mke/budget-tools Extraction — Implementation Plan (Prep PR)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the query logic from `mcp/src/index.ts` into a shared `@mke/budget-tools` workspace package that both the MCP server and (later) the budget-agent CopilotKit actions import — with **zero behavior change to the L3 contract**, proven by the existing smoke tests staying green.

**Architecture:** Introduce an npm workspace at the repo root. Move the DB pool, citation helpers, shared query helpers, glossary, and all 16 tools' *query logic* into `packages/budget-tools/src/` as plain exported async functions that return payload objects (or throw `Error`). `mcp/src/index.ts` becomes a thin adapter: it imports those functions and the shared Zod input shapes, and wraps each in the MCP `ok`/`fail` envelope via one `wrap()` helper. Add two net-new capabilities the agent needs: `describeSchema()` and a standalone `runSql()`.

**Tech Stack:** TypeScript (ES2022, ESNext modules, `moduleResolution: Bundler`), run directly via `tsx` (no build step), `pg`, `zod`, `dotenv`, Node's built-in `node:test` runner, npm workspaces (npm 11 / Node 26).

## Global Constraints

- **Read-only, always.** Every query goes through the `mcp_ro` pool in `db.ts`; `run_sql` stays behind `guardSelect` (SELECT/WITH only, deny-list, catalog block, auto-LIMIT). Never add a write path.
- **Provenance preserved.** Every function that returns figures must keep selecting `doc_id` + `source_page` and shaping them through `citations()`. No result loses its citations.
- **No behavior change.** This is a pure refactor. The **MCP smoke tests are the characterization tests** — `make mcp-test` must pass identically before and after every task. If a smoke assertion changes, the refactor is wrong; fix the code, not the test.
- **ESM + tsx, no build.** All packages use `"type": "module"`, `.ts` sources imported via `tsx`. No `tsc` emit; typecheck is `tsc --noEmit`.
- **Workspace tool = npm (Decision D1).** Root `package.json` `workspaces` field. If the user flips this to pnpm before execution, replace `npm install`→`pnpm install`, the `workspaces` array→`pnpm-workspace.yaml`, and `"@mke/budget-tools": "*"`→`"workspace:*"`. Nothing else changes.
- **Fail-mapping rule (applies to every extracted function):** a handler's `return fail("msg")` becomes `throw new Error("msg")`; a `return ok({ambiguous:true,…})` becomes `return {ambiguous:true,…}` (it is a success payload); a `return ok(payload)` becomes `return payload`.

---

## File Structure

**New:**
- `package.json` (repo root) — private, npm workspaces (`packages/*`, `mcp`, `apps/*`).
- `packages/budget-tools/package.json`, `packages/budget-tools/tsconfig.json`
- `packages/budget-tools/src/db.ts` — moved verbatim from `mcp/src/db.ts` (dotenv path fixed). Exports `pool`, `query`, `guardSelect`.
- `packages/budget-tools/src/glossary.ts` — moved verbatim from `mcp/src/glossary.ts`. Exports `GLOSSARY`, `GlossaryEntry`, `lookupGlossary`.
- `packages/budget-tools/src/citation.ts` — `num`, `citations` (moved from `index.ts`), `Citation` type.
- `packages/budget-tools/src/helpers.ts` — `Gov` type + shared query helpers moved from `index.ts`.
- `packages/budget-tools/src/schema.ts` — **new** `describeSchema()`.
- `packages/budget-tools/src/schemas.ts` — Zod input shapes (one per tool) + inferred input types, moved from the `inputSchema` blocks in `index.ts`.
- `packages/budget-tools/src/queries/departments.ts` — `listDepartments`, `getDepartmentBudget` (+ internal `countyDeptBudget`, `mpsSchoolBudget`).
- `packages/budget-tools/src/queries/breakdown.ts` — `budgetBreakdown` (+ internal `budgetBreakdownCounty`, `budgetBreakdownMps`).
- `packages/budget-tools/src/queries/compare.ts` — `compareYears`, `traceAdoption`, `biggestChanges`.
- `packages/budget-tools/src/queries/positions.ts` — `getPositions`, `findPositions`.
- `packages/budget-tools/src/queries/schools.ts` — `compareSchools`, `mpsFundSummary`, `perPupilRanking`.
- `packages/budget-tools/src/queries/search.ts` — `searchLineItems`, `cite`, `reconciliationStatus`, `glossaryLookup`, `runSql`, `getAmendments`.
- `packages/budget-tools/src/index.ts` — barrel: re-export everything above.
- `packages/budget-tools/test/*.test.ts` — `node:test` integration tests against the read-only DB.

**Modified:**
- `mcp/src/index.ts` — becomes a thin adapter (imports + `wrap` + `registerTool` calls). ~870 → ~260 lines.
- `mcp/package.json` — add `"@mke/budget-tools": "*"` dependency; drop now-shared deps it no longer imports directly (keep `@modelcontextprotocol/sdk`, `zod`, `tsx`, TS/types).
- `Makefile` — add `tools-test` (unit) target; keep `mcp-test` (smoke).
- `mcp/README.md` — note the shared package.

**Deleted:**
- `mcp/src/db.ts`, `mcp/src/glossary.ts` (moved into the package).

---

## Extraction Procedure (the mechanical pattern used by Tasks 3–5)

Each of Tasks 3–5 moves one or more tool families. The procedure per family is identical; each task below only supplies its **specifics** (functions, source line ranges, fail→throw conversions). The steps:

1. Create `packages/budget-tools/src/queries/<family>.ts`. **Move** the named functions from `mcp/src/index.ts` (exact source line ranges given per task) into it, converting each `server.registerTool(...)` inline handler into a standalone exported `async function` whose body is the handler body with the **Fail-mapping rule** applied. Internal helpers (e.g. `countyDeptBudget`) move as non-exported module functions in the same file. Replace `import`-implicit references (`query`, `guardSelect`, `citations`, `num`, `resolveDept`, `grandTotalPred`, etc.) with imports from `../db.js`, `../citation.js`, `../helpers.js`.
2. Add the family's functions to the barrel `packages/budget-tools/src/index.ts`.
3. In `mcp/src/index.ts`: delete the moved code; import the new functions and the family's input shapes; register each tool as `server.registerTool(name, { title, description, inputSchema: <shape> }, async (a) => wrap(() => <fn>(a)))`.
4. Verify: `npm run -w mcp typecheck` (clean) and `make mcp-test` (all three smoke scripts green, output unchanged).
5. Commit.

---

## Task 1: Workspace root + shared foundation (db, glossary, citation, helpers)

Stand up the workspace and move the shared, tool-independent code. After this task `mcp/` imports its foundation from `@mke/budget-tools` and smoke tests still pass — proving the workspace wiring works before any tool moves.

**Files:**
- Create: `package.json` (root), `packages/budget-tools/package.json`, `packages/budget-tools/tsconfig.json`, `packages/budget-tools/src/db.ts`, `packages/budget-tools/src/glossary.ts`, `packages/budget-tools/src/citation.ts`, `packages/budget-tools/src/helpers.ts`, `packages/budget-tools/src/index.ts`
- Modify: `mcp/package.json`, `mcp/src/index.ts:1-56` (imports + delete moved helpers)
- Delete: `mcp/src/db.ts`, `mcp/src/glossary.ts`

**Interfaces:**
- Produces:
  - `db.ts`: `pool: pg.Pool`, `query<T=any>(sql: string, params?: any[]): Promise<T[]>`, `guardSelect(raw: string, limit?: number): string`
  - `glossary.ts`: `type GlossaryEntry = { term: string; kind: string; plain: string }`, `GLOSSARY: GlossaryEntry[]`, `lookupGlossary(term?: string): unknown`
  - `citation.ts`: `type Citation = { doc_id: string; source_page: number }`, `num(v: any): number | null`, `citations(rows: any[]): Citation[]`
  - `helpers.ts`: `type Gov = "city" | "county" | "mps"`, `resolveDept(gov: string, name: string): Promise<{ dept_id: string; canonical_name: string }[]>`, `grandTotalPred(p?: string): string`, `deptYear(dept_id: string, year: number, gov?: string): Promise<{ a: any; cites: any[] }>`, `pct(from: number|null, to: number|null): number|null`, and the constants `VINTAGE: Record<string,string>`, `YEAR_KIND: Record<number,string>`, `ROLLUP_EXCLUDE: string[]`, `STAGE_ORDER: string[]`

- [ ] **Step 1: Create the workspace root `package.json`**

Create `package.json` at the repo root:

```json
{
  "name": "mke-budget-commons",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["packages/*", "mcp", "apps/*"],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create the `@mke/budget-tools` package manifest**

Create `packages/budget-tools/package.json`:

```json
{
  "name": "@mke/budget-tools",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Shared read-only, cited query layer over the reconciled Milwaukee budget (Neon). Imported by the MCP server and the budget-agent CopilotKit actions.",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test \"test/*.test.ts\""
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "pg": "^8.13.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 3: Create the package `tsconfig.json`**

Create `packages/budget-tools/tsconfig.json` (mirrors `mcp/tsconfig.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Move `db.ts` into the package, fixing the `.env` path**

Move `mcp/src/db.ts` → `packages/budget-tools/src/db.ts`. The file is identical **except** the dotenv path: from `packages/budget-tools/src/`, the repo root `.env` is three levels up. Change line 8 from `resolve(__dirname, "../../.env")` to `resolve(__dirname, "../../../.env")`. Full resulting file:

```typescript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const url = process.env.MCP_DATABASE_URL;
if (!url) {
  console.error(
    "MCP_DATABASE_URL not set. Run `make load-neon` to build the DB and write it to .env.",
  );
  process.exit(1);
}

// Read-only pool. The mcp_ro role is SELECT-only at the database level; the
// guards below are defense in depth for the run_sql escape hatch.
export const pool = new pg.Pool({ connectionString: url, max: 4 });

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("SET statement_timeout = 5000");
    const res = await client.query(sql, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

const DENY = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|merge|pg_read_file|pg_ls_dir)\b/i;
const CATALOG = /\b(pg_catalog|pg_authid|pg_shadow|information_schema|pg_roles|pg_user)\b/i;

/** Validate + shape a user query for the run_sql escape hatch. */
export function guardSelect(raw: string, limit = 200): string {
  let sql = raw.trim().replace(/;+\s*$/, "");
  if (sql.includes(";")) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(sql)) throw new Error("Only SELECT / WITH queries are allowed.");
  if (DENY.test(sql)) throw new Error("Query contains a disallowed keyword (read-only).");
  if (CATALOG.test(sql)) throw new Error("System catalogs are not accessible.");
  if (!/\blimit\s+\d+/i.test(sql)) sql = `${sql} LIMIT ${limit}`;
  return sql;
}
```

Note: `readFileSync` is imported but unused in the original too; leave it as-is to keep the move verbatim (behavior-preserving). Delete `mcp/src/db.ts`.

- [ ] **Step 5: Move `glossary.ts` into the package**

`git mv mcp/src/glossary.ts packages/budget-tools/src/glossary.ts` — no content changes (it's self-contained reference data + `lookupGlossary`). Delete the original.

- [ ] **Step 6: Create `citation.ts` (moved from `index.ts:17-29`)**

Create `packages/budget-tools/src/citation.ts` with the `citations` and `num` helpers currently at `mcp/src/index.ts:17-29`:

```typescript
export type Citation = { doc_id: string; source_page: number };

/** distinct {doc_id, source_page} across result rows */
export function citations(rows: any[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const r of rows) {
    if (r.doc_id == null || r.source_page == null) continue;
    const k = `${r.doc_id}:${r.source_page}`;
    if (!seen.has(k)) { seen.add(k); out.push({ doc_id: r.doc_id, source_page: r.source_page }); }
  }
  return out.slice(0, 25);
}

export const num = (v: any): number | null => (v == null ? null : Number(v));
```

- [ ] **Step 7: Create `helpers.ts` (moved from `index.ts`)**

Create `packages/budget-tools/src/helpers.ts`. Move these exact blocks from `mcp/src/index.ts`, adding `export` and importing `query` from `./db.js`:
- `resolveDept` (lines 31-41)
- `VINTAGE` (lines 43-46)
- `grandTotalPred` (lines 53-55)
- `deptYear` (lines 317-343)
- `pct` (lines 345-346)
- `YEAR_KIND` (line 498)
- `ROLLUP_EXCLUDE` (lines 501-505)
- `STAGE_ORDER` (line 456)

Add at the top: `import { query } from "./db.js";` and `export type Gov = "city" | "county" | "mps";`. Add `export` to each moved binding. `deptYear` references `grandTotalPred` (same file) — fine. `pct` and `num`: `deptYear` uses `query` only; `pct` is standalone. (`num` lives in `citation.ts`; if any helper here needs it, import it: `import { num } from "./citation.js";` — `deptYear` does **not** use `num`, so no import needed.)

- [ ] **Step 8: Create the barrel `index.ts`**

Create `packages/budget-tools/src/index.ts`:

```typescript
export * from "./db.js";
export * from "./glossary.js";
export * from "./citation.js";
export * from "./helpers.js";
```

(Query modules and `schema.ts` are added to this barrel in later tasks.)

- [ ] **Step 9: Point `mcp/` at the package**

Edit `mcp/package.json` dependencies: add `"@mke/budget-tools": "*"`. Then edit `mcp/src/index.ts`:
- Replace `import { query, guardSelect } from "./db.js";` and `import { lookupGlossary } from "./glossary.js";` (lines 4-5) with:
  ```typescript
  import { query, guardSelect, lookupGlossary, citations, num, resolveDept, VINTAGE, grandTotalPred, deptYear, pct, YEAR_KIND, ROLLUP_EXCLUDE, STAGE_ORDER, type Gov } from "@mke/budget-tools";
  ```
- Delete the now-duplicated local definitions from `index.ts`: `citations` (17-27), `num` (29), `resolveDept` (31-41), `VINTAGE` (43-46), `grandTotalPred` (53-55), `deptYear` (317-343), `pct` (345-346), `STAGE_ORDER` (456), `YEAR_KIND` (498), `ROLLUP_EXCLUDE` (501-505). Keep everything else (the `ok`/`fail` helpers and all `registerTool` calls) untouched for now — they still reference the imported names.

- [ ] **Step 10: Install and link the workspace**

Run: `npm install` (from repo root)
Expected: completes without error; `ls -la mcp/node_modules/@mke/budget-tools` shows a symlink into `../../packages/budget-tools`.

- [ ] **Step 11: Typecheck both packages**

Run: `npm run typecheck --workspaces --if-present`
Expected: `@mke/budget-tools` and `mke-budget-mcp` both report no errors.

- [ ] **Step 12: Run the smoke tests (characterization gate)**

Run: `make mcp-test`
Expected: all three scripts print their `✅ ... passed` lines; `smoke.mjs` still prints `TOOLS: reconciliation_status, list_departments, …` (16 tools + `get_amendments`) and the Fire/City-Attorney/librarian assertions succeed. Output must match pre-refactor.

- [ ] **Step 13: Commit**

```bash
git add package.json packages/budget-tools mcp/package.json mcp/src/index.ts package-lock.json
git rm mcp/src/db.ts mcp/src/glossary.ts
git commit -m "refactor: workspace + @mke/budget-tools foundation (db, glossary, citation, helpers)"
```

---

## Task 2: New capabilities — `describeSchema()` + standalone `runSql()`

Add the two functions the budget-agent needs that don't exist yet, and re-point the MCP `run_sql` tool at the shared `runSql`. `describeSchema` is a curated static description (semantics the model needs; no DB round-trip, and it must **not** touch `information_schema` — which `guardSelect` blocks anyway).

**Files:**
- Create: `packages/budget-tools/src/schema.ts`, `packages/budget-tools/src/queries/search.ts` (partial — only `runSql` now; the rest is added in Task 5), `packages/budget-tools/test/sql.test.ts`
- Modify: `packages/budget-tools/src/index.ts` (barrel), `mcp/src/index.ts` (run_sql handler, lines 295-312)

**Interfaces:**
- Produces:
  - `schema.ts`: `type TableSchema = { table: string; purpose: string; columns: Record<string,string>; notes?: string }`, `describeSchema(): { tables: TableSchema[]; enums: Record<string,string[]> }`
  - `queries/search.ts` (this task): `runSql(a: { query: string; limit?: number }): Promise<{ sql: string; row_count: number; rows: any[] }>` — throws `Error` from `guardSelect`, or `Error("Query failed: …")` on execution error.

- [ ] **Step 1: Write the failing test for `runSql`**

Create `packages/budget-tools/test/sql.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run -w @mke/budget-tools test`
Expected: FAIL — `runSql` is not exported yet (import error / "runSql is not a function").

- [ ] **Step 3: Implement `runSql` in `queries/search.ts`**

Create `packages/budget-tools/src/queries/search.ts` with just `runSql` for now (the other search-family functions are added in Task 5):

```typescript
import { query, guardSelect } from "../db.js";

export async function runSql(a: { query: string; limit?: number }): Promise<{ sql: string; row_count: number; rows: any[] }> {
  const sql = guardSelect(a.query, a.limit ?? 200); // throws on invalid input
  try {
    const rows = await query(sql);
    return { sql, row_count: rows.length, rows };
  } catch (e: any) {
    throw new Error(`Query failed: ${e.message}`);
  }
}
```

- [ ] **Step 4: Implement `describeSchema` in `schema.ts`**

Create `packages/budget-tools/src/schema.ts`. This is curated from the real columns used across the tools (verified against `mcp/src/index.ts` SQL):

```typescript
export type TableSchema = { table: string; purpose: string; columns: Record<string, string>; notes?: string };

/**
 * Curated schema for the SQL-writing model. Static (no DB round-trip) so it can
 * describe *semantics*, not just types. Never queries information_schema (which
 * guardSelect blocks). Column set verified against the live tool queries.
 */
export function describeSchema(): { tables: TableSchema[]; enums: Record<string, string[]> } {
  return {
    tables: [
      {
        table: "fact_budget_line",
        purpose: "The canonical ledger. One row per extracted budget line, across all three governments and all vintages. The main fact table.",
        columns: {
          line_id: "bigint PK — natural per-row id; the argument to the cite tool.",
          dept_id: "FK → dim_department.dept_id.",
          doc_id: "FK → dim_document.doc_id (provenance).",
          fiscal_year: "int — the fiscal year this row's amount belongs to.",
          amount_kind: "vintage of the amount (see enums.amount_kind).",
          line_kind: "row type (see enums.line_kind).",
          account: "reserved account code ('006000' salaries, '006100' fringe, '006300' operating, '006800' equipment) or NULL for grand-total/category rows.",
          line_description: "printed description / title / object / category name.",
          division: "sub-unit (city division / county strategic program area / MPS Sch-Dept).",
          amount: "numeric dollars (may be NULL for position/fte rows).",
          units: "FTE count (position/fte rows).",
          pay_range: "salary-grade code for position rows (e.g. 2TX).",
          flags: "text[] of footnote codes on a title.",
          fund: "fund letter (MPS = account segment 2; city/county fund).",
          source_page: "1-based page in source_doc (provenance).",
          search: "tsvector over line_description — use plainto_tsquery('english', …).",
        },
        notes: "City/county department grand totals are the row where line_kind='total' AND account IS NULL, OR (county) line_kind='category' AND line_description='Total Expenditures'. MPS has no printed per-unit total — SUM the line_kind='expenditure' rows.",
      },
      {
        table: "fact_school",
        purpose: "MPS per-school crosswalk: enrollment, school-controlled budget, FTE, and computed per-pupil.",
        columns: {
          school_name: "school name.",
          enrollment: "projected enrollment (denominator for per-pupil).",
          budget: "school-controlled budget dollars.",
          fte: "staffing FTE.",
          per_pupil: "budget ÷ enrollment (precomputed).",
          fiscal_year: "int fiscal year.",
          doc_id: "FK → dim_document (provenance).",
          source_page: "1-based page (provenance).",
        },
        notes: "School budgets exclude central/districtwide costs. Tiny specialty schools have small denominators — filter by enrollment for comprehensive-school comparisons.",
      },
      {
        table: "dim_department",
        purpose: "Department/school/office dimension.",
        columns: {
          dept_id: "PK (slug).",
          canonical_name: "display name.",
          gov_id: "government (see enums.gov_id).",
        },
      },
      {
        table: "dept_alias",
        purpose: "Alternate printed names for departments (for name resolution).",
        columns: { dept_id: "FK → dim_department.", printed_name: "an alias as printed in a document." },
      },
      {
        table: "dim_document",
        purpose: "Source-document dimension (provenance target).",
        columns: {
          doc_id: "PK.",
          source_url: "document URL.",
          fiscal_year: "int.",
          doc_type: "e.g. adopted / requested / operating / proposed.",
        },
      },
      {
        table: "dim_government",
        purpose: "Government dimension.",
        columns: { gov_id: "PK: 'city' | 'county' | 'mps'." },
      },
      {
        table: "reconciliation_result",
        purpose: "Trust report: how extracted totals reconcile to each document's printed totals, with dispositions.",
        columns: {
          doc_id: "FK → dim_document.",
          scope: "what was reconciled (department/section).",
          printed_total: "the document's own printed total.",
          extracted_total: "the sum of extracted line items.",
          status: "reconciled | source_inconsistency | open | not_reconcilable.",
          notes: "disposition narrative.",
        },
      },
    ],
    enums: {
      gov_id: ["city", "county", "mps"],
      amount_kind: ["actual", "budget", "adopted", "requested", "proposed", "recommended"],
      line_kind: ["total", "category", "program", "fte", "position", "expenditure", "revenue"],
      reserved_account: ["006000", "006100", "006300", "006800"],
    },
  };
}
```

- [ ] **Step 5: Add both to the barrel**

Edit `packages/budget-tools/src/index.ts`, append:

```typescript
export * from "./schema.js";
export * from "./queries/search.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run -w @mke/budget-tools test`
Expected: both `sql.test.ts` tests PASS. (Requires `.env` with `MCP_DATABASE_URL` — the read-only Neon DB.)

- [ ] **Step 7: Re-point the MCP `run_sql` tool at the shared `runSql`**

In `mcp/src/index.ts`, replace the `run_sql` handler body (lines 302-311) so it delegates to the shared function while preserving the exact envelope. Also add `runSql`, `describeSchema` to the import from `@mke/budget-tools`. New handler:

```typescript
  async ({ query: raw, limit }) => {
    try {
      return ok(await runSql({ query: raw, limit }));
    } catch (e: any) {
      return fail(e.message);
    }
  },
```

Leave the `run_sql` `title`/`description`/`inputSchema` unchanged. (A `describe_schema` MCP tool is **not** added here — Phase 1 of the app consumes `describeSchema()` directly; exposing it over MCP is deferred to keep this PR contract-neutral.)

- [ ] **Step 8: Typecheck + smoke gate**

Run: `npm run typecheck --workspaces --if-present && make mcp-test`
Expected: clean typecheck; smoke green. `smoke.mjs`'s `run_sql(DELETE)` still returns the guard error and `run_sql(SELECT count)` still returns a row count — identical to before.

- [ ] **Step 9: Commit**

```bash
git add packages/budget-tools mcp/src/index.ts
git commit -m "feat: describeSchema() + shared runSql(); re-point MCP run_sql at the shared layer"
```

---

## Task 3: Extract the departments + breakdown families

Apply the **Extraction Procedure** to the two families with the most shared-helper coupling.

**Files:**
- Create: `packages/budget-tools/src/queries/departments.ts`, `packages/budget-tools/src/queries/breakdown.ts`, `packages/budget-tools/src/schemas.ts` (started here), `packages/budget-tools/test/departments.test.ts`
- Modify: `packages/budget-tools/src/index.ts`, `mcp/src/index.ts`

**Interfaces:**
- Consumes (from `@mke/budget-tools`): `query`, `citations`, `num`, `resolveDept`, `VINTAGE`, `grandTotalPred`, `ROLLUP_EXCLUDE`, `type Gov`.
- Produces:
  - `departments.ts`: `listDepartments(a: { gov: Gov; fiscal_year?: number }): Promise<{ government: string; total_label: string; departments: {dept_id:string;name:string;total:number|null}[] }>`; `getDepartmentBudget(a: { dept: string; gov: Gov; fiscal_year?: number; doc_type?: string }): Promise<any>` (throws `Error("No department matches \"…\".")`; returns `{ambiguous:true,candidates}` when >1).
  - `breakdown.ts`: `budgetBreakdown(a: { gov: Gov; fiscal_year?: number; dept?: string }): Promise<any>` (throws on no-match / no-total; returns `{ambiguous…}` when >1).
  - `schemas.ts`: exported Zod raw shapes `listDepartmentsShape`, `getDepartmentBudgetShape`, `budgetBreakdownShape` (see the shapes table at the end of this plan).

- [ ] **Step 1: Move the departments family**

Create `packages/budget-tools/src/queries/departments.ts`. Move from `mcp/src/index.ts`:
- the `list_departments` handler body (58-94) → `export async function listDepartments(a)` (destructure `{ gov, fiscal_year }` from `a`), `return {…}` instead of `ok({…})`.
- the `get_department_budget` handler body (96-164) → `export async function getDepartmentBudget(a)`. Convert: line 108 `return fail(...)` → `throw new Error('No department matches "' + a.dept + '".');` line 109 `return ok({ ambiguous… })` → `return { ambiguous: true, candidates: cands };` line 117/120 `return ok(await countyDeptBudget…)` → `return countyDeptBudget(...)` / `return mpsSchoolBudget(...)` and the final `return ok({…})` → `return {…}`.
- `mpsSchoolBudget` (350-381) and `countyDeptBudget` (386-422) → non-exported functions in this file.

Add imports:
```typescript
import { query } from "../db.js";
import { citations, num } from "../citation.js";
import { resolveDept, VINTAGE, grandTotalPred, type Gov } from "../helpers.js";
```

- [ ] **Step 2: Move the breakdown family**

Create `packages/budget-tools/src/queries/breakdown.ts`. Move:
- `budgetBreakdownCounty` (522-560) and `budgetBreakdownMps` (564-596) → non-exported functions, **converting their internal `return fail(x)` → `throw new Error(x)` and `return ok(y)` → `return y`** (they currently return MCP envelopes).
- the `budget_breakdown` handler (598-657) → `export async function budgetBreakdown(a)`, same fail→throw / ok→return conversion; the `if (gov === "county") return budgetBreakdownCounty(...)` lines now return plain payloads.

Imports:
```typescript
import { query } from "../db.js";
import { num } from "../citation.js";
import { resolveDept, grandTotalPred, ROLLUP_EXCLUDE, type Gov } from "../helpers.js";
```
(Note: `budgetBreakdownCounty`/`Mps` do not use `citations`; `budgetBreakdown` city path does not either — it returns computed parts, no `citations` call. Verified against source.)

- [ ] **Step 3: Start `schemas.ts` with these three shapes**

Create `packages/budget-tools/src/schemas.ts` with (exact fields copied from the current `inputSchema` blocks):

```typescript
import { z } from "zod";

const gov = () => z.enum(["city", "county", "mps"]);

export const listDepartmentsShape = { gov: gov().default("city"), fiscal_year: z.number().int().optional() };
export const getDepartmentBudgetShape = { dept: z.string(), gov: gov().default("city"), fiscal_year: z.number().int().optional(), doc_type: z.string().default("adopted") };
export const budgetBreakdownShape = { gov: gov().default("city"), fiscal_year: z.number().int().optional(), dept: z.string().optional() };
```

- [ ] **Step 4: Barrel + MCP re-wire**

Append to `packages/budget-tools/src/index.ts`:
```typescript
export * from "./queries/departments.js";
export * from "./queries/breakdown.js";
export * from "./schemas.js";
```
In `mcp/src/index.ts`: delete the moved handler/function bodies; import `listDepartments, getDepartmentBudget, budgetBreakdown, listDepartmentsShape, getDepartmentBudgetShape, budgetBreakdownShape`; register each, e.g.:
```typescript
server.registerTool("list_departments",
  { title: "List departments", description: "Departments for a government with their adopted grand totals.", inputSchema: listDepartmentsShape },
  async (a) => wrap(() => listDepartments(a)));
```
Add the `wrap` helper near `ok`/`fail` (if not already added):
```typescript
const wrap = async (fn: () => Promise<unknown>) => {
  try { return ok(await fn()); } catch (e: any) { return fail(e.message); }
};
```
(Register `get_department_budget` and `budget_breakdown` the same way with their titles/descriptions copied verbatim from the original registrations.)

- [ ] **Step 5: Write an integration test for the departments family**

Create `packages/budget-tools/test/departments.test.ts`:

```typescript
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
```

- [ ] **Step 6: Verify (unit + typecheck + smoke)**

Run: `npm run -w @mke/budget-tools test && npm run typecheck --workspaces --if-present && make mcp-test`
Expected: departments tests PASS; typecheck clean; smoke green (Fire totals + list_departments assertions unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/budget-tools mcp/src/index.ts
git commit -m "refactor: extract departments + breakdown families into @mke/budget-tools"
```

---

## Task 4: Extract the compare + positions families

Apply the Extraction Procedure.

**Files:**
- Create: `packages/budget-tools/src/queries/compare.ts`, `packages/budget-tools/src/queries/positions.ts`, `packages/budget-tools/test/compare.test.ts`
- Modify: `packages/budget-tools/src/schemas.ts`, `packages/budget-tools/src/index.ts`, `mcp/src/index.ts`

**Interfaces:**
- Consumes: `query`, `citations`, `num`, `resolveDept`, `grandTotalPred`, `deptYear`, `pct`, `YEAR_KIND`, `STAGE_ORDER`, `type Gov`.
- Produces:
  - `compare.ts`: `compareYears(a: { dept: string; year_a: number; year_b: number; gov: Gov }): Promise<any>` (throws on no-match / missing-year data; `{ambiguous…}` when >1); `traceAdoption(a: { dept: string; fiscal_year: number; gov: Gov }): Promise<any>` (throws on no-match; `{ambiguous…}`); `biggestChanges(a: { gov: Gov; year_a: number; year_b: number; measure: "dollars"|"percent"; direction: "up"|"down"|"both"; limit: number }): Promise<any>`.
  - `positions.ts`: `getPositions(a: { dept: string; gov: Gov; fiscal_year?: number }): Promise<any>` (throws on no-match; `{ambiguous…}`); `findPositions(a: { query?: string; gov: Gov; fiscal_year: number; min_salary?: number; flag?: string; limit: number }): Promise<any>`.
  - `schemas.ts`: `compareYearsShape`, `traceAdoptionShape`, `biggestChangesShape`, `getPositionsShape`, `findPositionsShape`.

- [ ] **Step 1: Move the compare family**

Create `packages/budget-tools/src/queries/compare.ts`. Move `compare_years` (424-454), `trace_adoption` (458-494), `biggest_changes` (659-708) handler bodies → exported functions, applying the Fail-mapping rule (`compare_years` has two `fail` cases at 436 and 440-441; `trace_adoption` at 470; convert both to `throw`). Imports:
```typescript
import { query } from "../db.js";
import { citations, num } from "../citation.js";
import { resolveDept, grandTotalPred, deptYear, pct, STAGE_ORDER, type Gov } from "../helpers.js";
```

- [ ] **Step 2: Move the positions family**

Create `packages/budget-tools/src/queries/positions.ts`. Move `get_positions` (207-236, note it destructures only `{ dept, gov }`) and `find_positions` (710-750) → exported functions; `get_positions` `fail` at 219 → `throw`. Imports:
```typescript
import { query } from "../db.js";
import { citations, num } from "../citation.js";
import { resolveDept, YEAR_KIND, type Gov } from "../helpers.js";
```

- [ ] **Step 3: Add the shapes**

Append to `packages/budget-tools/src/schemas.ts` (fields copied verbatim from the originals):

```typescript
export const compareYearsShape = { dept: z.string(), year_a: z.number().int(), year_b: z.number().int(), gov: gov().default("city") };
export const traceAdoptionShape = { dept: z.string(), fiscal_year: z.number().int(), gov: gov().default("city") };
export const biggestChangesShape = { gov: gov().default("city"), year_a: z.number().int(), year_b: z.number().int(), measure: z.enum(["dollars", "percent"]).default("dollars"), direction: z.enum(["up", "down", "both"]).default("both"), limit: z.number().int().max(40).default(12) };
export const getPositionsShape = { dept: z.string(), gov: gov().default("city"), fiscal_year: z.number().int().default(2026) };
export const findPositionsShape = { query: z.string().optional(), gov: gov().default("city"), fiscal_year: z.number().int().default(2026), min_salary: z.number().optional(), flag: z.string().optional(), limit: z.number().int().max(50).default(25) };
```

- [ ] **Step 4: Barrel + MCP re-wire**

Append the two query modules to the barrel. In `mcp/src/index.ts`, delete the moved bodies; import the five functions + five shapes; register all five via `wrap` with titles/descriptions copied verbatim.

- [ ] **Step 5: Write the compare integration test**

Create `packages/budget-tools/test/compare.test.ts`:

```typescript
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
```

- [ ] **Step 6: Verify**

Run: `npm run -w @mke/budget-tools test && npm run typecheck --workspaces --if-present && make mcp-test`
Expected: all unit tests PASS; typecheck clean; smoke green.

- [ ] **Step 7: Commit**

```bash
git add packages/budget-tools mcp/src/index.ts
git commit -m "refactor: extract compare + positions families into @mke/budget-tools"
```

---

## Task 5: Extract the schools + search/misc families (completes the extraction)

Apply the Extraction Procedure to the remaining tools. After this, `mcp/src/index.ts` holds only imports, `ok`/`fail`/`wrap`, the `registerTool` calls, the `get_amendments` loop, and the transport bootstrap.

**Files:**
- Create: `packages/budget-tools/src/queries/schools.ts`, `packages/budget-tools/test/schools.test.ts`
- Modify: `packages/budget-tools/src/queries/search.ts` (add the rest of the family), `packages/budget-tools/src/schemas.ts`, `packages/budget-tools/src/index.ts`, `mcp/src/index.ts`

**Interfaces:**
- Consumes: `query`, `guardSelect`, `citations`, `num`, `resolveDept`, `pct`, `lookupGlossary`, `type Gov`.
- Produces:
  - `search.ts` (added): `searchLineItems(a: { query: string; gov?: Gov; fiscal_year?: number; limit: number }): Promise<any>`; `cite(a: { line_id: number }): Promise<any>` (throws `Error("No line with id …")`); `reconciliationStatus(a: { doc_id?: string }): Promise<any>`; `glossaryLookup(a: { term?: string }): unknown`; `getAmendments(): Promise<{ available: false; reason: string }>`. (`runSql` already present from Task 2.)
  - `schools.ts`: `compareSchools(a: { school_a: string; school_b: string; fiscal_year: number }): Promise<any>`; `mpsFundSummary(a: { fiscal_year: number }): Promise<any>`; `perPupilRanking(a: { fiscal_year: number; order: "highest"|"lowest"; min_enrollment: number; limit: number }): Promise<any>`.
  - `schemas.ts`: `searchLineItemsShape`, `citeShape`, `reconciliationStatusShape`, `glossaryShape`, `runSqlShape`, `compareSchoolsShape`, `mpsFundSummaryShape`, `perPupilRankingShape`.

- [ ] **Step 1: Complete `queries/search.ts`**

Add to the existing `packages/budget-tools/src/queries/search.ts` (which currently holds `runSql`):
- `search_line_items` handler (166-205) → `searchLineItems(a)`.
- `cite` handler (238-262) → `cite(a)`; `fail` at 252 → `throw`.
- `reconciliation_status` handler (264-293) → `reconciliationStatus(a)`.
- `glossary` handler (507-515) → `export function glossaryLookup(a: { term?: string }) { return lookupGlossary(a.term); }`.
- the `get_amendments` roadmap stub (857-866) → `export async function getAmendments() { return { available: false as const, reason: "Requires the amendment (file/markup) documents; not yet ingested." }; }`.

Extend imports:
```typescript
import { query, guardSelect } from "../db.js";
import { citations, num } from "../citation.js";
import { lookupGlossary, type Gov } from "../helpers.js"; // NOTE: lookupGlossary is re-exported by helpers? No — import from ../glossary.js
```
Correction — import `lookupGlossary` from `../glossary.js` and `Gov` from `../helpers.js`:
```typescript
import { query, guardSelect } from "../db.js";
import { citations, num } from "../citation.js";
import { type Gov } from "../helpers.js";
import { lookupGlossary } from "../glossary.js";
```

- [ ] **Step 2: Move the schools family**

Create `packages/budget-tools/src/queries/schools.ts`. Move `compare_schools` (754-784), `mps_fund_summary` (786-816), `per_pupil_ranking` (818-855) → exported functions. `compare_schools`'s inner `side()` returns inline error/ambiguous objects (not `fail`) — keep as-is. Imports:
```typescript
import { query } from "../db.js";
import { citations, num } from "../citation.js";
import { resolveDept, pct } from "../helpers.js";
```

- [ ] **Step 3: Add the remaining shapes**

Append to `packages/budget-tools/src/schemas.ts`:

```typescript
export const searchLineItemsShape = { query: z.string(), gov: gov().optional(), fiscal_year: z.number().int().optional(), limit: z.number().int().max(50).default(20) };
export const citeShape = { line_id: z.number().int() };
export const reconciliationStatusShape = { doc_id: z.string().optional() };
export const glossaryShape = { term: z.string().optional() };
export const runSqlShape = { query: z.string(), limit: z.number().int().max(1000).default(200) };
export const compareSchoolsShape = { school_a: z.string(), school_b: z.string(), fiscal_year: z.number().int().default(2027) };
export const mpsFundSummaryShape = { fiscal_year: z.number().int().default(2027) };
export const perPupilRankingShape = { fiscal_year: z.number().int().default(2027), order: z.enum(["highest", "lowest"]).default("highest"), min_enrollment: z.number().int().default(0), limit: z.number().int().max(60).default(20) };
```

- [ ] **Step 4: Barrel + final MCP re-wire**

Append `export * from "./queries/schools.js";` to the barrel (`search.js` is already exported). Rewrite `mcp/src/index.ts` to its final thin form: imports from `@mke/budget-tools`, the `ok`/`fail`/`wrap` helpers, one `registerTool` per tool (all titles/descriptions verbatim), the `get_amendments` registration now delegating to `getAmendments` via `wrap`, and the transport bootstrap (868-870) unchanged. Confirm no query SQL remains in the file (`grep -c "SELECT" mcp/src/index.ts` should be `0`).

- [ ] **Step 5: Write the schools integration test**

Create `packages/budget-tools/test/schools.test.ts`:

```typescript
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
```

- [ ] **Step 6: Verify the whole suite**

Run: `npm run -w @mke/budget-tools test && npm run typecheck --workspaces --if-present && make mcp-test`
Expected: every unit test PASS; typecheck clean; all three smoke scripts green with unchanged output. `grep -c "SELECT" mcp/src/index.ts` → `0`.

- [ ] **Step 7: Commit**

```bash
git add packages/budget-tools mcp/src/index.ts
git commit -m "refactor: extract schools + search/misc families; mcp/index.ts is now a thin adapter"
```

---

## Task 6: Wire test scripts, Makefile, and docs; final gate

Make the new test layer first-class and document the split.

**Files:**
- Modify: `Makefile`, `mcp/README.md`, root `package.json` (already has `test` script from Task 1 — verify it runs the package suite)
- Create: `packages/budget-tools/README.md`

- [ ] **Step 1: Add a `tools-test` Makefile target**

Edit `Makefile`: add `tools-test` to `.PHONY` and add the target + a help line (place near `mcp-test`):

```makefile
tools-test:
	npm run -w @mke/budget-tools test
```
Help line (in the `help` block): `@echo "  make tools-test                                 run @mke/budget-tools unit/integration tests"`

- [ ] **Step 2: Write `packages/budget-tools/README.md`**

```markdown
# @mke/budget-tools

Shared **read-only, cited** query layer over the reconciled Milwaukee budget (Neon `mcp_ro`).
The single source of truth for budget queries, imported by:

- `mcp/` — the L3 MCP server (wraps these fns in the MCP `ok`/`fail` envelope).
- `apps/budget-agent/` — the L4 CopilotKit actions (import these fns directly).

Every figure-returning function selects `doc_id` + `source_page` and shapes them via
`citations()`. `runSql` stays behind `guardSelect` (SELECT/WITH only). No write path exists.

- `npm run -w @mke/budget-tools test` — unit/integration tests (needs `MCP_DATABASE_URL`).
- `npm run -w @mke/budget-tools typecheck`
```

- [ ] **Step 3: Update `mcp/README.md`**

Add a short note that query logic now lives in `@mke/budget-tools` and `mcp/src/index.ts` is a thin registration adapter; the smoke tests (`make mcp-test`) guard the contract.

- [ ] **Step 4: Full green gate**

Run: `npm install && npm run typecheck --workspaces --if-present && make tools-test && make mcp-test`
Expected: install clean; typecheck clean; unit tests PASS; all three smoke scripts green.

- [ ] **Step 5: Commit**

```bash
git add Makefile mcp/README.md packages/budget-tools/README.md
git commit -m "docs+build: tools-test target, package README, mcp README note"
```

- [ ] **Step 6: Open the PR**

```bash
git push -u origin feat/budget-agent-design
gh pr create --base main --title "refactor: extract @mke/budget-tools shared query layer (budget-agent Prep PR)" \
  --body "Extracts all query logic from mcp/src/index.ts (870→~260 lines) into @mke/budget-tools, imported by both the MCP server and (next) the budget-agent app. Adds describeSchema() + standalone runSql(). Zero L3 contract change — proven by unchanged smoke tests (make mcp-test) plus new unit/integration tests (make tools-test). Decision D1: npm workspaces. Sets up Plan 2 (the budget-agent app)."
```

---

## Reserved Account-Code & Tool → Input-Shape Reference

Copied verbatim from the current `mcp/src/index.ts` `inputSchema` blocks so the shapes in `schemas.ts` are unambiguous. `gov()` = `z.enum(["city","county","mps"])`.

| Tool | Shape name | Fields |
|------|-----------|--------|
| list_departments | listDepartmentsShape | `gov: gov().default("city")`, `fiscal_year: z.number().int().optional()` |
| get_department_budget | getDepartmentBudgetShape | `dept: z.string()`, `gov: gov().default("city")`, `fiscal_year: z.number().int().optional()`, `doc_type: z.string().default("adopted")` |
| budget_breakdown | budgetBreakdownShape | `gov: gov().default("city")`, `fiscal_year: z.number().int().optional()`, `dept: z.string().optional()` |
| compare_years | compareYearsShape | `dept: z.string()`, `year_a: z.number().int()`, `year_b: z.number().int()`, `gov: gov().default("city")` |
| trace_adoption | traceAdoptionShape | `dept: z.string()`, `fiscal_year: z.number().int()`, `gov: gov().default("city")` |
| biggest_changes | biggestChangesShape | `gov: gov().default("city")`, `year_a: z.number().int()`, `year_b: z.number().int()`, `measure: z.enum(["dollars","percent"]).default("dollars")`, `direction: z.enum(["up","down","both"]).default("both")`, `limit: z.number().int().max(40).default(12)` |
| get_positions | getPositionsShape | `dept: z.string()`, `gov: gov().default("city")`, `fiscal_year: z.number().int().default(2026)` |
| find_positions | findPositionsShape | `query: z.string().optional()`, `gov: gov().default("city")`, `fiscal_year: z.number().int().default(2026)`, `min_salary: z.number().optional()`, `flag: z.string().optional()`, `limit: z.number().int().max(50).default(25)` |
| search_line_items | searchLineItemsShape | `query: z.string()`, `gov: gov().optional()`, `fiscal_year: z.number().int().optional()`, `limit: z.number().int().max(50).default(20)` |
| cite | citeShape | `line_id: z.number().int()` |
| reconciliation_status | reconciliationStatusShape | `doc_id: z.string().optional()` |
| glossary | glossaryShape | `term: z.string().optional()` |
| run_sql | runSqlShape | `query: z.string()`, `limit: z.number().int().max(1000).default(200)` |
| compare_schools | compareSchoolsShape | `school_a: z.string()`, `school_b: z.string()`, `fiscal_year: z.number().int().default(2027)` |
| mps_fund_summary | mpsFundSummaryShape | `fiscal_year: z.number().int().default(2027)` |
| per_pupil_ranking | perPupilRankingShape | `fiscal_year: z.number().int().default(2027)`, `order: z.enum(["highest","lowest"]).default("highest")`, `min_enrollment: z.number().int().default(0)`, `limit: z.number().int().max(60).default(20)` |

---

## Self-Review

**Spec coverage (against spec §6a "packages/budget-tools"):** query fns extracted (Tasks 3–5 ✓), Zod schemas moved (`schemas.ts`, Tasks 3–5 ✓), citation shaping (`citation.ts`, Task 1 ✓), `db.ts` moved (Task 1 ✓), `describeSchema()` (Task 2 ✓), safety-wrapped `runSql` (Task 2 ✓), `mcp/` thinned (Task 5 ✓). Testing per spec §8: unit tests on query fns (Tasks 3–5 ✓), MCP smoke tests still guard (every task ✓). The app-side items (spec §6b, §5, §4) are **out of scope for this Prep PR** — they are Plan 2, correctly deferred per spec decision #10.

**Placeholder scan:** no TBD/TODO/"handle edge cases"/"similar to Task N". The Extraction Procedure is a shared *procedure* with per-task concrete functions + line ranges + fail→throw conversions (not "repeat Task N"). Relocated code is specified by exact source line range + target path + exported signature; all net-new code (configs, `citation.ts`, `schema.ts`, `runSql`, `wrap`, tests, READMEs) is shown in full.

**Type consistency:** `Gov` is defined once in `helpers.ts` and imported everywhere. `Citation`/`num`/`citations` live once in `citation.ts`. `query`/`guardSelect` once in `db.ts`. Every query fn takes a single args object `a` (matching how `wrap(() => fn(a))` calls it) — verified against each tool's destructured params. `runSql` returns `{sql,row_count,rows}` (Task 2) and is consumed unchanged in Task 5's barrel. Shape names in `schemas.ts` match the reference table exactly.

**One known runtime risk to watch:** `mcp/` importing `@mke/budget-tools` whose `exports` point at `./src/index.ts` (raw TS) relies on `tsx` transpiling workspace TS at runtime — which it does, and the smoke tests (spawned via `npx tsx src/index.ts`) are the live proof at Task 1 Step 12. If resolution fails there, the fix is local to Task 1 (add the package to mcp's tsx run), not a redesign.
