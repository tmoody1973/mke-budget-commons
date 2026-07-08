# Budget Agent App — Foundation Slice Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, cited **Journalist** budget-agent app slice: the copilot answers multi-step questions over the real reconciled data via CopilotKit v2 tools, renders cited HeroUI cards (generative UI), and one dashboard panel shows live data — with every figure carrying a source citation.

**Architecture:** A Next.js 15 (App Router) app at `apps/budget-agent/` in the existing npm workspace. Server-side CopilotKit v2 `BuiltInAgent` (Claude Sonnet 5) with `defineTool` backend tools that call the **already-built, now-typed** `@mke/budget-tools` functions directly (secrets/DB stay server-side). Client `<CopilotKit>` provider + `<CopilotSidebar>`; frontend render pairing turns tool results into HeroUI cards with citation chips. The model never touches numbers — tools query Neon; Claude orchestrates + narrates cited results.

**Tech Stack:** Next.js 15 (App Router, React 19), CopilotKit **v2** API (`@copilotkit/react-core/v2`, `@copilotkit/runtime/v2`), HeroUI **Pro** on `@heroui/react` v3 (Tailwind v4), Recharts 3, Zod, `@mke/budget-tools`, Playwright (E2E). TypeScript strict.

## Global Constraints

- **The model never touches numbers.** Every dollar/FTE/% comes from an `@mke/budget-tools` function → Neon. Claude only picks tools, orders them, and narrates the returned, cited results. No arithmetic in the prompt.
- **Provenance on every figure.** Every rendered figure carries a `CitationChip` (doc + page) that links to the source. A card that shows a number without a citation is a defect.
- **Read-only.** The app imports `@mke/budget-tools` (the `mcp_ro` pool) for reads only. No write path. `run_sql` stays behind `guardSelect`.
- **Server-only data path.** `@mke/budget-tools` reads `MCP_DATABASE_URL` and must run server-side only — import it exclusively in route handlers, server components, and `"use server"` actions. Never import it into a `"use client"` module.
- **Locked decisions (from design + this session):** CopilotKit **v2** API; **HeroUI Pro** (license-gated, setup step required); default model **Claude Sonnet 5** (`claude-sonnet-5`); persona = **Journalist** first; Wisconsin-Policy-Forum analyst voice (spec §4).
- **Current package versions (verify latest at build time, do not assume stale):** CopilotKit `@copilotkit/*` ~1.62.x (v2 lives at the `/v2` subpath), `@heroui/react` v3.x (Tailwind v4, **no `<HeroUIProvider>` in v3**, compound `Card.Header`/`Card.Content`, `onPress` not `onClick`), `recharts` 3.x (native React 19). `@heroui-pro/react` installs via CLI login / `HEROUI_AUTH_TOKEN`, not plain npm.
- **Unverified API details → each is an explicit build-time verification step in the task that needs it, never asserted:** (a) CopilotKit v2 `BuiltInAgent` model-string format (`anthropic/claude-sonnet-5` vs `anthropic:claude-sonnet-5`); (b) the exact backend-`defineTool` + frontend-render pairing for generative UI (Task 7 carries a documented fallback); (c) the canonical current Sonnet model id (confirm against Anthropic docs); (d) HeroUI Pro's registry/token transport.
- **Scope wall:** this is the FOUNDATION SLICE. Full panel set, complete card vocabulary, Pin-to-dashboard, rate-limit backend, and Vercel deploy are **Plan 3** — do not build them here. If a task tempts scope creep, stop and note it.

---

## Prerequisite reading for implementers

- Research notes with current API snippets: `.superpowers/sdd/research-app-libs.md` (CopilotKit v2 route handler, provider, tools/render, HeroUI v3 + Pro, Recharts).
- The shared package this app consumes: `packages/budget-tools/src/` (functions, `schemas.ts` Zod input shapes, `describeSchema()`).
- Design spec (product surface, voice, trust model): `docs/superpowers/specs/2026-07-07-budget-agent-design.md` (§4 voice, §5 journalist panels, §6 modules, §7 trust).

