# Handoff — Milwaukee County Operating & Capital Budgets

**For:** the next session/agent picking up county parsing.
**Status:** city side is done (L1→L4 live). **County operating L1 + L2-loader are now
built and green** (see status box below). County capital is still deferred.
This doc is a grounded implementation spec — the structure below was **verified
against the actual PDFs**, not just the PRD.

---

## ✅ STATUS (updated) — County Operating P0 done at L1, wired at L2

**Built and green:**
- `parsers/county_operating.py` — `Agency No. NNN` chapter segmentation +
  `extract_tables()`; emits canonical `BudgetLine` rows (`category`/`program`/`fte`,
  `account=NULL`, all four vintages, `source_page` on every row).
- `parsers/reconcile_county.py` — the five printed identities (components→Total
  Expenditures; revenues→Total Revenues; Exp−Rev=Tax Levy; Variance=2026−2025;
  program rollup). Budget/adopted must match **exactly**; prior-year **actual**
  columns carry a bounded `ROUNDING` status (drift ≤ `(N+1)/2` for an N-addend sum,
  surfaced, never swallowed).
- `scripts/report_county_operating.py` → `docs/reconciliation-reports/county-2026-adopted-operating.md`.
- `tests/test_reconcile_county_operating.py` — 8 tests; full suite 28 green.
- `db/load.py` — county facts join the fact load; `load_reconciliation_county()`
  writes county checks. `make parse-county-operating` runs parser+report.

**Result:** 37 chapters, **37/37 dollar-reconciled**, 0 open findings.
5 exact · 28 reconciled-with-actual-rounding · 4 non-standard (`NOT_RECONCILABLE`).
Canonical: `data/canonical/county/2026/adopted/county-operating-book.parquet` (3,440 lines).

**Done since (L2 + L3 now live):**
1. ✅ **`make load-neon` run** — Neon rebuilt from repo Parquet: 61 departments,
   17,203 budget lines (3,440 county), 3,143 reconciliation checks. County recon:
   746 pass · 64 rounding (stored `source_inconsistency`) · 4 not_reconcilable · 0 open.
2. ✅ **MCP county branches (L3):** `get_department_budget` + `budget_breakdown` have
   county branches reading the category rows; a unified `grandTotalPred` makes
   `list_departments`/`compare_years`/`biggest_changes`/`trace_adoption` gov-agnostic.
   `make mcp-test` covers county (asserts against printed figures); city smoke green.

**What's left (next session):**
1. **Non-departmental ledgers (follow-up):** the 4 `NOT_RECONCILABLE` chapters
   (Non-Departmental Revenues 190 / Expenditures 194, Cultural Contributions,
   Property Taxes) carry revenue-ledger / rollup tables, not the standard
   departmental summary. Their line items are **not yet emitted as facts** — add a
   revenue-ledger table type (sum of items == Total Revenues) to capture them with
   provenance rather than drop them.

---

**Original spec (below) — kept for reference; Part 1 is now implemented.**

**Golden rule (unchanged):** deterministic parsing only, no LLM ever reads the
numbers; every canonical row cites `source_page`; reconciliation failures are
findings, not exceptions to swallow.

---

## TL;DR

1. **Do the operating budget first.** It's a clean, native-text, `extract_tables`
   job — genuinely different from the city (table detection, not column bands),
   but very tractable. This is P0.
2. **Defer the capital budget.** It's OCR (Acrobat Paper Capture) with scrambled
   text layers — not reconciliation-grade without a QA pass. Phase 5+.
3. **Almost everything above L1 already transfers** — canonical schema, the
   reconcile→report→load→MCP pipeline, the Neon loader (`DOCS` list), the MCP
   tools (they already take `gov: "county"`). You mainly write
   `parsers/county_operating.py` + a `reconcile_county.py`.

---

## Part 1 — County Operating Budget (P0, build this)

**File:** `data/raw/county/2026-Adopted-Operating-Budget-.pdf` · 442 pp · native
text · doc_id `county-2026-adopted-operating` (already in `data/raw/sources.yml`
and loaded into `dim_document`).

### Verified structure

A **different species from the city**: narrative department chapters, each with
summary **tables** (not a line-item ledger). One chapter per department.

