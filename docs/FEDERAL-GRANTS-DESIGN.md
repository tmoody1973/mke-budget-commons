# Federal grants (USAspending) — design

**Status:** design agreed, build in progress.
Source: <https://api.usaspending.gov> — a real, documented, versioned public API.

Phase 2 adds federal award money flowing to Milwaukee: to the City and County
themselves, and — the part no local source answers — to **nonprofits and
institutions in Milwaukee County**.

## The decision that has to come first

**"How much federal grant money did Milwaukee get in FY2024?" has three official
answers.** All three come from the same API with identical filters. Picking one
without noticing is how you publish a wrong number from correct data.

Think of hiring a contractor to renovate your house — $300,000, over three years:

| Concept | Plain meaning | Your renovation |
|---|---|---|
| **Award amount** | the size of the whole deal signed | $300,000 |
| **Obligation** | what was legally committed *this year* | $100,000 |
| **Outlay** | what actually left the bank account this year | $75,000 |

All three are true. They answer different questions. Answering *"what did you
spend on renovation in 2024?"* with $300,000 is wrong — that's the whole
three-year deal.

Measured on real data (Milwaukee County, FY2024, grants):

```
transaction-level obligations   $  666,063,355.47
award-level totals              $3,097,997,475.03
                                ─────────────────
gap                             $2,431,934,119.56      (4.6x)
```

The award-level figure counts **each multi-year award's full lifetime value in
every year it is active**. It is not a bug — it honestly answers "what is the
total value of all awards touching this year?" — but nobody means that when they
ask what Milwaukee received. And outlays differ again: one UMOS grant is
`$124,969,530` obligated but `$109,496,830` outlaid.

### Resolved

1. **The headline number is transaction-level obligations.** It is the only one
   that means "in this year" without double-counting multi-year awards.
2. **Outlays are a separate, explicitly labelled series** — "committed" vs
   "actually paid out" is a real story (money awarded but unspent), but it is a
   second series, never blended into the first.
3. **Award totals appear only for a single award at a time, and are never
   summed across awards.** "This UMOS grant is worth $125M over its life" is
   correct. Adding those up to "Milwaukee got $3.1B" is always wrong.

Rule 3 is the structural one, and it is the same move as the checkbook
guardrail: rather than warn against the bad operation, **don't offer it.** No
tool will sum award totals across awards, so no tool can produce that headline.

### Why this is a harder trap than Phase 1's

The checkbook trap required doing something wrong — joining two tables that
shouldn't be joined. This one requires doing **nothing** wrong: call one
official endpoint, with correct filters, and get a number 4.6× too big. There
is no join to forbid and no mismatch to detect. It is a single choice, made
once, early.

## Scope

| Dimension | Decision | Why |
|---|---|---|
| Geography | **Milwaukee County** (state `WI`, county FIPS `079`), by *recipient* location | Captures the City and County as recipients **and** every nonprofit/institution in the county — the part nobody can currently answer |
| Award types | `02`, `03`, `04`, `05` — block / formula / project grants and cooperative agreements | Grants only for now. Contracts, loans and direct payments are a different question; deliberately deferred |
| Time | Federal fiscal years (Oct 1 – Sep 30) | USAspending is FY-native; note this differs from the City's calendar fiscal year |
| Floor | FY2008 | The API rejects start dates before `2007-10-01` for search endpoints |

Recipient-location scoping means a grant to a national organization is counted
only where the *recipient* sits — this is a Milwaukee-recipients view, not a
"money spent in Milwaukee" view. Those differ, and the distinction belongs in
any UI label.

## Acquisition: bulk download, NOT the search API

**`/search/spending_by_transaction/` returns amounts that disagree with
USAspending's own aggregates.** This is not a subtlety to work around — it is the
reason acquisition uses `/bulk_download/awards/` instead.

Measured, FY2025, same filters:

| Source | Total |
|---|---:|
| `spending_by_category` (aggregate) | $691,699,019.28 |
| `spending_by_transaction` (full-year pull) | $692,276,566.28 |
| `spending_by_transaction` (HHS-only slice) | a *third* number again |
| **`bulk_download/awards/`** | **$691,699,019.28** ✅ |