---

## File Structure

**Modified (shared package — prerequisite tasks):**
- `packages/budget-tools/src/types.ts` — NEW: result interfaces + `Ambiguous` variant.
- `packages/budget-tools/src/queries/*.ts` — replace `Promise<any>` with the typed returns.
- `packages/budget-tools/src/queries/breakdown.ts`, `departments.ts` — add `citations` to breakdown / align "Cited" descriptions.

**New (the app):**
```
apps/budget-agent/
├─ package.json  tsconfig.json  next.config.ts  tailwind.config.ts  postcss.config.mjs  .env.local.example
├─ app/
│  ├─ layout.tsx                     root layout + CopilotKit provider (client boundary)
│  ├─ globals.css                    Tailwind v4 + HeroUI + CopilotKit CSS imports
│  ├─ page.tsx                       Journalist dashboard route
│  └─ api/copilotkit/[[...slug]]/route.ts   CopilotKit v2 runtime (BuiltInAgent + defineTool)
├─ components/
│  ├─ providers.tsx                  "use client" CopilotKit + sidebar wrapper
│  ├─ dashboard/BiggestChangesPanel.tsx
│  ├─ dashboard/GovYearSelectors.tsx
│  └─ generative/{CitationChip,StatCard,DeltaTable,CardSkeleton}.tsx
├─ lib/
│  ├─ tools/server-tools.ts          server defineTool()s wrapping @mke/budget-tools (Zod params)
│  ├─ tools/frontend-tools.ts        "use client" useFrontendTool render bindings → cards
│  ├─ agent-context.ts               dashboard state (gov/year) shared to the agent
│  └─ personas.ts                    journalist starter questions + tool emphasis
├─ prompts/base.md  prompts/journalist.md   versioned system prompt (spec §4)
└─ e2e/investigation.spec.ts         Playwright: cited output, no uncited numbers
```

---

## Task 1: Type the `@mke/budget-tools` return surface

Replace the `Promise<any>` surface (final-review Important item) with result interfaces + an explicit `Ambiguous` variant, so the app consumes typed payloads. Behavior-preserving — the 12 unit tests must still pass.

**Files:**
- Create: `packages/budget-tools/src/types.ts`
- Modify: `packages/budget-tools/src/queries/{departments,breakdown,compare,positions,schools,search}.ts` (return annotations), `packages/budget-tools/src/index.ts` (export types)
- Test: `packages/budget-tools/test/*.test.ts` (unchanged assertions must still pass)

**Interfaces:**
- Produces: `types.ts` exporting `Ambiguous = { ambiguous: true; candidates: { dept_id: string; canonical_name: string }[] }`, a `CitationRef = { doc_id: string; source_page: number }`, and one result interface per tool (e.g. `DepartmentBudget`, `BudgetBreakdown`, `CompareYears`, `TraceAdoption`, `BiggestChanges`, `DepartmentList`, `Positions`, `SearchResults`, `Cite`, `ReconciliationStatus`, `CompareSchools`, `MpsFundSummary`, `PerPupilRanking`, `RunSqlResult`, `SchemaDescription`). Functions that can be ambiguous return `Promise<T | Ambiguous>`.

- [ ] **Step 1: Derive the exact result shapes from the current code**

Read each function in `packages/budget-tools/src/queries/*.ts` and transcribe the object it returns into an interface. Do NOT invent fields — copy the exact keys the function builds (e.g. `getDepartmentBudget` returns `{ department, dept_id, doc_type, totals: {...}, fte: {...}, divisions, top_expenditures, citations }`, and county/mps branches return their variants — model the union). Put every interface in `packages/budget-tools/src/types.ts`. Add:

