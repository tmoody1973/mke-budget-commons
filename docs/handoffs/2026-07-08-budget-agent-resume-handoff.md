# Handoff — Budget Agent (Plan 2): resume in a fresh context

**For:** the next session. The budget-agent L4 app is built, working, and live-verified on a **draft PR**. This doc gives a fresh context everything it needs to pick up **either** of two paths:
- **Option A — Finish the app:** Task 9 (error/empty states + Playwright E2E) → final review → un-draft the PR.
- **Option B — Build WPF Layer 2:** the cited RAG "context corpus" (spec already written).

Read the **"Must-know facts & gotchas"** section before touching app code — it's hard-won.

---

## Where things stand

- **Branch:** `feat/budget-agent-app` (HEAD `1907d4f` at handoff). **Draft PR #9:** https://github.com/tmoody1973/mke-budget-commons/pull/9 → base `main`. 20 commits ahead.
- **Plan 1 (extraction) already merged** to `main` as PR #8: `@mke/budget-tools` shared query package + thinned MCP server.
- **Plan 2 (this branch) — the app** is built and live-verified end-to-end. Production build green.
- **Working tree clean.** Dev server stopped. `wi-policy-forum/` (3 copyrighted WPF PDFs) is **gitignored** — inputs for Layer 2, not committed.
- **Ledger** (gitignored scratch, full blow-by-blow): `.superpowers/sdd/progress.md`.
- **Durable memory:** `~/.claude/projects/-Users-.../memory/budget-agent-stack.md` — the working CopilotKit v2 config.

### What's built and working (all live-verified in a browser)
- **Shared package `@mke/budget-tools`** (on `main` + extended here): typed returns + `Ambiguous` variant; `budget_breakdown` carries real citations; **extensionless internal imports** (so bundlers can consume it). Unit tests 13/13; MCP smoke 3/3.
- **App `apps/budget-agent/`** — Next.js **16** (Turbopack) + React 19 + HeroUI v3 **+ HeroUI Pro** + Tailwind v4 + Recharts + CopilotKit **v2**.
  - **Copilot:** CopilotKit v2 runtime at `app/api/copilotkit/[[...slug]]/route.ts` — `BuiltInAgent` on **Claude Sonnet 5** (`anthropic/claude-sonnet-5`), `single-route` mode, WPF-analyst system prompt (`prompts/base.md` + `journalist.md`). 9 `defineTool`s wrap `@mke/budget-tools` (`lib/tools/server-tools.ts`).
  - **Generative UI:** tool calls show as chips; **3 cards** render tool results as Recharts charts + right-aligned cited tables via `useRenderTool` (`components/copilot/tool-renderers.tsx` → `components/generative/{BudgetBreakdownCard,BiggestChangesCard,DepartmentBudgetCard,CitationChip}.tsx`).
  - **Dashboard:** server component `app/page.tsx` fetches `@mke/budget-tools` directly (read-only, cited), renders `TrustBar` + two panels (reusing the cards) + top nav (`components/shell/{top-nav,nav-items}.tsx`). Gov switch via `?gov=` URL param → server re-fetch. Works across **City / County / MPS**.
  - **Copilot sidebar** titled **"Budget Analyst"** (right side); top nav (left→top, per feedback, to free width).
- **WPF Layer 1 (shipped):** the 3 Wisconsin Policy Forum briefs' wisdom distilled into `prompts/base.md` (per-gov storylines + "Keys to Understanding" habit + plain-English terms), with a **strict rule: WPF = wisdom/framing only, attributed; every figure still from a reconciled tool, cited.** Live-verified.
- **WPF Layer 2 (scoped, not built):** spec at `docs/superpowers/specs/2026-07-08-wpf-context-corpus.md`.
- **Trust proven:** every copilot figure was checked against tool output and matches exactly; the model never computes numbers.

---

## Must-know facts & gotchas (READ before app work)

These cost real debugging. All are committed with fixes; a fresh session must not re-break them.

