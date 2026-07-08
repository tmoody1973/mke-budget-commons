# Spec — Budget Agent (L4 web app)

**Status:** Design complete, pending user approval → then `writing-plans`.
**Date:** 2026-07-07
**Skill flow:** `superpowers:brainstorming` → this spec → `superpowers:writing-plans`.
**Supersedes:** `docs/handoffs/budget-agent-design-handoff.md` (that doc is now history).

---

## 1. What we're building

An **L4 app** — `apps/budget-agent/` — that turns the reconciled Milwaukee city / county / MPS
budget data into **persona dashboards with an AI copilot**. It reads the **L3 contract only**
(the MCP tools' query logic over Neon, read-only). It never writes to the canonical store, and
**the model never touches numbers** — tools query Neon; Claude only orchestrates and narrates
cited results.

**Phase 1 = a vertical slice:** the **Journalist persona**, wired to all three governments.
Parent and Citizen personas come later and are mostly component + overlay reuse.

### Builds on (already on `main`)
- **L3 MCP server** (`mcp/src/index.ts` — verified 870 lines / 42KB, 18 tool registrations,
  stdio, TypeScript) over Neon via the `mcp_ro` read-only role. Tools: `list_departments`,
  `get_department_budget`, `budget_breakdown`, `compare_years`, `trace_adoption`,
  `biggest_changes`, `search_line_items`, `get_positions`, `find_positions`, `cite`, `glossary`,
  `reconciliation_status`, `run_sql`, `compare_schools`, `mps_fund_summary`, `per_pupil_ranking`.
  (`db.ts` + `glossary.ts` are already split out of `index.ts`.)
- **Data:** city (detailed + requested), county (operating + non-dept ledgers + tax-levy
  crosswalk), MPS (line-item + per-pupil). All reconciled + cited (`doc_id` + `source_page`).
- **Neon tables:** `fact_budget_line`, `fact_school`, `dim_department`, `dim_document`,
  `dim_government`, `reconciliation_result`.
- **Existing L4:** `apps/explainer/index.html` (static). Whole stack is TypeScript.
- **Verified:** no monorepo workspace exists yet — no root `package.json`, no
  `pnpm-workspace.yaml`. `mcp/` is a standalone package. Standing up a workspace is in scope.

---

## 2. Locked decisions

### 2a. From the brainstorming session (Sections 1/1b/2)
| # | Decision | Choice |
|---|---|---|
| 1 | Core experience | **Dashboard-first + copilot.** Curated persona dashboards; CopilotKit as side/bottom copilot that drills in, filters, explains. |
| 2 | Scope | **Vertical slice: Journalist first**, wired to all 3 governments. Then Parent, then Citizen. |
| 3 | UI stack | **Next.js 15 + HeroUI Pro + CopilotKit.** Copilot renders generative UI into the same HeroUI design system. |
| 4 | Agent framework | **Approach A — CopilotKit native `CopilotRuntime` + Anthropic (Claude) adapter.** MCP tools → CopilotKit actions; `useCopilotReadable` exposes dashboard state; `useCopilotAction` `render` for generative UI. One TS app. |
| 5 | Data path | **Shared query module `@mke/budget-tools`.** Both the MCP server and the CopilotKit actions import it. Copilot queries Neon (read-only) directly — no subprocess. One source of truth. |
| 6 | AG-UI | **Not used in Phase 1.** Native runtime speaks AG-UI internally; the escape hatch for a future Approach B (Claude Agent SDK agent). A→B is additive. |
| 7 | Investigations | **Claude's native multi-tool loop + narration.** System prompt states a plan and narrates each step; CopilotKit streams tool calls live. Design the AG-UI seam for later graduation. |
| 8 | Cross-table analysis | Copilot answers **novel joins via `run_sql`** (read-only + `guardSelect`). LLM writes SQL, Postgres computes over reconciled rows → inviolable rule holds. **Show the SQL.** Rails: statement timeout + row cap + `describeSchema()`. |
| 9 | Voice | Base **"Milwaukee Budget Expert"** system prompt + persona overlays. **Write like a Wisconsin Policy Forum analyst** (§4). Plain-English; never invent/hand-compute a number; always cite; glossary-grounded definitions; honest about coverage gaps. |

### 2b. From Section 3 (this session)
| # | Decision | Choice |
|---|---|---|
| 10 | Extraction sequencing | **Prep PR first.** Stand up the workspace + extract `@mke/budget-tools` + thin out `mcp/`, verified green (MCP smoke tests pass), **before** any `budget-agent` code. |
| 11 | Chart library | **Recharts.** React-native SVG, composable, themes cleanly with the `dataviz` skill palette. |
| 12 | Auth (Phase 1) | **None — fully public.** Public budget records, read-only role. Protect the copilot endpoint with rate-limiting, not a login wall. |
| 13 | Cost/abuse controls | **Rate-limit + spend cap.** Per-IP rate limit on `/api/copilotkit` + a hard monthly Anthropic budget alert. Design the seam in Phase 1. |

---

## 3. Architecture & data flow

```
apps/budget-agent (Next.js 15, Vercel)
  Browser: HeroUI Pro dashboard + CopilotKit copilot (sidebar desktop / bottom-sheet mobile)
     │  useCopilotReadable (dashboard state → AI) ; generative UI (HeroUI cards) streamed back
  Server: /api/copilotkit → CopilotRuntime (Anthropic/Claude adapter)
     │  copilot actions = all L3 tools (16 named, incl. run_sql)
     ▼
  @mke/budget-tools  (shared TS pkg: query fns + Zod schemas + citation shaping)  ← ONE source of truth
     ▼
  Neon Postgres (mcp_ro, READ-ONLY, cited)
     ▲
  mcp/ MCP server (unchanged L3 contract) ALSO imports @mke/budget-tools
```

**Invariants preserved:** (a) L4 reads the L3 contract; (b) the model never touches numbers
(tools → Neon; Claude orchestrates + narrates cited results); (c) read-only end to end.

---

## 4. System prompt (Wisconsin Policy Forum analyst voice)

Base prompt + swappable persona overlays as **versioned files** in `apps/budget-agent/prompts/`.

**Base "Milwaukee Budget Expert" covers:**
- **Identity/fluency:** funds & fund types, reserved codes (006000 salaries, 006100 fringe,
  etc.), tax levy, per-pupil, FTE, reconciliation — understands the domain to translate it.
- **Plain-English mandate:** explain anything to anyone; define jargon inline on first use;
  adjustable depth ("explain like I'm 12" / "technical breakdown"); default tone from overlay.
- **Inviolable rule as behavior:** never state a $/FTE/% that didn't come from a tool; never do
  arithmetic a tool/SQL can do; if it's not in the data, say so — never estimate or guess.
- **Always cite in plain language** ("according to page 47 of the 2026 Adopted Budget"); use the
  `glossary` tool for definitions so explanations are sourced too.
- **Honest about coverage:** knows what's loaded vs. parked (county capital OCR; amendments not
  available) and says so.