```typescript
export type CitationRef = { doc_id: string; source_page: number };
export type Ambiguous = { ambiguous: true; candidates: { dept_id: string; canonical_name: string }[] };
export const isAmbiguous = (r: unknown): r is Ambiguous =>
  typeof r === "object" && r !== null && (r as any).ambiguous === true;
```

- [ ] **Step 2: Annotate the function returns**

Change each function signature from `: Promise<any>` to its typed return. For the seven that can return the multi-candidate branch (`getDepartmentBudget`, `budgetBreakdown`, `compareYears`, `traceAdoption`, `getPositions`, and the county/mps breakdown helpers), the type is `Promise<<Result> | Ambiguous>`. Where a county/mps branch returns a differently-shaped payload, model it as a union (`CityDeptBudget | CountyDeptBudget | MpsSchoolBudget`). If strict typing a deeply dynamic object (e.g. `run_sql` rows) is impractical, use a precise wrapper with `rows: Record<string, unknown>[]` — NOT `any`.

- [ ] **Step 3: Export the types from the barrel**

Append to `packages/budget-tools/src/index.ts`: `export * from "./types.js";`

- [ ] **Step 4: Typecheck + run tests**

Run: `npm run -w @mke/budget-tools typecheck && npm run -w @mke/budget-tools test`
Expected: 0 type errors; **12/12 tests pass** (behavior unchanged). If `strict` surfaces a real nullability the old `any` hid, fix the type honestly (add `| null`), do not re-widen to `any`.

- [ ] **Step 5: Smoke gate (contract unchanged)**

Run: `make mcp-test`
Expected: all 3 smoke suites green — the MCP adapter consumes the same runtime values; only types changed.

- [ ] **Step 6: Commit**

```bash
git add packages/budget-tools/src packages/budget-tools/test
git commit -m "feat(budget-tools): type the query return surface (replace Promise<any>, add Ambiguous)"
```

---

## Task 2: Fix the "Cited" description mismatch

`budget_breakdown` and `list_departments` describe themselves as "Cited" but return no `citations`. Make the claim true where the provenance exists, and correct the wording where it doesn't (final-review Minor; matters because the app renders citation chips off these).

**Files:**
- Modify: `packages/budget-tools/src/queries/breakdown.ts` (add citations to the city/county/mps breakdown payloads), `packages/budget-tools/src/queries/departments.ts` (`listDepartments`), `packages/budget-tools/src/types.ts`, `mcp/src/index.ts` (tool descriptions if wording changes)
- Test: `packages/budget-tools/test/departments.test.ts`

- [ ] **Step 1: Add citations to `budgetBreakdown` (city path)**

The city breakdown reads `line_kind='total'` rows, which carry `doc_id`/`source_page`. Add those columns to the `per_dept` CTE's underlying select (or a small follow-up select over the same predicate) and pass the rows through `citations(...)`; include `citations` in the returned object and its interface. Do the same for the county (`line_kind='category'`) and mps paths, which already read rows with provenance. Verify the citations are non-empty for a citywide call.

- [ ] **Step 2: Align `list_departments`**

`listDepartments` aggregates with `MAX(...)`/`SUM(...)` and does not currently retain per-row provenance. Rather than force a citation it can't cleanly source, **correct the MCP tool description** for `list_departments` (in `mcp/src/index.ts`) to drop the "Cited" implication (it lists totals; the per-department citations come from `get_department_budget`). Keep `budget_breakdown`'s description as "Cited" now that Step 1 makes it true.

- [ ] **Step 3: Test the new citations**

Add to `packages/budget-tools/test/departments.test.ts`:

```typescript
test("budgetBreakdown(city) carries citations", async () => {
  const r = await budgetBreakdown({ gov: "city" });
  assert.ok("citations" in r && Array.isArray((r as any).citations) && (r as any).citations.length > 0,
    "citywide breakdown must cite its source pages");
});
```

- [ ] **Step 4: Gate + commit**

Run: `npm run -w @mke/budget-tools test && make mcp-test`
Expected: tests pass (13 now); smoke green.

