# Handoff — Budget Agent (L4) brainstorming, resume at Section 3

**For:** the next session/agent continuing the `superpowers:brainstorming` flow for the
**budget agent web app**. We are mid-brainstorm. Sections 1, 1b, and 2 of the design are
**approved by the user**. This doc captures every decision so a fresh context can present
**Section 3** and finish the design → spec → plan.

**How to resume:**
1. Re-enter the `superpowers:brainstorming` process (you are between "present design sections"
   and "write design doc").
2. Present **Section 3** (module/file breakdown + trust model + testing) — draft below.
3. Get approval, then write the spec to `docs/superpowers/specs/2026-07-07-budget-agent-design.md`,
   self-review, user-review gate, then invoke **`writing-plans`** (the only next skill).
4. **HARD GATE still applies:** no code, no scaffolding, no implementation skills until the
   spec is written and the user approves it.

---

## What we're building

An **L4 app** in this repo (`apps/budget-agent/`) — a **budget agent** that turns the
reconciled Milwaukee budget data into persona dashboards with an AI copilot. It reads the
**L3 contract only** (the MCP tools' logic / Neon read-only). It is a client of everything
already built; it never writes to the canonical store and the model never touches numbers.

**Existing context it builds on (already on `main`):**
- L3 MCP server (`mcp/src/index.ts`, ~870 lines, TypeScript, stdio) exposing ~17 read-only,
  cited tools over Neon (`mcp_ro` role): `list_departments`, `get_department_budget`,
  `budget_breakdown`, `compare_years`, `trace_adoption`, `biggest_changes`,
  `search_line_items`, `get_positions`, `find_positions`, `cite`, `glossary`,
  `reconciliation_status`, `run_sql`, `compare_schools`, `mps_fund_summary`,
  `per_pupil_ranking`.
- Data: city (detailed + requested), county (operating + non-dept ledgers + tax-levy
  crosswalk), MPS (line-item + per-pupil). Everything reconciled + cited (doc_id + source_page).
- Neon tables: `fact_budget_line`, `fact_school`, `dim_department`, `dim_document`,
  `dim_government`, `reconciliation_result`.
- Only prior L4 = `apps/explainer/index.html` (a static page). Whole stack is TypeScript.

---

## Decisions LOCKED (via the user, this session)

| # | Decision | Choice |
|---|---|---|
| 1 | Core experience | **Dashboard-first + copilot** (curated persona dashboards; CopilotKit as side/bottom copilot that drills in, filters, explains) |
| 2 | Scope | **Vertical slice: Journalist persona first**, wired to all 3 governments. Then Parent, then Citizen (mostly component reuse). |
| 3 | UI stack | **Next.js 15 + HeroUI Pro + CopilotKit** (copilot renders generative UI into the same HeroUI design system) |
| 4 | Agent framework | **Approach A — CopilotKit native `CopilotRuntime` + Anthropic (Claude) adapter.** MCP tools become CopilotKit actions; `useCopilotReadable` exposes dashboard state; `useCopilotAction` `render` for generative UI. One TS app. |
| 5 | Deploy + data path | **Vercel + shared query module.** Extract the tools' SQL logic from `mcp/src/index.ts` into a shared package **`@mke/budget-tools`** that BOTH the MCP server and the CopilotKit actions import. Copilot queries Neon (read-only) directly — no subprocess. One source of truth. |
| 6 | AG-UI | **NOT used in Phase 1.** Native runtime speaks AG-UI internally; we don't author it. AG-UI is the **escape hatch** for Phase 2 (Approach B) — CopilotKit renders native actions AND AG-UI agents through the same frontend, so A→B is additive. |
| 7 | Investigations | **Claude's native multi-tool loop + narration** (Approach A). System prompt makes it state a plan and narrate each step; CopilotKit streams tool calls live. Handles the 4–6 step "find the story" flows. Design the AG-UI seam for later graduation to a Claude Agent SDK agent if depth demands. |
| 8 | Cross-table analysis | Copilot can answer **novel joins across tables/governments via `run_sql`** (already read-only + `guardSelect`). LLM writes the query, Postgres computes over reconciled rows → the inviolable rule holds. Provenance preserved (select `doc_id`/`source_page`; aggregates cite source doc(s) + drill to per-row pages). **Show the SQL** (auditable). Add safety rails: statement timeout + row cap + a `describe_schema` capability. |
| 9 | Agent persona/voice | Base "Milwaukee Budget Expert" system prompt + persona overlays. **Write like a Wisconsin Policy Forum analyst** (research below). Plain-English mandate; never invent/hand-compute a number; always cite; glossary-tool-grounded definitions; honest about coverage gaps. |

---

## Design SECTIONS 1, 1b, 2 — approved (content)

### Section 1 — Architecture & data flow (APPROVED)
```
apps/budget-agent (Next.js 15, Vercel)
  Browser: HeroUI Pro dashboard + CopilotKit copilot (sidebar desktop / bottom-sheet mobile)
     │  useCopilotReadable (dashboard state → AI) ; generative UI streamed back
  Server: CopilotRuntime (Anthropic/Claude adapter)
     │  copilot actions = the ~17 tools + run_sql
     ▼
  @mke/budget-tools  (shared TS pkg: query fns + Zod schemas + citation shaping)  ← ONE source of truth
     ▼
  Neon Postgres (mcp_ro, READ-ONLY, cited)
     ▲
  mcp/ MCP server (unchanged contract) ALSO imports @mke/budget-tools
```
Preserves: (a) "L4 reads the L3 contract"; (b) model never touches numbers (tools → Neon;
Claude only orchestrates + narrates cited results); (c) read-only.

### Section 1b — System prompt (APPROVED, enriched with WPF persona)
Base prompt + swappable persona overlays, as **versioned files** in `apps/budget-agent/prompts/`.
Base "Milwaukee Budget Expert" covers:
- **Identity/fluency:** funds, fund types, reserved codes (006000 salaries, etc.), tax levy,
  per-pupil, FTE, reconciliation — understands the domain so it can translate it.
- **Plain-English mandate:** explain anything to anyone; define jargon inline first use;
  depth adjustable ("explain like I'm 12" / "technical breakdown"); default tone from overlay.
- **Inviolable rule as behavior:** never state a $/FTE/% that didn't come from a tool; never
  do arithmetic a tool/SQL can do; if it's not in the data, say so — never estimate or guess.
- **Always cite in plain language** ("according to page 47 of the 2026 Adopted Budget");
  use the `glossary` tool for definitions so explanations are sourced too.
- **Honest about coverage:** knows what's loaded vs parked (county capital OCR; amendments
  not available) and says so.