- **Tool-selection rule:** prefer a typed tool; use `run_sql` for cross-table/cross-gov analysis;
  always select provenance columns; show the query; cite; never invent/hand-compute.
- **Investigation instruction:** state a plan, chain tools narrating each step, synthesize a
  cited answer with a suggested angle.

**WPF analyst style rules** (from their 2023 City of Milwaukee Budget Brief):
- **Nonpartisan, independent, objective.** Analyze what the budget *does* and *means* — never
  what officials *should* do, never partisan blame.
- **Every number contextualized:** vs. prior year, vs. multi-year/historical range, vs. what was
  originally anticipated, per-capita/per-pupil, and inflation-adjusted where relevant.
- **Explain the "so what"** — impact on services and taxpayers — plainly, without prescribing.
- **Measured and precise, not dry.** Restrained; an occasional vivid *fact-grounded* frame. The
  drama is in the facts, not adjectives.
- **Distill into a few plain-language key findings** (their "Keys to Understanding the Budget").
- **Present both good and concerning news; caveat and condition** ("for now," "if X…").
- **Always sourced.** Cite figures (our doc + page); attribute.

Maps 1:1 onto our tools: `compare_years` = prior-year context; `reconciliation_status` =
findings/leads; `per_pupil_ranking` = per-pupil; `biggest_changes` = trends.