```bash
git add packages/budget-tools mcp/src/index.ts
git commit -m "fix(budget-tools): make budget_breakdown citations real; correct list_departments 'Cited' wording"
```

---

## Task 3: Scaffold the Next.js 15 app + HeroUI Pro + Tailwind v4

Create `apps/budget-agent/` in the workspace, wire HeroUI Pro (license step) + Tailwind v4, and serve a bare page. No copilot yet — this task's deliverable is "the app builds and runs."

**Files:** Create the `apps/budget-agent/` scaffold (package.json, tsconfig, next.config, tailwind/postcss config, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `.env.local.example`). Modify root `package.json` if the `apps/*` workspace glob needs it (it already includes `apps/*`).

- [ ] **Step 1: Create the Next.js app in the workspace**

From repo root: `npx create-next-app@latest apps/budget-agent --typescript --tailwind --app --no-src-dir --import-alias "@/*" --use-npm`. Then set `apps/budget-agent/package.json` name to `budget-agent`, `"private": true`, and confirm React 19 / Next 15. Run `npm install` at the repo root to link it into the workspace.

- [ ] **Step 2: Install HeroUI (OSS v3) + Tailwind v4 + Recharts**

`npm install -w budget-agent @heroui/react@latest framer-motion recharts@latest`. Configure Tailwind v4 per HeroUI v3 docs (the `@plugin` / content config from the research file). Confirm **no `<HeroUIProvider>`** is required in v3 (research note) — if the current docs say otherwise at build time, follow the docs.

- [ ] **Step 3: Wire HeroUI Pro (license-gated)**

Add a `.env.local.example` line `HEROUI_AUTH_TOKEN=` and a README note. Run the HeroUI Pro CLI setup per current docs (`npx heroui-pro@latest login` interactively, or `HEROUI_AUTH_TOKEN` for CI) and install the Pro package/blocks the plan uses. **If the Pro CLI/login is not available in this environment, STOP and report NEEDS_CONTEXT** — the token/login is a human step. Do NOT fake it or silently fall back to OSS-only without flagging.

- [ ] **Step 4: Bare page + CSS imports**

`app/globals.css` imports Tailwind v4 and HeroUI styles (order per docs). `app/page.tsx` renders a HeroUI `Card` with a placeholder title "Milwaukee Budget — Journalist" to prove HeroUI renders.

- [ ] **Step 5: Verify build + dev server**

Run: `npm run -w budget-agent build` (expect success) and `npm run -w budget-agent dev` then verify `curl -s localhost:3000 | grep -i "Milwaukee Budget"` returns the heading (kill the dev server after).

- [ ] **Step 6: Commit**

```bash
git add apps/budget-agent package.json package-lock.json
git commit -m "feat(app): scaffold budget-agent Next.js 15 app + HeroUI Pro + Tailwind v4"
```

---

## Task 4: Server data layer — typed `defineTool`s wrapping `@mke/budget-tools`

Expose the budget functions as CopilotKit v2 backend tools, server-side only, reusing the package's Zod input shapes. This is the secure data path (DB + secrets never reach the client).

**Files:** Create `apps/budget-agent/lib/tools/server-tools.ts`.

**Interfaces:**
- Consumes: `@mke/budget-tools` functions + `*Shape` Zod shapes + result types (Task 1).
- Produces: `serverTools: Tool[]` — an array of `defineTool(...)` for the foundation-slice tools: at minimum `biggest_changes`, `get_department_budget`, `budget_breakdown`, `search_line_items`, `cite`, `reconciliation_status`, `glossary`, `run_sql`, `describe_schema`.

- [ ] **Step 1: Build the tool array**

`lib/tools/server-tools.ts` (server module — no `"use client"`). For each tool, wrap the `@mke/budget-tools` function in `defineTool` using its Zod shape as `parameters`. Pattern (confirm `defineTool` signature against current `@copilotkit/runtime/v2` at build time):

