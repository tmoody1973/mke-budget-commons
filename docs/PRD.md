# PRD: MKE Budget Commons
### Machine-readable Milwaukee City & County budget data with an agentic access layer

**Author:** Tarik Moody
**Status:** Draft v0.1 — Research/Concept phase (bumwad Phase 1–2)
**Last updated:** July 7, 2026
**Prior art:** [BetaNYC/New-York-City-Budget](https://github.com/BetaNYC/New-York-City-Budget) — deterministic PDF parsing reconciled against printed totals

---

## 1. Problem Statement

Milwaukee's City and County budgets — roughly $2B (city) and $1.4B+ (county) in annual public spending — are published only as PDFs. The data inside them is effectively locked: journalists can't diff proposed vs. adopted budgets without manual page-flipping, residents can't ask "what happened to library funding," civic developers can't build on the numbers, and no one can programmatically trace the 56 Council amendments that reshaped the Mayor's 2026 proposal. Every downstream civic product (Hakivo briefings, The Gauntlet, Radio Milwaukee journalism) that wants budget data has to re-solve extraction from scratch — badly, or not at all.

**The product:** a trustworthy, reconciled, machine-readable dataset of Milwaukee City and County budgets, exposed through an MCP server so AI agents (and apps built on them) can answer cited budget questions.

## 2. Goals

1. **Trust-grade extraction.** Every number in the canonical dataset reconciles against a printed total in the source PDF, or the discrepancy is documented. No LLM touches extraction.
2. **Provenance on every row.** Any agent answer can cite back to source document + page number.
3. **Agent-native access.** A typed MCP tool layer, not just raw tables, so agents get high-signal answers without hallucinating SQL against an unfamiliar schema.
4. **Annual repeatability.** New fiscal year = drop in new PDFs, run pipeline, review reconciliation report. No parser rewrites.
5. **Multi-year comparability.** Department crosswalks handle renames/mergers so "MPD budget over 5 years" is a real query.

## 3. Non-Goals (v1)

- Real-time budget monitoring / actuals vs. budget (ACFR data) — future phase.
- MPS, MMSD, MATC, or other overlapping-jurisdiction budgets.
- Capital Improvements Plan parsing (structurally different docs) — Phase 5, after operating budgets are solid.
- Public-facing web UI. v1 ships data + MCP server; apps come after.
- Historical backfill beyond FY2024. Start with 2025–2027 docs; go backward only if reconciliation holds.

## 4. Users & Primary Use Cases

| User | Use case | What they need |
|---|---|---|
| Agentic apps (Hakivo, Gauntlet, budget explainer) | "Explain where a Milwaukee tax dollar goes" as audio/interactive | MCP tools returning compact, cited JSON |
| Radio Milwaukee / local journalists | "Which departments got cut most from requested → adopted?" | Diff tools, amendment tracing, CSV export |
| Tarik (developer) | Foundation layer for multiple products | Stable schema, git-diffable data, Neon serving DB |
| Civic community | Open dataset nobody else in Milwaukee has built | Public repo, documented methodology, reconciliation receipts |

**North-star first agent (v1 demo):** a budget Q&A agent that answers "How did [department]'s budget change from 2025 to 2026, and what changed between the Mayor's proposal and adoption?" with page-level citations.

## 5. Source Documents

### 5.1 City of Milwaukee (Budget & Management Division — city.milwaukee.gov/doa/budget)

| Document family | Contents | Parse priority |
|---|---|---|
| **Adopted Detailed Budget** ("line-item budget") | All appropriation accounts by department: account numbers, line descriptions, pay ranges, FTE units, dollars; side-by-side prior-year Budget / Requested / Proposed (or Adopted) columns | **P0 — the gold mine** |
| Proposed Detailed Budget | Same structure, pre-Council | P0 (enables proposed→adopted diff) |
| Plan and Budget Summary (Adopted) | Fiscal summary, dept narratives, appropriations by expenditure category, tax levy tables, fund sections (A–N: General City Purposes, Employee Retirement, Capital, Debt, Contingent, Grant & Aid, Water Works, etc.) | P1 (summary-level facts + fund structure) |
| Requested Budget | Department requests pre-Mayor | P2 |
| Council amendments (adoption releases / F&P Committee report) | 56 amendments to the 2026 proposal; tax rate changes | P1 — highest journalistic value |

Documents available for 2025, 2026, and 2027 (proposed cycle) in the Budget Documents Archive.

### 5.2 Milwaukee County (Office of Strategy, Budget & Performance)

| Document family | Contents | Parse priority |
|---|---|---|
| **Adopted Operating Budget** | Per-department budget docs keyed by org code (100 County Board, 110 County Exec, 370 Comptroller, 115 DAS, 200 Courts, etc.) | **P0** |
| Adopted Capital Budget | Capital projects | P2 |
| Recommended (County Exec) Budget | Pre-Board version | P1 (enables recommended→adopted diff) |
| County Board amendments/reports | Board changes to Exec budget | P1 |

### 5.3 Acquisition note

Both government sites block automated fetching (bot detection). v1 acquisition is manual download into `data/raw/`, committed to the repo with a `sources.yml` manifest (URL, download date, SHA-256 hash). A polite scraper with proper headers is a later nice-to-have, not a blocker — these drop twice a year.

## 6. Architecture

Four layers. **Hard wall between Layer 2 and Layer 3:** agents read the canonical store; they never write to it and never participate in extraction.

```
┌─────────────────────────────────────────────────────┐
│ L4  APPS: Hakivo briefing agent · budget explainer   │
│     chat · Gauntlet data feed · amendment tracker    │
├─────────────────────────────────────────────────────┤
│ L3  MCP SERVER (TypeScript): typed tools + read-only │
│     SQL escape hatch · every response carries        │
│     provenance                                       │
├─────────────────────────────────────────────────────┤
│ L2  CANONICAL STORE:                                 │
│     • git repo: Parquet + CSV (source of truth,      │
│       diffable, auditable)                           │
│     • Neon Postgres (serving layer, rebuilt from     │
│       repo data at any time)                         │
├─────────────────────────────────────────────────────┤
│ L1  EXTRACTION (Python, deterministic, no AI):       │
│     pdfplumber text-layer parsing → raw tables →     │
│     normalization → RECONCILIATION TESTS             │
└─────────────────────────────────────────────────────┘
```

**Design rule inherited from BetaNYC:** reconciliation failures are findings, not bugs. If extracted line items don't sum to the printed total, the pipeline flags it; investigation determines whether it's a parser defect or an arithmetic inconsistency in the official document. Both outcomes are logged in `reconciliation-report.md` per document.

## 7. Layer 1 — Extraction Pipeline Spec

### 7.1 Stack

- Python 3.12, `pdfplumber` (columnar text extraction with x-coordinates), `pandas`, `pytest`.
- One parser module per document family per government: `parsers/city_detailed.py`, `parsers/city_summary.py`, `parsers/county_operating.py`, etc.
- Zero LLM calls in this layer. Regex + positional parsing only.

### 7.2 Parsing strategy (city Detailed Budget — **VERIFIED** against the 2026 Adopted PDF, July 2026)

Inspected with pdfplumber against the actual 269-page 2026 Adopted Detailed Budget (Foxit-printed, clean Arial/WinAnsi text layer — fully extractable, no OCR needed). Letter portrait, 612×792pt.

**Verified column geometry (2026 Adopted book):**

| Column | Alignment | Position (pt) |
|---|---|---|
| FUND / ORG / SBCL / ACCOUNT | left, x0 ≈ 36 / 61 / 85 / 121 | present only on account-anchored rows |
| **2024 EXPENDITURE** (actuals — see note) | right-aligned, x1 ≈ 217 | |
| 2025 UNITS | right-aligned, x1 ≈ 248 | |
| 2025 BUDGET dollars | right-aligned, x1 ≈ 289 | |
| LINE DESCRIPTION | left, x0 = 312 | |
| PAY RANGE | left, x0 ≈ 469 | |
| 2026 UNITS | right-aligned, x1 ≈ 520 | |
| 2026 BUDGET dollars | right-aligned, x1 ≈ 557 | |

**Discovery — the adopted book carries three data vintages, not two:** prior-year *actual expenditures* (2024), current-year budget (2025), and the adopted year (2026). The dataset gets budget-vs-actual for free.

**Parsing rules (BetaNYC capital-parser technique, adapted):**

1. **Header-derived bands per page.** Year labels sit at top≈39, header words (`EXPENDITURE`, `BUDGET`, `PAY`) at top≈50. Derive column bands from header word x-positions on *each page* — never hardcode — so layout drift between years is absorbed automatically. Assign right-aligned numbers to bands by **x1** (right edge), text by x0.
2. **Row clustering by y.** Cluster words into visual rows by `top` (±3pt tolerance), sort by x0.
3. **Row classification.** department header (all-caps, description column, no numbers) · division/section header (e.g., `NETWORK AND TELECOMMUNICATIONS SECTION`) · position line (has PAY RANGE) · expenditure line (has FUND/ORG/SBCL/ACCOUNT codes, e.g., `0001 1910 R999 634000 · Professional Services`) · roll-up anchor · dept/division total · FTE line.
4. **Reconciliation anchors use reserved account codes** (verified): `006000` NET SALARIES & WAGES TOTAL · `006100` ESTIMATED EMPLOYEE FRINGE BENEFITS · `006300` OPERATING EXPENDITURES TOTAL · `006800` EQUIPMENT PURCHASES TOTAL · SPECIAL FUNDS TOTAL (no account code) · `<DIVISION/CONTROL UNIT/DEPARTMENT> TOTAL` rows · `TOTAL NUMBER OF POSITIONS AUTHORIZED` · `O&M FTE'S` / `NON-O&M FTE'S`. These are the printed totals every extracted section must sum to.
5. **Position reclassification rows span two physical lines** (verified gotcha): the 2025 side prints on one line with the *old* pay range (e.g., `2IX`), and the 2026 side prints on the following line with the same title and the *new* pay range (`2JX`). The parser must join these into one logical position record. Negative amounts print in parentheses: `(42,642)`.
6. **Footnote codes.** Parenthetical flags on position titles — `(A)(Y)`, `(X)`, `(CCR)`, `(BPS)`, `(BU)`, `(CP)`, grant/termination markers — captured raw into `flags[]`; glossary in `footnote_codes.yml` per year.
7. **Roster derivation.** Department, division, and fund lists derived from the document each year — never hardcoded.
8. **The Requested Budget doc is the diff document** (verified on the 2027 edition, 463pp): it prints **four value columns** — prior-year EXPENDITURE (actuals) / current-year BUDGET / REQUESTED (units+dollars) / PROPOSED (units+dollars) — same description/pay-range architecture. Requested→proposed deltas come from this one document; proposed→adopted comes from comparing it to the Adopted book.

### 7.3 County operating budget strategy — **VERIFIED** against the 2026 Adopted PDF

The county book (442pp, FrameMaker, clean text layer) is a **completely different animal from the city's ledger**: narrative department chapters with embedded summary tables, not line items. Verified structure per department chapter (keyed `Agency No. NNN` in the running header, e.g., `Office of the County Treasurer (309)`):

- **BUDGET SUMMARY table:** rows = Personnel Costs / Operations Costs / Debt & Depreciation / Interdepartmental Charges / Total Expenditures / revenue categories / Total Revenues / Tax Levy; columns = **2023 Actual / 2024 Actual / 2025 Budget / 2026 Adopted / Variance**. Two years of actuals — richer time series than the city book.
- **Program Budget Summary tables** per Strategic Program Area (Expenditures / Revenues / Tax Levy / FTE) with the same five columns, plus `Service Provision: Mandated|Discretionary` metadata.
- **Activity Data tables** (performance measures: 2023–24 actuals, 2025–26 targets) — bonus dataset.
- **Major Changes** narrative bullets — extract as text records; these are the county's per-department "what changed" story.

**Parser implications:** county extraction is a table-detection job (pdfplumber `extract_tables` / category-name-anchored regex), not band parsing. **Known gotcha (verified):** some header lines have overlapping text layers producing garbage like `BUDGET309 - O ffice oSf the CounUty TreasurerMMARY` — anchor on the clean `Agency No. NNN` running header and on category row names, never on section titles. Reconciliation: category rows must sum to printed `Total Expenditures` / `Total Revenues`; program tables must sum to the department Budget Summary.

**Schema implication:** county facts are category-level per department/program, not account line items. They load into `fact_budget_line` with `line_kind='category'|'program'`, `division` = Strategic Program Area, `account` NULL. Activity data gets its own small table (`fact_activity_measure`) in Phase 5.

### 7.4 Reconciliation (the trust layer)

Implemented as a pytest suite that runs on every pipeline execution:

- **Section tests:** sum of extracted line items per division == printed division subtotal; divisions == printed department total.
- **Document tests:** sum of department totals == printed budget-section totals (e.g., city Sections A–N); grand total == printed adopted total.
- **Cross-document tests:** Plan & Budget Summary department totals == Detailed Budget department totals for the same fiscal year.
- **Tolerance:** exact match required. Rounding differences documented explicitly, never silently absorbed.
- **Output:** `reconciliation-report.md` per document — pass/fail per section, discrepancy amounts, disposition (`parser-bug` / `source-document-inconsistency` / `open`). Source-document inconsistencies are publishable findings.

CI: GitHub Actions runs the full suite on every push; canonical Parquet/CSV regenerated and committed only on green.

## 8. Layer 2 — Canonical Store

### 8.1 Repo as source of truth

```
mke-budget/
  data/
    raw/                      # source PDFs + sources.yml manifest (URL, date, sha256)
    canonical/
      city/fy2026/adopted/    # parquet + csv per table
      county/fy2026/adopted/
    combined/                 # multi-year roll-ups
  parsers/                    # L1 python
  tests/                      # reconciliation suite
  crosswalks/
    departments.yml           # dept identity across years/renames
    funds.yml
    footnote_codes.yml
  db/
    schema.sql                # Neon DDL
    load.py                   # repo → Neon loader (idempotent, truncate-and-load)
  mcp/                        # L3 TypeScript MCP server
  docs/
    methodology.md
    reconciliation-reports/
```

### 8.2 Neon Postgres schema (serving layer)

```sql
CREATE TABLE dim_government (
  gov_id      TEXT PRIMARY KEY,          -- 'city' | 'county'
  name        TEXT NOT NULL
);

CREATE TABLE dim_department (
  dept_id     TEXT PRIMARY KEY,          -- stable slug, e.g. 'city-fire'
  gov_id      TEXT REFERENCES dim_government,
  canonical_name TEXT NOT NULL,
  org_code    TEXT                       -- county org code where applicable
);

CREATE TABLE dept_alias (                -- crosswalk: names as printed, per year
  dept_id     TEXT REFERENCES dim_department,
  fiscal_year INT,
  printed_name TEXT,
  PRIMARY KEY (dept_id, fiscal_year, printed_name)
);

CREATE TABLE dim_document (
  doc_id      TEXT PRIMARY KEY,          -- 'city-2026-adopted-detailed'
  gov_id      TEXT REFERENCES dim_government,
  fiscal_year INT NOT NULL,
  doc_type    TEXT NOT NULL,             -- requested|proposed|recommended|adopted
  doc_family  TEXT NOT NULL,             -- detailed|summary|operating|capital|amendments
  source_url  TEXT,
  sha256      TEXT,
  retrieved_on DATE
);

CREATE TABLE fact_budget_line (
  line_id     BIGSERIAL PRIMARY KEY,
  doc_id      TEXT REFERENCES dim_document,
  dept_id     TEXT REFERENCES dim_department,
  division    TEXT,
  fund        TEXT,
  org         TEXT,
  sbcl        TEXT,
  account     TEXT,
  line_description TEXT NOT NULL,
  line_kind   TEXT NOT NULL,             -- position|expenditure|subtotal|total
  pay_range   TEXT,
  amount      NUMERIC(14,2),
  units       NUMERIC(8,2),              -- FTE or unit count
  flags       TEXT[],                    -- footnote codes as printed
  source_page INT NOT NULL,              -- ← provenance, non-negotiable
  search      TSVECTOR GENERATED ALWAYS AS
              (to_tsvector('english', line_description)) STORED
);
CREATE INDEX ON fact_budget_line (dept_id, doc_id);
CREATE INDEX ON fact_budget_line USING GIN (search);

CREATE TABLE fact_amendment (
  amend_id    BIGSERIAL PRIMARY KEY,
  gov_id      TEXT REFERENCES dim_government,
  fiscal_year INT,
  number      TEXT,                      -- amendment number as printed
  sponsor     TEXT,
  description TEXT,
  dept_id     TEXT REFERENCES dim_department,
  amount_delta NUMERIC(14,2),
  disposition TEXT,                      -- adopted|failed|withdrawn
  source_doc  TEXT,
  source_page INT
);

CREATE TABLE reconciliation_result (
  doc_id      TEXT REFERENCES dim_document,
  scope       TEXT,                      -- section/division being checked
  extracted_total NUMERIC(14,2),
  printed_total   NUMERIC(14,2),
  status      TEXT,                      -- pass|parser_bug|source_inconsistency|open
  notes       TEXT,
  PRIMARY KEY (doc_id, scope)
);
```

**Loader contract:** `db/load.py` rebuilds Neon entirely from repo Parquet — idempotent, so the database is disposable. Use a Neon branch per fiscal-year ingest during development; merge to main branch when reconciliation is green.

## 9. Layer 3 — MCP Server Spec

TypeScript, official MCP SDK. Read-only Neon connection (dedicated Postgres role with `SELECT` only). Every tool response includes a `citations` array of `{doc_id, source_page}`.

### 9.1 Tools (v1)

| Tool | Signature | Returns |
|---|---|---|
| `list_departments` | `(gov, fiscal_year)` | Departments with adopted totals |
| `get_department_budget` | `(dept, fiscal_year, gov, doc_type='adopted')` | Divisions, top line items, totals, FTE counts, citations |
| `compare_years` | `(dept, year_a, year_b, gov)` | Deltas ($, %, FTE) by division; new/eliminated line items |
| `trace_adoption` | `(dept, fiscal_year, gov)` | Requested → proposed/recommended → adopted for each stage present, with stage deltas |
| `search_line_items` | `(query, fiscal_year?, gov?)` | Full-text hits over line descriptions (tsvector), ranked, cited |
| `get_amendments` | `(fiscal_year, gov, dept?)` | Amendment list with sponsors, deltas, dispositions |
| `get_positions` | `(dept, fiscal_year, gov)` | Position lines: titles, pay ranges, FTE, flags (grant-funded, terminating) |
| `cite` | `(line_id)` | Full provenance for any row: document, page, printed context |
| `run_sql` | `(query)` | Read-only escape hatch; enforced `SELECT`-only + row limit + statement timeout |
| `reconciliation_status` | `(doc_id?)` | Trust report: what reconciles, what doesn't, dispositions |

### 9.2 Tool-design rules

- Responses are compact JSON — aggregates + top-N lines, never full table dumps (agents drown in 4,000 rows).
- Ambiguous department names resolve through `dept_alias`; on multiple matches, return candidates instead of guessing.
- `run_sql` guarded by: read-only role, `SET statement_timeout`, `LIMIT` injection, deny-list on system catalogs.
- Deploy: local stdio for Claude Code/Desktop first; remote (SSE on a small host) in Phase 4 when apps need shared access.

## 10. Layer 4 — Reference Apps (post-v1, listed for architectural pull)

1. **Budget Explainer agent** — conversational "where does my tax dollar go," Radio Milwaukee-flavored, every claim cited. (v1 demo target.)
2. **Amendment Tracker** — what the Council/Board changed and who sponsored it; feeds journalism + The Gauntlet's civics mechanics.
3. **Hakivo budget briefings** — audio segments generated from `compare_years` + `get_amendments` during budget season (Sept–Nov).
4. **Budget season live-diff** — when the 2028 proposed drops (Sept 2027), same-day "what changed" report.

## 11. Build Phases (bumwad sequence)

| Phase | Scope | Exit criteria |
|---|---|---|
| **1. Research** | Obtain PDFs (city Detailed ×2 years + Summary; county Operating). Inspect layouts, confirm column geometry, footnote conventions. Write `methodology.md` draft. | Annotated sample pages; parser spec §7.2 verified or corrected |
| **2. Concept** | Parse **one city department** (pick a mid-size one, e.g., City Attorney) end-to-end: extract → normalize → reconcile against its printed total. | One department passes reconciliation exactly |
| **3. Design Development** | Full city Adopted Detailed Budget FY2026. Reconciliation suite green (or discrepancies dispositioned). Load Neon. Department crosswalk seeded. | `reconciliation-report.md` published; Neon queryable |
| **4. Refinement** | MCP server with 5 core tools (`get_department_budget`, `compare_years`, `search_line_items`, `cite`, `run_sql`). FY2025 adopted parsed for year-over-year. Demo agent answers the north-star question with citations. | Working demo: cited Q&A over 2 fiscal years |
| **5. Construction Documentation** | County operating budget; proposed-vs-adopted diffs; amendments table; remaining tools; public repo + methodology writeup; *The Intersection* post. | Public release |

Sizing honestly: Phases 1–2 are a weekend of Claude Code sessions; Phase 3 is where parser edge cases eat time (budget PDFs always have one cursed page). Given Split Decision (July 8–9) and the OpenAI grant (July 15), Phase 1 can start whenever the PDFs land, but Phases 3+ are realistically late-July-onward work. Note the seasonal hook: **the FY2028 proposed budget drops in September** — shipping before then means the pipeline's first real test is a same-day diff story.

## 12. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| PDF text layer is garbage on some pages (scanned/rotated) | Medium | Page-level OCR fallback (tesseract) flagged as lower-confidence; those pages excluded from "reconciled" status |
| Column geometry shifts between years | High | x-coordinate detection derived per document, not hardcoded; reconciliation catches silent drift |
| Department renames break multi-year queries | Certain | `dept_alias` crosswalk is a first-class artifact, human-reviewed each year |
| County doc structure differs sharply from city | High | Separate parser module; shared normalization contract, not shared parsing code |
| Printed totals themselves inconsistent | Low but real (BetaNYC hit 2) | That's a story, not a bug — disposition system in §7.4 |
| Scope creep into capital budgets / ACFR / MPS | High (it's you) | Non-goals list §3; capital is Phase 5+ only |

## 13. Success Metrics

- **Trust:** 100% of published canonical data covered by a reconciliation result; zero silent discrepancies.
- **v1 demo:** north-star question answered with correct numbers + page citations across FY2025–2026.
- **Repeatability:** FY2027 adopted docs (already published) parse with config/crosswalk changes only — no parser code changes.
- **Adoption:** at least one downstream app (Hakivo segment or explainer) shipping on the MCP server within a month of v1.

## 14. Open Questions

1. ~~Sample pages needed~~ **RESOLVED (July 2026):** §7.2 and §7.3 verified against the actual 2026 Adopted Detailed Budget, 2027 Requested Budget, and 2026 County Adopted Operating Budget. All have clean extractable text layers; no OCR required for the P0 documents. Phase 1 is substantially complete.
2. City amendments: are the 56 amendments published as a structured document (F&P Committee report) or only narrative PDFs? Determines whether `fact_amendment` is parsed or hand-entered for v1.
3. County Recommended budget availability per department — same file structure as Adopted?
4. License for the public repo — MIT for code (matching BetaNYC); data as CC0 or ODbL?
5. ~~Does the Adopted Detailed Budget print adopted values?~~ **RESOLVED:** yes — the Adopted book prints prior-year actuals / current-year budget / adopted year. The Requested Budget doc carries the four-column requested/proposed view (§7.2.8), so `trace_adoption` joins the two documents.
6. **NEW:** the uploaded county Capital Budget (333pp) was produced with Acrobat's Paper Capture (OCR) plug-in — its text layer is OCR-derived and needs quality assessment before it can ever be `reconciled`-grade. Fine to defer; capital is Phase 5+.
7. **NEW:** the city Detailed Budget's 2024 actuals column means budget-vs-actual analysis is in scope for free — should `compare_years` expose actuals (`amount_kind: actual|budget`)? Recommend yes; add `amount_kind` column to `fact_budget_line`.