The search API was off by $577,547 for FY2025 and by different amounts in other
years; FY2024 happened to agree exactly, which is what made it look trustworthy.
Row counts matched throughout — **a matching row count never proved the amounts
right.** The bulk extract reconciles to the cent in every year tested.

Things ruled out before landing on this, each worth not re-testing:
- **Data drift** — the anchor is identical across repeated calls.
- **Non-deterministic pagination** — two full pulls of FY2025 were byte-identical.
- **Duplicate rows being a fetch bug** — repeated `(internal_id, mod)` pairs are
  real records, present in passing and failing years alike.
- **A wrong sort key** — this *was* a real bug (sorting on the non-unique
  `Action Date` scrambled $2.9M across agencies in FY2024 while the row count
  stayed correct) and it is fixed, but it was not the cause of the amount gaps.

### Extract mechanics

`POST /bulk_download/awards/` → poll `GET /download/status?file_name=…` until
`finished` → download the zip. The status response carries `total_rows`, which is
a second anchor independent of the dollar total.

**Parse the CSV with a real CSV reader, never by counting lines.** Description
fields contain embedded newlines: FY2024's extract is 2,949 physical lines for
1,676 records.

## Reconciliation anchors

USAspending publishes no single "printed total", so each year is gated on **two
independent anchors**, and a year that misses either is not written:

1. **Dollar total** — `spending_by_category` summed across all pages, which the
   bulk extract must match exactly (`federal_action_obligation`).
2. **Record count** — `total_rows` from the download-status response, which the
   parsed extract must match exactly.

```
FY2024   1,676 records   $666,063,355.47   delta $0.00
FY2025   1,574 records   $691,699,019.28   delta $0.00
```

An earlier design used "recipient grouping == agency grouping" as the anchor.
That was dropped: the two aggregations differ by **one cent** in FY2021 and
FY2022 (float rounding inside USAspending's own summation over 164 recipients vs
24 agencies), so demanding exact agreement between two *upstream* sums rejects
good years for no reason. Our own arithmetic stays exact-Decimal; only the
comparison between two independently-rounded upstream aggregates was too strict.

## API gotchas (verified)

- **`limit` above 100 returns an EMPTY result set, not an error.** A loop that
  requests 500 and stops on an empty page concludes "no data" and writes an
  empty file. Page size is pinned to 100 and the count anchor catches the rest.
- **`sort` is a required field** on `spending_by_transaction`; omitting it
  returns a 422 with a message that doesn't obviously say so. It must also be
  one of the requested `fields`, or the request 400s.
- **The sort key MUST be unique, and `Action Date` is not.** This one bit hard.
  Sorting the FY2024 pull by `Action Date` produced **exactly the right row
  count (1,676) with $2.9M attributed to the wrong agencies** — dates repeat, so
  rows shuffle between pages, some returned twice and others skipped, netting
  out to the correct total count. Filtering to DOT alone reconciled perfectly
  ($20,321,545.67, delta $0.00) while the same agency in the full pull was
  $2,876,300 short, which is what exposed it. Sort on `internal_id` (unique
  integer per transaction), and **never trust a row count alone to prove a pull
  correct** — only the amount anchor caught this.
- **Negative amounts are normal** — deobligations and corrections. FY2024 has 7
  recipients with net-negative totals. They are stored faithfully; netting is a
  query-time choice, never applied at ingest.
- Aggregate endpoints paginate at 100 too, and later pages are where the
  negatives sort — a single-page read of `spending_by_category` overstates the
  total (FY2024: $681,998,556 on page 1 vs $666,063,355 complete).

## Provenance

Every row carries `generated_internal_id` (USAspending's stable award key) plus
`Award ID` and `Action Date`, and each pull records the endpoint, filter object,
and retrieval date in `sources.yml`. Unlike a PDF there is no page — provenance
is the award key, and the API is re-queryable to verify any single row.

## Not doing (yet)

- Contracts, loans, direct payments — different questions, deliberately deferred
- Sub-awards (money passed from a prime recipient onward) — a separate endpoint
  and a much messier data quality story
- Any join between grants and the budget or checkbook. Federal grant money
  appears in the City budget as revenue lines, but reconciling the two is its
  own project — and would need the same guardrail treatment as the checkbook
  before it could ship.