```typescript
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import * as tools from "@mke/budget-tools";

export const serverTools = [
  defineTool({
    name: "biggest_changes",
    description: "The departments whose budgets changed most between two fiscal years — the story-finder. Ranked by $ or %, with citations.",
    parameters: z.object(tools.biggestChangesShape),
    execute: async (args) => tools.biggestChanges(args as any),
  }),
  defineTool({
    name: "get_department_budget",
    description: "Reserved-code totals, FTE, divisions, and top expenditures for a department, with citations.",
    parameters: z.object(tools.getDepartmentBudgetShape),
    execute: async (args) => tools.getDepartmentBudget(args as any),
  }),
  // …budget_breakdown, search_line_items, cite, reconciliation_status, glossaryLookup, runSql, describeSchema
];
```
Copy each tool's description verbatim from `mcp/src/index.ts`. For `glossary` use `tools.glossaryLookup`; for `run_sql` use `tools.runSql`; add a `describe_schema` tool calling `tools.describeSchema()` (empty params) so the SQL-writing model can see the schema.

- [ ] **Step 2: Typecheck**

Run: `npm run -w budget-agent build` (or `tsc --noEmit`). Expected: clean. If `execute` return types clash with CopilotKit's expected tool-result type, serialize explicitly (return the object; CopilotKit JSON-encodes) — do not cast away the typed results with blanket `any` beyond the Zod-inferred `args`.

- [ ] **Step 3: Commit**

```bash
git add apps/budget-agent/lib/tools/server-tools.ts
git commit -m "feat(app): server-side CopilotKit tools wrapping @mke/budget-tools"
```

---

## Task 5: CopilotKit v2 runtime route + system prompt

Wire the runtime with a `BuiltInAgent` (Sonnet 5), the journalist system prompt, and the server tools.

**Files:** Create `apps/budget-agent/app/api/copilotkit/[[...slug]]/route.ts`, `apps/budget-agent/prompts/base.md`, `apps/budget-agent/prompts/journalist.md`, `apps/budget-agent/.env.local.example` (add `ANTHROPIC_API_KEY`).

- [ ] **Step 1: Write the system prompt files**

`prompts/base.md` = the Milwaukee Budget Expert base prompt from spec §4 (identity/fluency, plain-English mandate, the inviolable rule as behavior, always-cite, coverage honesty, tool-selection rule, investigation instruction, WPF analyst voice). `prompts/journalist.md` = the thin Journalist overlay (outliers, YoY swings, reconciliation findings as leads, always sourced). Keep them as real Markdown files (versioned).

- [ ] **Step 2: Write the route handler**

`app/api/copilotkit/[[...slug]]/route.ts` (verify every import path + class name against current `@copilotkit/runtime/v2` docs — the research file has the shape but flagged the model-string format as unverified):

```typescript
import { CopilotRuntime, createCopilotHonoHandler, InMemoryAgentRunner, BuiltInAgent } from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serverTools } from "@/lib/tools/server-tools";

const systemPrompt = [
  readFileSync(join(process.cwd(), "prompts/base.md"), "utf8"),
  readFileSync(join(process.cwd(), "prompts/journalist.md"), "utf8"),
].join("\n\n");

const agent = new BuiltInAgent({
  model: "anthropic/claude-sonnet-5", // BUILD-TIME VERIFY: exact provider/model separator + current Sonnet id
  systemPrompt,
  tools: serverTools,
  maxSteps: 6, // 4–6 step investigations
});
const runtime = new CopilotRuntime({ agents: { default: agent }, runner: new InMemoryAgentRunner() });
const app = createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit" });
export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
```

- [ ] **Step 3: BUILD-TIME VERIFICATION — model string + runtime API**

Before proceeding, confirm against current CopilotKit v2 docs: (a) the exact `BuiltInAgent` constructor fields (`model`/`systemPrompt`/`tools`/`maxSteps` names), (b) the model-string format for Anthropic, (c) the current Sonnet model id. If any differ, adjust and note the confirmed values in the task report. If `createCopilotHonoHandler`/`InMemoryAgentRunner` names have changed, use the current equivalents. Record what you verified.