- **Anchor: `Agency No. NNN`** in the running header, e.g.
  `County Board of Supervisors (100) Agency No. 100`. Clean and reliable — key
  every chapter off this. The `(NNN)` also appears inline.
- **`pdfplumber` `extract_tables()` works cleanly** on the summary tables (tested
  on p.78). You do **not** derive column bands like the city parser.
- **BUDGET SUMMARY table** (once per department):

  | Category | 2023 Actual | 2024 Actual | 2025 Budget | 2026 Adopted | Variance |
  |---|--:|--:|--:|--:|--:|
  | Personnel Costs | … | … | … | … | … |
  | Operations Costs | … | | | | |
  | Debt & Depreciation | … | | | | |
  | Interdepartmental Charges | … | | | | |
  | **Total Expenditures** | $… | | | | |
  | *(revenue rows, dept-dependent)* | | | | | |
  | **Total Revenues** | | | | | |
  | **Tax Levy** | $… | | | | |

  Then a **Personnel** block: `Full Time Pos (FTE)`, `Overtime $`,
  `Seasonal/Hourly/Pool`. Then narrative (`Department Mission`, `Vision`).
- **Four value vintages** (richer than the city's three): 2023 actual, 2024
  actual, 2025 budget, 2026 adopted — plus a printed **Variance** (2026 adopted −
  2025 budget) that's a free reconciliation check.
- Per-**Strategic Program Area**: a **Program Budget Summary** table (same
  columns) + **Activity Data** (performance measures) + **Major Changes**
  narrative bullets.

### The one real gotcha (verified)

Some section-title lines have **overlapping text layers that extract as garbage**:
`BUDGET100 - C ountyS Board of SUupervisors MMARY`. **Never anchor on section
titles.** Anchor only on the clean `Agency No. NNN` header and on the category
row names (`Personnel Costs`, `Total Expenditures`, `Tax Levy`, etc.), which
extract cleanly. (You'll also see harmless `FontBBox` warnings on stderr.)

### Parsing approach

1. Iterate pages; detect a department chapter start by the `Agency No. NNN`
   header (regex on the clean running header).
2. `page.extract_tables()`; identify the BUDGET SUMMARY table by its category
   row names (not its title). Read the 5 value columns by header position.
3. Emit one `BudgetLine` per (category row × vintage): `line_kind='category'`,
   `division=None`, `account=None`, `department_printed` = the agency name,
   `amount_kind` ∈ {actual, budget, adopted} with the right `fiscal_year`.
4. For each Strategic Program Area's Program Budget Summary, emit rows with
   `line_kind='program'`, `division` = the program-area name.
5. Carry `source_page` on every row (non-negotiable).

Reuse `parsers/canonical.py` `BudgetLine` unchanged — it already has
`line_kind` values `category` and `program`.

### Reconciliation contract (write `parsers/reconcile_county.py`)

Per department, per vintage:

- **Personnel + Operations + Debt & Depreciation + Interdepartmental Charges ==
  Total Expenditures** (exact).
- **sum(revenue rows) == Total Revenues** (depts with revenues; many are
  tax-levy-only, where Total Revenues = 0 and Tax Levy = Total Expenditures — the
  County Board is one such).
- **Total Expenditures − Total Revenues == Tax Levy** (exact).
- **Variance column == (2026 adopted − 2025 budget)** for each row (free check
  the document hands you).
- **Program Budget Summary rows sum to the department Budget Summary** (the
  program tables should reconcile up to the department total).
- Same disposition discipline as the city: exact match, or flag as
  `source_inconsistency` (verify by hand) / `not_reconcilable`, never swallow.
  Reuse `crosswalks/source_inconsistencies.yml` (add county entries as found).

### How it plugs into the existing pipeline

- **L2 loader:** add one entry to `DOCS` in `db/load.py`:
  `{"parquet": ".../county/2026/adopted/county-operating-book.parquet",
    "layout": None, "vintages": [ACTUAL, BUDGET, ADOPTED]}` — but county doesn't
  use a `Layout` (no band parsing), so give the loader a small county branch:
  parse via `county_operating.parse_book()` for reconciliation, and read its
  Parquet for facts. Keep `fact_budget_line` schema as-is (county rows have
  `account=NULL`, `line_kind` in `category|program`, and `fiscal_year` set).
- **`dim_document`** already has `county-2026-adopted-operating` from
  `sources.yml`. `dim_government` already has `county`.
- **L3 MCP:** the tools already accept `gov: "county"`. `list_departments`,
  `get_department_budget`, `compare_years`, `budget_breakdown`, `search_line_items`,
  `reconciliation_status` should light up for county once facts load. Note:
  `get_department_budget`/`budget_breakdown` key off city reserved codes
  (`006000` etc.) — add a county branch that reads the category rows
  (`Personnel Costs`, `Operations Costs`, …) instead. `get_positions`/pay-range
  tools won't apply (county has no per-position ledger — only FTE counts).
- **Report:** mirror `scripts/report_city_book.py` → `report_county_operating.py`.

### Build order (mirror the city's Phase 2 → 3)

1. Parse **one department** end-to-end (County Board / Agency 100 is the simplest
   — no revenues, no programs). Reconcile its Budget Summary exactly. Green.
2. Widen to all ~40 departments. Add the Program Budget Summary reconciliation.
3. Load Neon, add the county report, confirm the MCP county branch.

### Definition of done

One department's category rows sum exactly to Total Expenditures / Tax Levy and
the Variance checks pass; then the whole book with a reconciliation report; then
county data is queryable through the MCP with `gov: "county"`.

---

## Part 2 — County Capital Budget (deferred — here's why, and the path)

**File:** `data/raw/county/2026-Adopted-Capital-Budget4pt2.pdf` · 333 pp ·
**OCR text layer** (Acrobat Paper Capture) · doc_id
`county-2026-adopted-capital`.

### Verified: it's OCR-degraded

Prose extracts cleanly, but **section headers/titles are scrambled**:
`CountyAD FMUINNGICSTTRIOANTIVErounds` (Administrative Function / Grounds).
Projects are keyed by codes like `WJ0122` / sub-projects `WJ012201`. The
financial tables (project cost, funding sources) are where OCR digit errors bite,
and there is **no deterministic guarantee** the digits are right — which fails
the project's inviolable rule (reconciliation-grade or it doesn't ship).

### Recommendation: keep deferred (Phase 5+), per CLAUDE.md

If/when pursued:

1. **Re-OCR** the source with a modern engine (or obtain a native-text version
   from the county) before trusting any digit.
2. Anchor on **project codes** (`WJ0122…`) from the running headers, which are
   more stable than the scrambled titles.
3. **Cross-check** capital project totals against the operating budget's
   debt-service lines and any capital summary table, and flag every unverifiable
   figure as lower-confidence — **exclude OCR pages from "reconciled" status**.
4. Never present a capital number as reconciled unless it survives that QA.

Capital is a *different reliability tier*. Ship operating first; treat capital as
a separate, explicitly-caveated dataset.

---

## What you inherit (don't rebuild)

- `parsers/canonical.py` — the `BudgetLine` contract (has `category`/`program`
  line kinds and the `actual/budget/adopted` vintages already).
- The reconcile → report → `db/load.py` → Neon → MCP pipeline, and the MCP tools
  (already `gov`-parameterized).
- The dispositions pattern (`crosswalks/source_inconsistencies.yml`) and the
  "money-reconciled vs finding vs source-inconsistency" framing in
  `parsers/reconcile_city.py` — copy its shape for `reconcile_county.py`.
- `crosswalks/departments.yml` / `funds.yml` for county crosswalks as needed.

## First concrete steps

```bash
# 1. confirm the structure on a revenue-heavy dept (Parks, Transit/MCDOT, DHHS)
python - <<'PY'
import pdfplumber
op = pdfplumber.open("data/raw/county/2026-Adopted-Operating-Budget-.pdf")
# scan for a chapter with non-zero Total Revenues, dump its extract_tables()
PY
# 2. scaffold parsers/county_operating.py (Agency-No. anchoring + extract_tables)
# 3. reconcile County Board (Agency 100) end-to-end; then widen.
```