- **Tool-selection rule:** prefer a typed tool; use `run_sql` for cross-table/cross-gov
  analysis; always select provenance columns; show the query; cite; never invent/hand-compute.
- **Investigation instruction:** state a plan, chain tools narrating each step, synthesize a
  cited answer with a suggested angle.

Persona overlays (thin): **Journalist** (outliers, YoY swings, comparisons, reconciliation
findings as leads, always sourced) · Parent (your school, per-pupil, staffing, warm plain
language) · Citizen (where taxes go, big picture, minimal jargon).

### Section 1b addendum — **Wisconsin Policy Forum analyst voice** (researched this session)
The base voice should emulate a WPF analyst (wispolicyforum.org — nonpartisan Wisconsin
state/local govt fiscal research; 2018 merger of the Public Policy Forum + Wisconsin
Taxpayers Alliance; ~one report/week; heavy Milwaukee city/county/MPS focus). From their
2023 City of Milwaukee Budget Brief, concrete style rules for the prompt:
- **Nonpartisan, independent, objective.** Analyze what the budget *does* and *means* — never
  what officials *should* do, never partisan blame. "independent, comprehensive, and objective."
- **Every number is contextualized:** vs. prior year ("$100M, up from $71M this year"), vs.
  multi-year/historical range ("lowest levels in decades"), vs. what was originally
  anticipated ("down from the $121M originally anticipated"), per-capita/per-pupil, and
  inflation-adjusted where relevant.
- **Explain the "so what"** — impact on services and taxpayers — plainly, without prescribing.
- **Measured and precise, not dry.** Restrained; an occasional vivid *fact-grounded* frame
  ("a pension cliff," "nearing the precipice"). The drama is in the facts, not adjectives.
- **Distill into a few plain-language key findings** — their numbered "Keys to Understanding
  the Budget" pattern.