- [ ] **Step 4: Smoke the endpoint**

Set `ANTHROPIC_API_KEY` in `.env.local` (do not commit). Run `npm run -w budget-agent dev`, then send a minimal CopilotKit request (or use the UI in Task 6) and confirm a 200 + streamed response. If the runtime rejects the request shape, that's the v2 API-verification loop — fix against docs, don't guess repeatedly.

- [ ] **Step 5: Commit**

```bash
git add apps/budget-agent/app/api apps/budget-agent/prompts apps/budget-agent/.env.local.example
git commit -m "feat(app): CopilotKit v2 runtime (BuiltInAgent Sonnet 5) + journalist system prompt"
```

---

## Task 6: Client provider + copilot sidebar + agent context

Mount the CopilotKit provider and sidebar, and expose dashboard state (gov/year) to the agent.

**Files:** Create `apps/budget-agent/components/providers.tsx`, `apps/budget-agent/lib/agent-context.ts`; modify `app/layout.tsx`, `app/page.tsx`, `app/globals.css` (CopilotKit CSS).

- [ ] **Step 1: Providers wrapper**

`components/providers.tsx` (`"use client"`): import `@copilotkit/react-core/v2/styles.css`, wrap children in `<CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>` and render `<CopilotSidebar>` (verify prop names against current v2 docs). Mount `<Providers>` in `app/layout.tsx` around `{children}`.

- [ ] **Step 2: Dashboard state + agent context**

`lib/agent-context.ts`: a small React context holding `{ government: "city"|"county"|"mps"; fiscalYear: number }` with a provider + hook. In a client component, call `useAgentContext({ description: "The government and fiscal year the user is currently viewing", value: { government, fiscalYear } })` (v2 equivalent of `useCopilotReadable`) so the copilot is context-aware.

- [ ] **Step 3: Verify the copilot opens and chats**

`npm run -w budget-agent dev`; in the browser, open the sidebar, ask "what can you do?" and confirm a streamed answer that reflects the journalist persona. (Playwright automation of this is Task 9.)

- [ ] **Step 4: Commit**

```bash
git add apps/budget-agent/components/providers.tsx apps/budget-agent/lib/agent-context.ts apps/budget-agent/app
git commit -m "feat(app): CopilotKit provider + sidebar + gov/year agent context"
```

---

## Task 7: Generative UI — cited cards for 2 tools (THE PROOF)

Wire the frontend render pairing so tool results become HeroUI cards with citation chips. This de-risks the flagged-unverified backend-tool + generative-render pairing. Prove it on two tools: `biggest_changes` → `DeltaTable`, `get_department_budget` → `StatCard`.

**Files:** Create `components/generative/{CitationChip,StatCard,DeltaTable,CardSkeleton}.tsx`, `lib/tools/frontend-tools.ts`.

**Interfaces:**
- Consumes: result types from `@mke/budget-tools` (Task 1); the server tools (Task 4).
- Produces: `CitationChip({ doc_id, source_page })`, `StatCard({ data: DepartmentBudget })`, `DeltaTable({ data: BiggestChanges })`, and frontend render registrations.

- [ ] **Step 1: Build the card components (HeroUI v3, cited)**

`CitationChip.tsx`: a HeroUI `Chip` rendering "p.{source_page} · {doc_id}" that links to the source (href resolved from doc_id → source_url; for the slice, link to a `#` placeholder or the dim_document URL if available — a real link, not fabricated text). `StatCard.tsx` / `DeltaTable.tsx`: HeroUI `Card` (`Card.Header`/`Card.Content`) rendering the typed payload; **every figure row includes a `CitationChip`**. `CardSkeleton.tsx`: a HeroUI skeleton for the executing state. Use `onPress` (not `onClick`).