**Persona overlays (thin):** **Journalist** (outliers, YoY swings, comparisons, reconciliation
findings as leads, always sourced) · Parent (your school, per-pupil, staffing, warm plain
language) · Citizen (where taxes go, big picture, minimal jargon).

Sources: https://wispolicyforum.org/about-us/ ·
https://wispolicyforum.org/wp-content/uploads/2022/10/2023CityOfMilwaukee_BudgetBrief.pdf

---

## 5. Journalist product surface (Phase 1)

Dashboard (HeroUI Pro): desktop = grid + copilot sidebar; mobile = single column + bottom-sheet.

**Panels → tools:**
- **Trust bar (KPI row):** total budget · YoY change · reconciliation status ("100% reconciled,
  N findings"). Trust signal + story source.
- **Biggest changes** (story-finder) → `biggest_changes`.
- **Where the money goes** → `budget_breakdown`.
- **Findings** → `reconciliation_status` (documented source-inconsistencies = story leads).
- **Search + cite** → `search_line_items` + `cite`.
- **Gov/year selectors** → `useCopilotReadable` state (copilot is context-aware).

**Copilot generative-UI vocabulary** (HeroUI cards via `useCopilotAction` `render`), each with a
**citation chip** (doc + page → links to source):
`StatCard` · `DeltaTable` · `BreakdownChart` · `ComparisonCard` · `FindingCard` ·
`InvestigationTrace` (live plan + step narration) · `QueryResultCard` (SQL result: table +
optional chart + the SQL shown) · `CitationChip`.

Every generated card has **"Pin to dashboard."** Every figure everywhere is cited and clicks
through to the source doc/page — the project's trust promise, made visible.

---

## 6. Modules & files

### 6a. Repo shape (new workspace root)
Introduce a workspace (pnpm or npm — decide in planning; pnpm preferred) so three packages share code:

```
mke-budget-commons/
├─ package.json            ← NEW workspace root (private; workspaces: packages/*, mcp, apps/*)
├─ packages/
│  └─ budget-tools/        ← NEW  @mke/budget-tools
│     ├─ src/queries/*.ts     one file per tool-family (departments, breakdown, compare,
│     │                       positions, schools, search, sql)
│     ├─ src/schemas.ts       Zod input/output schemas (moved from index.ts)
│     ├─ src/citation.ts      provenance shaping (doc_id + source_page → CitationChip shape)
│     ├─ src/db.ts            moved from mcp/src/db.ts — the mcp_ro pool
│     ├─ src/schema.ts        NEW describeSchema() — tables/cols for the SQL-writing model
│     └─ src/index.ts         barrel export
├─ mcp/                    ← THIN consumer: registrations import @mke/budget-tools
│  └─ src/index.ts            ~870 → ~250 lines (tool wiring only, no SQL)
└─ apps/
   ├─ explainer/           (unchanged static page)
   └─ budget-agent/        ← NEW Next.js 15
```

### 6b. `apps/budget-agent/`
```
app/
  layout.tsx  page.tsx            ← Journalist dashboard route
  api/copilotkit/route.ts         ← CopilotRuntime + Anthropic adapter (server); rate-limit here
components/
  dashboard/                      ← HeroUI Pro panels: TrustBar, BiggestChanges,
                                     WhereMoneyGoes, Findings, SearchCite, GovYearSelectors
  generative/                     ← card vocabulary, ONE implementation, rendered by BOTH
                                     dashboard panels AND copilot render():
                                     StatCard, DeltaTable, BreakdownChart, ComparisonCard,
                                     FindingCard, InvestigationTrace, QueryResultCard, CitationChip
lib/
  copilot/actions.ts              ← all L3 tools (16, incl. run_sql) → useCopilotAction defs
  copilot/readables.ts            ← dashboard state (gov, year, persona) → useCopilotReadable
  personas.ts                     ← starter questions + tool emphasis per persona
  ratelimit.ts                    ← per-IP limiter for /api/copilotkit
prompts/
  base.md  journalist.md          ← versioned system prompt + overlay (§4)
```

**Key structural bet:** `components/generative/*` is authored once and consumed twice — the
dashboard renders a `BreakdownChart` directly; the copilot renders the *same* component via
`useCopilotAction`'s `render`. That makes "Pin to dashboard" trivial and keeps one design system.

---

## 7. Trust model (inviolable rule enforced in depth)

- **Prompt layer:** never state a number a tool didn't return; never hand-compute (§4).
- **Tool layer:** every query fn selects `doc_id` + `source_page`; `citation.ts` shapes it; no
  card renders a figure without a `CitationChip`.
- **SQL layer:** `run_sql` stays behind `guardSelect` (SELECT-only) **+ statement timeout + row
  cap**, and **shows the SQL** in `QueryResultCard`. Aggregates cite source doc(s); rows drill
  to pages.
- **DB layer:** `mcp_ro` read-only role — structurally cannot write.
- **Coverage honesty:** prompt knows what's parked (county capital OCR, amendments) and says so.

---

## 8. Testing

- **`@mke/budget-tools`:** unit-test each query fn (pure SQL→typed). The existing
  `mcp/test/smoke_*.mjs` truth-checks migrate and harden down to this shared layer.
- **Generative cards:** component tests (render + citation-chip-presence assertion).
- **E2E:** 1–2 Playwright "investigation" flows asserting **cited output + zero uncited numbers**.
- **Contract guard:** MCP smoke tests stay green after extraction — proves the refactor didn't
  change the L3 contract (this is the gate that lets the Prep PR merge).

---

## 9. Error handling

- Tool/SQL errors → graceful copilot message ("I couldn't find that in the loaded data") —
  **never fabricated data.**
- `run_sql` timeouts → "that query was too broad."
- Empty-state dashboards for missing gov/year.
- Anthropic/rate-limit errors → friendly "try again in a moment," never a stack trace.

---

## 10. Phasing (for `writing-plans` to expand)

1. **Prep PR — extraction (decision #10).** Workspace root + `@mke/budget-tools` (queries,
   schemas, citation, db, `describeSchema`) + thin `mcp/` + migrated/hardened unit tests. **Gate:
   MCP smoke tests green, typecheck clean.** Merge before anything below.
2. **`budget-agent` shell.** Next.js 15 + HeroUI Pro + CopilotKit; `/api/copilotkit` with
   Anthropic adapter + base/journalist prompts + rate-limit seam; empty dashboard route.
3. **Actions + readables.** Wire all L3 tools (incl. `run_sql`) as CopilotKit actions; dashboard
   state as readables. (Enumerate the exact tool set from the thinned `mcp/` during this phase.)
4. **Generative cards + dashboard panels.** The shared `components/generative/*` vocabulary
   (Recharts for charts) + the six Journalist panels; "Pin to dashboard."
5. **Trust + polish.** Citation chips everywhere, SQL display, coverage honesty, error/empty
   states, E2E investigation tests.
6. **Deploy.** Vercel + spend-cap alert.

---

## 11. Open items deferred to planning (not blockers)

- Workspace tool: **pnpm** vs npm workspaces (pnpm preferred; confirm during Phase 1 planning).
- Exact rate-limit backend (Upstash Redis vs Vercel KV) — an implementation detail of #13.
- Anthropic model id + adapter config specifics (resolve against current CopilotKit + Anthropic
  SDK docs at build time).
- Parent/Citizen personas — explicitly **out of scope for Phase 1**; overlays only.

**Still out of charter (do not scope-creep):** MMSD/MATC, capital budgets, ACFR
actuals-monitoring. County capital stays parked (OCR, not reconciliation-grade).
