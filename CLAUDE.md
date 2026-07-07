# CLAUDE.md — MKE Budget Commons

Machine-readable, reconciled Milwaukee City & County budget data with an agentic (MCP) access layer. Methodology mirrors [BetaNYC/New-York-City-Budget](https://github.com/BetaNYC/New-York-City-Budget): deterministic PDF parsing, every number reconciled against the document's own printed totals, **no language model ever reads the numbers.**

Full spec lives in `docs/PRD.md`. This file is the always-on operating contract.

## Working mode

**Build mode, not teaching mode.** Ship working code, explain briefly (2–3 sentences on non-obvious choices), keep moving. Don't run a Socratic loop unless I ask ("walk me through this"). Do surface real forks in the road — I want to know when a decision is load-bearing, I just don't want it turned into a lesson.

## The one inviolable rule

**A hard wall separates extraction (L1) from everything above it.**

- The parsing pipeline is pure Python, deterministic, regex + pdfplumber coordinates only. **No LLM calls, ever, anywhere in `parsers/` or `tests/`.** If a number can't be extracted deterministically, that's a parser bug or a documented source-document inconsistency — never a thing to "ask the model about."
- Agents (the MCP server, L3) **read** the canonical store. They never write to it and never participate in extraction.
- Every canonical row carries provenance: `source_doc` + `source_page`. Non-negotiable. If a value can't cite a page, it doesn't ship.

## Reconciliation is the product

Reconciliation failures are **findings, not exceptions to swallow.**

- Every extracted section must sum to the document's own printed total (see anchors below). Exact match. Rounding differences are documented explicitly, never silently absorbed.
- A section with no printed total to check against is labeled `NOT_RECONCILABLE` — never silently trusted. (BetaNYC pattern.)
- When extracted line items disagree with a printed total, that is very likely an arithmetic error *inside the official PDF* (BetaNYC hit two). Capture both the line items and the printed total faithfully, flag the discrepancy in the reconciliation report with disposition `source_inconsistency`, and move on. **That's a story, not a bug to hide.**
- Reconciliation runs as a pytest suite. Canonical Parquet/CSV is regenerated and committed only when the suite is green (or discrepancies are explicitly dispositioned).

## Architecture (4 layers)

```
L4 apps        →  read L3 only (Hakivo briefings, budget explainer, amendment tracker)
L3 mcp/        →  TypeScript MCP server, typed tools + read-only SQL, provenance on every response
L2 canonical   →  repo Parquet/CSV = source of truth (diffable, auditable) → Neon Postgres = serving layer (disposable, rebuilt from repo)
L1 parsers/    →  Python, deterministic, pdfplumber + regex, reconciled by tests/
```

Repo is the source of truth; **Neon is disposable** — `db/load.py` rebuilds it entirely from repo Parquet, idempotently. Never hand-edit Neon; edit the pipeline and reload.

## Verified parsing facts (city Detailed Budget, 2026 Adopted)

Confirmed against the real PDF — don't re-derive, but DO derive column bands per-page at runtime (layout drifts between years).

- Clean Arial/WinAnsi text layer, 612×792pt letter portrait. No OCR needed for city P0 docs.
- **Three value vintages in the adopted book:** 2024 *actuals* (x1≈217) / 2025 budget (x1≈289) / 2026 adopted (x1≈557). Budget-vs-actual is free — carry `amount_kind` (`actual`|`budget`|`requested`|`proposed`|`adopted`).
- Column bands (2026 book, derive per-page from header words, don't hardcode): account codes left at x0 ≈ 36/61/85/121 (FUND/ORG/SBCL/ACCOUNT); numbers **right-aligned** (assign by x1); descriptions left at x0=312; pay range at x0≈469.
- **Reconciliation anchors = reserved account codes:** `006000` NET SALARIES & WAGES · `006100` FRINGE BENEFITS · `006300` OPERATING EXPENDITURES · `006800` EQUIPMENT PURCHASES · `SPECIAL FUNDS TOTAL` (no code) · `<X> TOTAL` division/dept rows · `TOTAL NUMBER OF POSITIONS AUTHORIZED` · `O&M FTE'S` / `NON-O&M FTE'S`.
- **Position reclassification spans two physical lines:** 2025 side on line 1 with old pay range (e.g. `2IX`), 2026 side on line 2 with same title + new pay range (`2JX`). Join into one logical record. Negatives print in parens: `(42,642)`.
- Footnote codes on titles — `(A)(Y)(X)(CCR)(BPS)(BU)(CP)` etc. — captured raw into `flags[]`; glossary in `crosswalks/footnote_codes.yml`.
- **Requested Budget doc** (2027 verified) is the diff document: 4 value columns (prior actual / current budget / requested / proposed), same architecture.

## Verified parsing facts (county Adopted Operating Budget, 2026)

- **Different species — narrative chapters with summary tables, NOT a line-item ledger.** FrameMaker, clean text layer.
- Department chapters keyed by `Agency No. NNN` in the running header (e.g. `Office of the County Treasurer (309)`).
- **BUDGET SUMMARY table** per department: rows = Personnel/Operations/Debt & Depreciation/Interdepartmental/Total Expenditures/revenue rows/Total Revenues/Tax Levy; cols = 2023 Actual / 2024 Actual / 2025 Budget / 2026 Adopted / Variance.
- Per-Strategic-Program-Area **Program Budget Summary** tables (same cols) + **Activity Data** (performance measures) + **Major Changes** narrative bullets.
- **Gotcha:** some section-title lines have overlapping text layers extracting as garbage (`BUDGET309 - O ffice oSf...`). Anchor on the clean `Agency No. NNN` header and on category row names — never on section titles.
- County facts load into `fact_budget_line` as `line_kind='category'|'program'`, `division`=program area, `account` NULL. Table-detection job, not band parsing.
- **County Capital Budget is OCR (Acrobat Paper Capture)** — not reconciliation-grade without QA. Phase 5+, deferred.

## Stack & conventions

- Python 3.12, `pdfplumber` (coords) + `pypdf` (fallback text), `pandas`, `pyarrow`, `pytest`. Install with `pip install -r requirements.txt`.
- One parser module per doc-family per government: `parsers/city_detailed.py`, `parsers/county_operating.py`, etc. Shared normalization contract in `parsers/canonical.py`; **shared normalization, never shared parsing code** across city/county.
- Derive rosters (departments, divisions, funds) from each document — never hardcode. This is what makes a new fiscal year parse with config, not code changes.
- Every parser emits its raw CSV **and** a `docs/reconciliation-reports/<doc_id>.md`. No silent parses.
- Source PDFs live in `data/raw/` with `sources.yml` (URL, retrieved date, sha256). Both gov sites block bot fetching — acquisition is manual, documented in the manifest.
- Canonical output: Parquet (source of truth) + CSV (human-diffable) side by side under `data/canonical/<gov>/<fy>/<doc_type>/`.

## Commands

```bash
make parse-city-detailed FY=2026 TYPE=adopted   # parse one doc family
make reconcile                                   # run the pytest reconciliation suite
make load-neon                                   # rebuild Neon from repo Parquet (idempotent)
make mcp-dev                                      # run the MCP server locally (stdio)
```

(If `make` targets don't exist yet, they're TODO — build them as we go; the Makefile is the source of truth for how to run things.)

## What NOT to do

- Don't let an LLM read, transcribe, or "clean up" budget numbers. Deterministic or it doesn't ship.
- Don't hardcode column x-positions — derive from header words per page.
- Don't hand-edit the Neon database — edit the pipeline, reload.
- Don't ship a row without `source_page`.
- Don't scope-creep into capital budgets, ACFR/actuals-monitoring, or MPS/MMSD/MATC. Operating budgets first. (Capital is Phase 5+, and the county capital doc is OCR anyway.)
- Don't swallow a reconciliation mismatch — flag it, disposition it, surface it.