- [ ] **Step 2: BUILD-TIME VERIFICATION — the render pairing**

Confirm against current CopilotKit v2 docs how a **backend** `defineTool` result is rendered on the client (the research flagged no single worked example pairing backend `defineTool` + frontend render). Determine the correct mechanism: either (a) a frontend render registration keyed by tool name (`useFrontendTool`/`useRenderTool` with matching `name` + a `render`), or (b) if v2 only renders frontend-executed tools, convert these two tools to `useFrontendTool` whose `handler` calls a `"use server"` action that invokes `@mke/budget-tools` (secrets stay server-side). **Pick the documented mechanism; record which one and why in the report.** Fallback (if neither renders cleanly): render the cards in the dashboard from the tool result via the copilot's message stream. Do not ship an unrendered tool silently.

- [ ] **Step 3: Register the render bindings**

`lib/tools/frontend-tools.ts` (`"use client"`): for `biggest_changes` and `get_department_budget`, register the render that shows `<CardSkeleton>` while `status !== "complete"` and `<DeltaTable data=...>` / `<StatCard data=...>` on complete (parse the tool result, which is the typed payload — handle the `Ambiguous` variant by rendering a "did you mean…" list). Mount this hook in a client component within the provider tree.

- [ ] **Step 4: Verify end-to-end (the money shot)**

`npm run -w budget-agent dev`; ask the copilot "What changed most in the city budget from 2025 to 2026?" → confirm a `DeltaTable` renders in the chat with real numbers **and citation chips**. Ask "What's the Fire Department's budget?" → `StatCard` with cited totals. Confirm no number appears without a chip.

- [ ] **Step 5: Commit**

```bash
git add apps/budget-agent/components/generative apps/budget-agent/lib/tools/frontend-tools.ts
git commit -m "feat(app): generative UI — cited DeltaTable + StatCard for biggest_changes/get_department_budget"
```

---

## Task 8: One dashboard panel + gov/year selectors

Render a curated panel directly (not via chat) reusing the generative card, and wire selectors into the agent context — proving the dashboard ↔ copilot loop.

**Files:** Create `components/dashboard/BiggestChangesPanel.tsx`, `components/dashboard/GovYearSelectors.tsx`; modify `app/page.tsx`, `lib/personas.ts`.

- [ ] **Step 1: Selectors**

`GovYearSelectors.tsx` (`"use client"`): HeroUI `Select`/`Tabs` for government (city/county/mps) and fiscal year; on change, update the `agent-context` state (Task 6) so the copilot sees the current view.

- [ ] **Step 2: Panel with live data**

`BiggestChangesPanel.tsx`: a server component (or a client component calling a `"use server"` action) that calls `biggestChanges({ gov, year_a, year_b })` from `@mke/budget-tools` and renders the **same** `DeltaTable` card used by the copilot (component reuse per spec §6). Cited. Reads the selected gov/year.

- [ ] **Step 3: Compose the dashboard page**

`app/page.tsx`: header + `GovYearSelectors` + `BiggestChangesPanel` in a HeroUI grid, with the copilot sidebar alongside. `lib/personas.ts`: journalist starter questions surfaced in the sidebar (e.g. "Find the biggest budget swings", "Which reconciliation findings are story leads?").

- [ ] **Step 4: Verify**

`npm run -w budget-agent dev`: the panel shows real cited biggest-changes data; switching gov/year updates it; asking the copilot "why did that change?" shows it knows the current gov/year from context.

- [ ] **Step 5: Commit**

```bash
git add apps/budget-agent/components/dashboard apps/budget-agent/app/page.tsx apps/budget-agent/lib/personas.ts
git commit -m "feat(app): Biggest Changes dashboard panel + gov/year selectors wired to agent context"
```

---

## Task 9: Trust baseline + E2E investigation test

Lock the trust promise and add an automated guard.

