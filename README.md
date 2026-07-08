# MKE Budget Commons

> Machine-readable, **reconciled** budget data for the City of Milwaukee, Milwaukee County, and Milwaukee Public Schools — with an agentic (MCP) access layer so AI apps can answer **cited** budget questions.

Every dollar figure is extracted **deterministically** from the governments' own budget documents and checked against those documents' printed totals. **No language model ever reads the numbers.** If a value can't cite its source page, it doesn't ship.

Methodology mirrors [BetaNYC/New-York-City-Budget](https://github.com/BetaNYC/New-York-City-Budget). Built with [Claude](https://claude.ai). Full spec in [`docs/PRD.md`](docs/PRD.md); the always-on operating contract is [`CLAUDE.md`](CLAUDE.md).

## Why this exists

Government budgets are published as giant PDFs (and, for MPS, a spreadsheet) that are technically public but practically unreadable. This project turns them into a queryable, auditable dataset where **every number is traceable to a page and reconciles to the document's own totals** — then exposes it to AI assistants through a typed MCP server, so a parent, a journalist, or a chatbot can ask a plain-language question and get a cited answer.

## Coverage

| Government | Document | Status | Reconciliation |
|-----------|----------|--------|----------------|
| **City of Milwaukee** | 2026 Adopted Detailed Budget | ✅ live | 60/60 budgetary units, dollar-exact |
| **City of Milwaukee** | 2027 Requested Budget | ✅ live | diff document (4 vintages) |
| **Milwaukee County** | 2026 Adopted Operating Budget | ✅ live | 37/37 chapters, 0 findings, 0 not-reconcilable |
| **Milwaukee Public Schools** | FY2026-27 Revised Proposed Budget | ✅ live | 33,283 line items → $1,600,555,548 printed total, dollar-exact (2 vintages) |
| Milwaukee County | 2026 Capital Budget | ⛔ parked | OCR-degraded — not reconciliation-grade |

## Architecture (4 layers)

```
L4  apps/       →  read L3 only (public budget explainer, cited)
L3  mcp/        →  TypeScript MCP server: typed tools + read-only SQL, provenance on every response
L2  db/ + Neon  →  repo Parquet/CSV = source of truth (diffable) → Neon Postgres = disposable serving layer
L1  parsers/    →  Python, deterministic, reconciled by tests/ — pdfplumber+regex (city/county), pandas (MPS xlsx)
```

The repo is the source of truth; **Neon is disposable** — `make load-neon` rebuilds it entirely from repo Parquet, idempotently. Reconciliation runs as a pytest suite; canonical data is regenerated only when the suite is green (or discrepancies are explicitly dispositioned as source-document errors).

## Quick start

### Prerequisites
- Python 3.12+
- Node 20+ (for the MCP server)
- A Neon/Postgres `DATABASE_URL` in `.env` (only for the serving layer + MCP)

### Install & run
```bash
pip install -r requirements.txt

make parse-city-detailed FY=2026 TYPE=adopted   # parse a city doc + write its reconciliation report
make parse-county-operating                     # parse the county operating book + report
make reconcile                                  # run the full pytest reconciliation suite (the trust layer)

make load-neon                                  # rebuild Neon from repo Parquet (idempotent)
make mcp-install && make mcp-dev                # run the MCP server locally (stdio)
make mcp-test                                   # smoke-test the MCP server end-to-end (city + county)

make explainer                                  # build the standalone public budget explainer
```

Run `make help` for the full target list.

## MCP tools (L3)

The server exposes typed, read-only tools — every response carries `{doc_id, source_page}` provenance. Most take `gov: "city" | "county" | "mps"`:

| Tool | What it answers |
|------|-----------------|
| `list_departments` | Departments for a government with adopted totals |
| `get_department_budget` | A department's totals, FTE, divisions, top expenditures — cited |
| `budget_breakdown` | Where the money goes: salaries / fringe / operating / equipment (or county categories) |
| `compare_years` | A department across two fiscal years, with $ and % deltas |
| `trace_adoption` | A budget through its stages (requested → proposed → adopted) |
| `biggest_changes` | The departments that changed most between two years — the story-finder |
| `search_line_items` | Full-text search over line descriptions, ranked and cited |
| `get_positions` / `find_positions` | Staff lines: titles, pay ranges, FTE, footnote flags (city) |
| `reconciliation_status` | The trust report: what reconciles, what's a documented source-document error |
| `cite` | Full provenance for a single line: document, page, printed context |
| `glossary` | Plain-language explanations of budget codes, terms, and footnotes |
| `run_sql` | Read-only (`SELECT`/`WITH`) SQL against the canonical store |

**MPS (schools) tools** — for parents/students and journalists: `get_department_budget`/`budget_breakdown`/`compare_years` light up for `gov:"mps"` (a school's budget, spending by object, year-over-year), plus `compare_schools` (side-by-side school comparison), `mps_fund_summary` (funds, revenue, and the planned surplus / fund-balance use), and **`per_pupil_ranking`** (schools ranked by budget ÷ enrollment — the equity lens, with a `min_enrollment` filter and district median).

## Project structure

```
parsers/          L1 deterministic parsers + reconcilers (city_detailed, county_operating, mps_lineitem)
tests/            reconciliation pytest suite — the trust layer
data/raw/         source documents + sources.yml manifest (URL, retrieved date, sha256)
data/canonical/   extracted, reconciled Parquet (source of truth) + CSV (human-diffable)
crosswalks/       department / fund / footnote maps across years
db/               Neon Postgres schema + idempotent loader
mcp/              L3 TypeScript MCP server (tools + read-only SQL guard + smoke tests)
scripts/          per-document reconciliation report generators
apps/explainer/   L4 standalone public budget explainer (reads L3, fully cited)
docs/             PRD, reconciliation reports, handoffs
```

## The rules that make it trustworthy

- **A hard wall separates extraction (L1) from everything above it.** Parsing is pure, deterministic Python — no LLM calls, ever, in `parsers/` or `tests/`.
- **Reconciliation is the product.** Every section must sum to the document's own printed total. A mismatch is a *finding* — flagged and dispositioned (often a real arithmetic error inside the official document), never silently swallowed. A section with no printed total is labeled `NOT_RECONCILABLE`, never blindly trusted.
- **Provenance on every row.** `source_doc` + `source_page` (or, for the MPS spreadsheet, sheet + row). No citation, no ship.

## License

Code + derived data: **MIT**. Source documents: © City of Milwaukee / Milwaukee County / Milwaukee Public Schools, reproduced as public records.