1. **Next.js is 16, not 15** — `apps/budget-agent/AGENTS.md` says read `node_modules/next/dist/docs/` before writing app code. Async request APIs, etc.
2. **CopilotKit v2 lives at the `/v2` subpath:** `@copilotkit/runtime/v2`, `@copilotkit/react-core/v2`. Key API: `new BuiltInAgent({ model, prompt, tools, maxSteps })` (system prompt field is **`prompt`**); `new CopilotRuntime({ agents: { default } })`; `createCopilotHonoHandler({ runtime, basePath, mode: "single-route" })` → `hono/vercel` `handle`.
3. **`mode: "single-route"` is REQUIRED** — the v2 client calls `fetchRuntimeInfoSingle` and **404s** against the default `multi-route`.
4. **Model must be a REAL Anthropic id.** CopilotKit's alias `anthropic/claude-sonnet-4.5` returns **404 not_found** from the API. Use `anthropic/claude-sonnet-5`.
5. **`pg` must not enter the client bundle.** Client components use **type-only** imports from `@mke/budget-tools` + **inline Zod schemas** (never import its runtime values). `next.config.ts`: `transpilePackages: ["@mke/budget-tools"]`, `serverExternalPackages: ["pg"]`, `turbopack.root` pinned to repo root.
6. **`useRenderTool` `props.result` is a JSON string** — `JSON.parse` it. Render props: `{ name, status: "inProgress"|"executing"|"complete", parameters, result }`.
7. **HeroUI Pro CSS:** `app/globals.css` must import **`@heroui/styles/css`** (not `@heroui/styles`) + `@heroui-pro/react/css` or Pro components render unstyled. Pro is licensed (GitHub-OAuth, already logged in as `@tmoody1973`).
8. **`@mke/budget-tools` internal imports are extensionless** (not `.js`) so Turbopack bundles it. Don't reintroduce `.js`.
9. **Recharts `Tooltip formatter` param is `ValueType`, not `number`** (production build catches it; dev doesn't). Chart height should be ~48px/bar so labels don't cram; no `sticky` table headers (they overlap on page scroll).
10. **County `budget_breakdown` returns `total_expenditures`; city/mps return `total`** — cards handle both. (Follow-up: normalize in the package.)
11. **`.env.local`** (gitignored) holds `MCP_DATABASE_URL` (read-only Neon) + `ANTHROPIC_API_KEY`. Needed at build + runtime.
12. **Reconciliation status keys:** `pass / not_reconcilable / source_inconsistency / open / info` (there is no `reconciled` key). `pass` = reconciled (~89%); `source_inconsistency` = the "findings."

### How to run / verify
```bash
# from repo root
npm install
npm run -w @mke/budget-tools test          # 13/13 (needs .env MCP_DATABASE_URL)
make mcp-test                                # MCP smoke 3/3 (L3 contract intact)
npm run -w budget-agent build                # PRODUCTION build — the real typecheck gate
npm run -w budget-agent dev                  # http://localhost:3000  (needs ANTHROPIC_API_KEY for the copilot)
```
Verify UI/copilot with Playwright MCP (the app renders a copilot sidebar "Budget Analyst" + a top-nav dashboard). Use **viewport** screenshots, not `fullPage` (Recharts collapses under fullPage capture).

---

## Option A — Finish the app (Task 9 → review → un-draft PR)

The remaining foundation-slice work from `docs/superpowers/plans/2026-07-08-budget-agent-app.md`.

**Task 9 — Trust baseline + E2E:**
- Graceful **empty/error states** on cards + panels (already partly present): tool/SQL errors → friendly copilot message, never a stack trace or fabricated number; empty-state for missing gov/year.
- **Playwright E2E** (`apps/budget-agent/e2e/`): drive the app, ask an investigation question, assert (a) ≥1 `CitationChip` present, (b) no dollar figure without a citation. Cards already carry `data-figure` / `data-citation` / `data-testid` hooks. Skip cleanly (with reason) if `ANTHROPIC_API_KEY`/DB absent in CI.

**Then:** final whole-branch review (Opus) → address findings → **un-draft PR #9** and merge when the user approves.

**Polish follow-ups (in the PR body; triage before merge):**
- Normalize `@mke/budget-tools` county `budgetBreakdown` (`total_expenditures` → `total`).
- TrustBar reconciliation is **global** (all docs) — refine to per-government (filter `reconciliationStatus` by the gov's docs).
- Wire the gov selector into the copilot's `useAgentContext` so the copilot follows the dashboard's gov/year.
- **Before any public launch:** move the system prompt off the `messages`-as-system path (AI SDK prompt-injection warning) to a dedicated system option; add **rate-limit + Anthropic spend cap** on `/api/copilotkit`.
- Remaining Journalist panels + full card vocabulary; Vercel deploy.

---

## Option B — Build WPF Layer 2 (cited RAG context corpus)

Full design in **`docs/superpowers/specs/2026-07-08-wpf-context-corpus.md`**. Summary:

- **The rule (locked):** WPF = **wisdom only, attributed**; every `$`/FTE/`%` still comes from a reconciled tool and is cited. WPF is a **secondary context corpus**, never a fact source. Preserves the inviolable reconciliation wall.
- **Architecture (mirrors L1→L4):** parse the 3 briefs → cited prose **chunks** (`parsers/wpf_briefs.py`, deterministic, prose-grade not reconciliation-grade — they're design PDFs, so OCR/de-space) → repo canonical CSV/Parquet → **Neon `pgvector`** `context_chunk(source='wpf', gov, year, page, text, embedding)` → an `explain(question, gov?, k?)` retrieval tool in `@mke/budget-tools` (+ MCP + app `defineTool`) → a `ContextCard` rendered via `useRenderTool` (WPF quote + brief·page chip + link).
- **The one new dependency (conscious yes):** an embedding model at **L2 load time only**, over the secondary corpus, never touching canonical numbers — recommend a cheap embedding API or local sentence-transformer, run in Python `db/load` for consistency with the pipeline.
- **Source PDFs:** `wi-policy-forum/*.pdf` (gitignored, copyrighted). Only the **derived, attributed chunks** get committed. Keep quotes short + attributed + linked to WPF.
- **Next step:** expand the spec's 7-task outline into a bite-sized plan (`writing-plans`) and build via subagent-driven-development (the same flow used for Plan 1). The briefs' structure: About → Preface → Intro → Overview → "N Keys to Understanding" → Conclusion; City=5 keys, County=4 keys, MPS=5 keys (details in the spec + `prompts/base.md`).

---

## Suggested resume order

Either is valid; if unsure, **Option A first** (finishing the shippable app slice is higher-leverage than adding a new subsystem). Option B is a clean, self-contained build whenever the user wants the deeper explanatory capability. Both live on the same branch/PR.

**Do not** re-run completed work — check `.superpowers/sdd/progress.md` and `git log main..HEAD` first. The 20 commits there are done and verified.