**Files:** Create `apps/budget-agent/e2e/investigation.spec.ts`, `apps/budget-agent/playwright.config.ts`; modify `prompts/base.md` (tighten), card components (empty/error states).

- [ ] **Step 1: Empty/error states**

Each card + panel renders a graceful empty state ("No data loaded for that year") and error state ("I couldn't find that in the loaded data") — never a stack trace, never a fabricated number. Tool/action errors surface as a friendly copilot message.

- [ ] **Step 2: Playwright E2E — cited output, no uncited numbers**

`e2e/investigation.spec.ts`: drive the app, ask "What changed most in the city budget from 2025 to 2026?", wait for the `DeltaTable`, assert (a) at least one `CitationChip` is present, and (b) a coarse guard that dollar figures in the rendered card are accompanied by a citation (e.g. every card with a `data-figure` has a sibling `data-citation`). Add `data-testid`/`data-*` hooks to the cards to make this assertable.

- [ ] **Step 3: Run E2E**

Run: `npx playwright test` (from `apps/budget-agent`) with the dev server running (or via Playwright's `webServer`). Expected: the investigation test passes. Requires `ANTHROPIC_API_KEY` + DB `.env` — if the env isn't available in CI, mark the test to skip with a clear reason rather than fake a pass.

- [ ] **Step 4: Commit**

```bash
git add apps/budget-agent/e2e apps/budget-agent/playwright.config.ts apps/budget-agent/prompts apps/budget-agent/components
git commit -m "feat(app): trust baseline (empty/error states) + Playwright cited-output E2E"
```

---

## Deferred to Plan 3 (do not build here)

Remaining Journalist panels (Trust bar KPI row, Where-money-goes, Findings, Search+cite); full card vocabulary (`ComparisonCard`, `FindingCard`, `BreakdownChart` w/ Recharts, `InvestigationTrace`, `QueryResultCard` with shown SQL); **Pin-to-dashboard**; per-IP rate-limit backend (Upstash/Vercel KV) + Anthropic spend-cap alert; Parent + Citizen personas; **Vercel deploy**. Also: expose `describe_schema` over MCP for parity (optional).

---

## Self-Review

**Spec coverage (design spec §4/§5/§6/§7 vs. this slice):** system prompt + WPF voice (Task 5 ✓, §4); Journalist dashboard + one panel + selectors (Task 8 ✓, subset of §5 — rest deferred, stated); generative card vocabulary started — `StatCard`/`DeltaTable`/`CitationChip`/`CardSkeleton` (Task 7 ✓; rest deferred); `@mke/budget-tools` as the one data source (Tasks 4/8 ✓, §6); trust model — citation on every figure, read-only, no invented numbers, error/empty states (Tasks 7/9 + Global Constraints ✓, §7). Deferred items are explicitly listed, not dropped.

**Placeholder scan:** no TBD/"handle later". The three genuinely-unverified library details (CopilotKit v2 model-string, the render pairing, HeroUI Pro transport) are each written as an explicit **build-time verification step** inside the task that needs them, with a stated fallback and a "record what you verified" instruction — this is the honest treatment of an evolving external API, not a placeholder. Every new component/file has a concrete responsibility and the load-bearing code (typed interfaces, route handler, tool array, render pairing, cards) is shown.

**Type consistency:** the `Ambiguous` type + `isAmbiguous` guard (Task 1) are the single mechanism every consumer uses for the multi-candidate branch (Task 7 Step 3 renders it; server tools return it). Result types defined in Task 1 are consumed by Tasks 4/7/8 by the same names. Tool names (`biggest_changes`, `get_department_budget`, …) match between `server-tools.ts` and the render registrations.

**Known risk carried into execution:** the CopilotKit v2 backend-tool + generative-render pairing (Task 7 Step 2) is the highest-uncertainty point; the task front-loads its verification and carries a documented fallback so it cannot silently half-work. If v2's API diverges materially from the research snapshot, the affected tasks (5–7) get a docs-verification loop, not a guess.