- **Present both good and concerning news; caveat and condition** ("for now," "if the stock
  market fails to recover…"). Acknowledge uncertainty.
- **Always sourced.** Cite figures (our doc + page); attribute.
This maps 1:1 onto our tools (compare_years = prior-year context; reconciliation_status =
findings/leads; per_pupil_ranking = per-pupil; biggest_changes = trends). The persona IS a
WPF-style analyst operating over our reconciled, cited data.

Sources: https://wispolicyforum.org/about-us/ ·
https://wispolicyforum.org/wp-content/uploads/2022/10/2023CityOfMilwaukee_BudgetBrief.pdf

### Section 2 — Journalist product surface (APPROVED / "feels complete")
Dashboard (HeroUI Pro), desktop = grid + copilot sidebar; mobile = single column + bottom-sheet.
Panels map to tools:
- **Trust bar (KPI row):** total budget · YoY change · reconciliation status ("100% reconciled,
  N findings") — trust signal + story source.
- **Biggest changes** (story-finder) = `biggest_changes`.
- **Where the money goes** = `budget_breakdown`.
- **Findings** = `reconciliation_status` (documented source-inconsistencies = story leads).
- **Search + cite** = `search_line_items` + `cite`.
- Gov/year selectors → `useCopilotReadable` state (copilot is context-aware).

Copilot generative-UI vocabulary (HeroUI cards via `useCopilotAction` `render`), each with a
**citation chip** (doc + page → links to source): `StatCard` · `DeltaTable` · `BreakdownChart`
· `ComparisonCard` · `FindingCard` · `InvestigationTrace` (live plan + step narration) ·
`QueryResultCard` (SQL result: table + optional chart + the SQL shown) · `CitationChip`.
Any generated card has **"Pin to dashboard."** Every figure everywhere is cited + clicks
through to the source doc/page (the project's trust promise, made visible).

---

## REMAINING — present next

### Section 3 (DRAFT to present + get approval) — modules/files + trust & testing
Proposed shape (refine with user):
- **`packages/budget-tools` (`@mke/budget-tools`):** extract query fns + Zod schemas + citation
  shaping from `mcp/src/index.ts`; `mcp/` becomes thin tool registrations importing it. New:
  `describeSchema()` + safety-wrapped `runSql()` (statement timeout, row cap). *Targeted cleanup
  the skill encourages — `index.ts` is large and mixes SQL with wiring.*
- **`apps/budget-agent/` (Next.js 15):**
  - `app/` routes; `app/api/copilotkit/` runtime handler (Anthropic adapter).
  - `components/dashboard/*` (HeroUI panels) + `components/generative/*` (the card vocabulary,
    shared by dashboard + copilot render).
  - `lib/copilot/actions.ts` (tools→actions), `lib/copilot/readables.ts` (dashboard state).
  - `prompts/base.md` + `prompts/journalist.md`.
  - `lib/personas.ts` (starter questions, tool emphasis per persona).
- **Trust model:** citation on every figure; `run_sql` shows query + provenance columns +
  drill-down; "no invented numbers" enforced at prompt + tool layers; read-only role.
- **Charts:** HeroUI + a chart lib (Recharts likely) — decide; apply the `dataviz` skill palette.
- **Testing:** unit-test `@mke/budget-tools` query fns (they're pure SQL→typed) — reuse/extend
  what `mcp/test/*` already covers; component tests for generative cards; a couple of E2E
  "investigation" flows (Playwright) asserting cited output + no uncited numbers. MCP smoke
  tests still guard the shared module.
- **Error handling:** tool/SQL errors surface as graceful copilot messages ("I couldn't find…")
  never fabricated data; timeouts on `run_sql`; empty-state dashboards.

### Then
- Write spec → `docs/superpowers/specs/2026-07-07-budget-agent-design.md`; commit.
- Self-review (placeholders/consistency/scope/ambiguity); user-review gate.
- Invoke **`writing-plans`**.

## Open questions to resolve in Section 3 (or during planning)
- Chart library choice (Recharts vs HeroUI charts vs visx).
- Auth? (public read-only app — likely none for Phase 1; confirm.)
- Does `@mke/budget-tools` extraction happen as part of this build or as a prep PR first?
- Rate-limiting / cost controls on the copilot (Anthropic usage) for a public app.
