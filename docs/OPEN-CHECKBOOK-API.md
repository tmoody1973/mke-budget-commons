# City of Milwaukee Open Checkbook — API reference

Vendor payment data (actual disbursements) published by the City Comptroller through
OpenGov. This documents the **undocumented HTTP API** that backs the public portal,
how we acquire the data from it, and the constraints that shape the acquisition code.

- Public portal: <https://milwaukee.opengov.com/transparency#/66975>
- Report name: `Open Checkbook - City of Milwaukee - 2022 - 2025` (report id `66975`)
- Dataset UUID: `ec781edd-ba12-428f-b679-bf357c92b6a7`
- City contact: `opencheckbook@milwaukee.gov`
- Fetcher: [`scripts/fetch_checkbook.py`](../scripts/fetch_checkbook.py)

> **This is not an official API.** The City never published it. It was found by
> recording the network requests the portal's own grid makes while loading. Treat
> it as a *one-time acquisition* mechanism, never a runtime dependency — see
> [Stability](#stability) below.

## Why not just use the download button

The portal's CSV export **truncates at exactly 50,000 rows**, silently. The dataset
has 404,120. A truncated export looks perfectly clean — no error, no warning, well-formed
CSV — and is short by $4.08 billion. The only way to detect it is to check the row count
and sum against the published totals.

The API paginates without that cap, so we use it instead.

## Endpoints

Base: `https://milwaukee.opengov.com/api/transactions/v2`

All three take the dataset UUID as the final path segment. `total` and `query` are
`POST` with a JSON body; `schema` is a `GET`.

### `POST /total/{uuid}` — the reconciliation anchor

Returns the row count and dollar total for the whole dataset, or for a filtered slice.
**This is what makes the checkbook reconcilable** — it is the published total that
extracted rows must sum to, playing the same role as a printed total in a budget PDF.

```bash
curl -s -X POST "$BASE/total/$UUID" \
  -H 'Content-Type: application/json' \
  -H "User-Agent: $BROWSER_UA" \
  -d '{"fields":["amount"]}'
```

```json
{"id":"ec781edd-…","count":404120.0,"total":4937976866.16}
```

### `POST /query/{uuid}` — the rows

```bash
curl -s -X POST "$BASE/query/$UUID" \
  -H 'Content-Type: application/json' \
  -H "User-Agent: $BROWSER_UA" \
  -d '{"sort":[{"quasi_id":"asc"}],
       "offset":0,
       "limit":1000,
       "fields":["quasi_id","voucher_id_0","date","amount","vendor_name",
                 "spending_department_id","spending_department_name",
                 "account_description","fund_0","descr"],
       "filter":{"date":{"ge":"2024-01-01","le":"2024-12-31"}}}'
```

```json
{"transactions":[{"voucher_id_0":"02306131","date":"2026-05-28", …}],
 "total_count_estimate":404120}
```

| Body field | Notes |
|---|---|
| `fields` | Column names from `/schema`. Omitted columns simply aren't returned. |
| `offset` / `limit` | `limit` is **clamped to 1000** — larger values are silently reduced, not rejected. |
| `sort` | List of `{field: "asc"\|"desc"}`. See [pagination](#pagination-must-use-a-stable-sort). |
| `filter` | e.g. `{"date":{"ge":"2024-01-01","le":"2024-12-31"}}`. Also accepts `{"date":{"null":true}}`. |

### `GET /schema/{uuid}` — field definitions

Returns each column's `name`, `label`, `type`, `visible`, and observed `min_value` /
`max_value`. Useful for detecting silent upstream changes — a shifted `date` max or a
new column shows up here first.

## Field schema

| API name | Label | Type | Notes |
|---|---|---|---|
| `quasi_id` | — | text | **Content hash, not a unique row id.** See below. Hidden in the UI. |
| `voucher_id_0` | Voucher ID | text | Repeats across rows — one voucher covers many payment lines. |
| `date` | Date | date | ISO. Observed range `2022-01-04` … `2026-06-23`. |
| `amount` | Amount | monetary | 4 decimal places. **Negatives exist** (min observed `-577599.38`). |
| `vendor_name` | Vendor Name | text | |
| `spending_department_id` | Spending Department ID | text | Numeric code (`1654`, `3310`) — the crosswalk hook to `dim_department`. |
| `spending_department_name` | Spending Department | text | |
| `account_description` | Account Description | text | |
| `fund_0` | Fund | text | Zero-padded (`0001`) — must be read as text, never parsed as int. |
| `descr` | Fund Description | text | |

## Gotchas

### `quasi_id` is a content hash, not a row id

Two genuinely separate payments with identical vendor, date, amount, department, and
fund produce **the same** `quasi_id`. De-duplicating on it deletes real payment lines.

This was caught in practice: de-duping on `quasi_id` dropped **540 rows / $394,293.23**
from 2026 alone. The resulting file was clean, well-formed, and wrong by a third of a
million dollars — nothing but the published-total check revealed it. `scripts/fetch_checkbook.py`
therefore writes every returned row and relies on the count + total check for correctness.

### A browser User-Agent is required

The server returns **403 Forbidden** to non-browser User-Agents. Python's default
(`Python-urllib/3.x`) is blocked; `curl`'s is not. This is the concrete form of the
"both gov sites block bot fetching" note in `CLAUDE.md` — it is User-Agent filtering,
not authentication and not IP blocking. No API key or session is needed.

### Pagination must use a stable sort

Offset-based paging over a non-unique sort key lets rows shift between pages, silently
duplicating or skipping records. We sort by `quasi_id` because it is near-unique and
stable. Rows that *do* tie are byte-identical and therefore interchangeable, so ties
cannot corrupt the result — and any drift would still be caught by the count + total check.

### `limit` is clamped, not rejected

Requesting `limit: 50000` returns 1,000 rows with a `200`. Code that trusts the requested
page size will conclude the dataset ended early.

## Reconciliation anchors

Per-fiscal-year totals from `/total` with a date filter. The City's fiscal year is the
calendar year (`fiscal_year_start_month: 1`), so year filters are fiscal years.

| Fiscal year | Rows | Published total |
|---|---:|---:|
| 2022 | 94,203 | $945,047,260.77 |
| 2023 | 92,043 | $981,221,393.92 |
| 2024 | 91,218 | $1,137,479,102.02 |
| 2025 | 91,848 | $1,186,269,947.32 |
| 2026 *(partial, through 06-23)* | 34,808 | $687,959,162.13 |
| **All** | **404,120** | **$4,937,976,866.16** |

Per-year rows and totals sum exactly to the all-time figures. Each year is therefore
independently reconcilable, which is stronger than a single global check.

## Acquiring the data

```bash
make fetch-checkbook                     # all years: fetch + verify + write Parquet
make fetch-checkbook YEARS='2024 2025'   # specific years
make checkbook-parquet                   # re-derive Parquet from raw CSVs, no network
```

`scripts/fetch_checkbook.py` writes one CSV per year to `data/raw/city/checkbook/`,
verifies each against that year's published count and total, prints a `sources.yml`
block (including `sha256`), and **exits non-zero if any year fails to reconcile**.
~405 requests at 1,000 rows each, throttled to be polite to a public government endpoint.

`scripts/checkbook_to_parquet.py` then re-verifies against the same anchors and writes
`data/canonical/city/<fy>/actual/city-checkbook.parquet`. It refuses to emit a file for
any year that doesn't reconcile.

## Storage: what's committed and why

| Artifact | Size | In git? |
|---|---:|---|
| Raw CSVs (`data/raw/city/checkbook/`) | 77.3 MB | **No** — gitignored |
| Canonical Parquet (zstd, no `quasi_id`) | 6.2 MB | **Yes** |

The raw CSVs are gitignored because they're regenerable in ~7 minutes and sha256-pinned
in `sources.yml`; the Parquet is the committed, auditable artifact. Dropping `quasi_id`
is what makes this cheap — that one hash column is ~70% of the uncompressed columnar
size (18.5 MB → 6.2 MB) and has no downstream use. It stays in the raw CSV, so the
decision is reversible without re-fetching.

**Git LFS was considered and rejected.** At 6.2 MB there's no large-file problem left to
solve, and LFS would make things worse on two counts: LFS pointers are undiffable by
design (killing the only reason to keep CSVs alongside Parquet), and LFS bandwidth quota
is consumed by every clone *and every Vercel build fetch* — at 77 MB a pull, the 1 GB/month
free tier would fail deploys after roughly 13 builds, with an error that doesn't look like
a quota error. Revisit LFS only for genuinely large binaries (scanned PDFs, shapefiles,
map tiles), not for a compressed columnar file.

## Stability

The endpoint is undocumented and can change or disappear without notice. The pipeline is
built so that this is survivable:

- The fetcher is an **acquisition step**, not a runtime dependency. Parsers read the
  hashed CSV snapshot on disk; nothing downstream calls the API.
- Every file is recorded in `data/raw/sources.yml` with its `sha256`, retrieval date, and
  the published total it was verified against — so a given parse is reproducible against
  a known snapshot even if upstream changes.
- If the endpoint breaks, fall back to the portal's manual CSV export (remembering the
  50,000-row cap → export year by year), or request an extract from `opencheckbook@milwaukee.gov`.

## What this data is — and is not

Open Checkbook records **actual vendor disbursements**. It is *not* the budget, and the
two are not directly comparable:

- Vendor payments **exclude salaries and fringe benefits** — for most departments the
  majority of the budget (the `006000` / `006100` reserved accounts).
- Payments are **cash-basis by date paid**; budgets are appropriation-basis.
- Interdepartmental charges do not appear as vendor payments.

A naive "department X budgeted $A but only spent $B" comparison across these two sources
is wrong, and wrong in a direction that produces confident, publishable-looking claims.
Treat checkbook data as its own series, not as actuals-against-budget.
