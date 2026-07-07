# Reconciliation Report — City of Milwaukee 2026 Adopted Detailed Budget

**doc_id:** `city-2026-adopted-detailed`
**Source:** `data/raw/city/2026-CITY-OF-MILWAUKEE-DETAILED-BUDGET4.pdf` (269 pp.)
**Method:** deterministic pdfplumber + regex, column-wise summation vs. printed
reserved-code anchors. Exact match required. No LLM touches the numbers.

## Phase 2 scope

Two reconciliation units parsed end-to-end as the vertical slice. Every
extracted line item sums **exactly** to the document's own printed totals per
vintage column (2024 actual / 2025 budget / 2026 adopted).

**Aggregate: 40/42 checks PASS · 0 FAIL · 2 NOT_RECONCILABLE.**

### Reserved-code anchors reconciled

- `006000` NET SALARIES & WAGES TOTAL — via positions → *Total Before
  Adjustments* → (+ adjustments/deductions) → net. Position dollars **and**
  headcount reconcile.
- `006300` OPERATING EXPENDITURES TOTAL — sum of `630xxx–637xxx` line items.
- `006800` EQUIPMENT PURCHASES TOTAL — sum of equipment items.
- `SPECIAL FUNDS TOTAL` — sum of special-fund appropriations (where present).
- Division / Budgetary Control Unit **TOTAL** — sum of all five anchors.

### Dispositions

- **NOT_RECONCILABLE — 2024 salaries (both units).** The adopted book prints no
  per-position 2024 *actual* column, only the `006000` net-salaries actual. The
  position→total salary check therefore cannot run for the 2024 vintage. This is
  a source-document limitation, labeled `NOT_RECONCILABLE` rather than trusted
  silently (BetaNYC pattern). 2024 operating, equipment, special, and grand-total
  anchors *do* reconcile.
- **No source-document inconsistencies found** in the Phase 2 slice. All printed
  totals are internally consistent with their line items.

## Notes on the reclassification gotcha

ITMD contains position reclassifications whose 2025 and 2026 halves print on
separate physical lines — and, verified here, sometimes **far apart on the
page** (e.g. *Public Safety Systems Administrator*, 2025 half on p. 40 top≈484,
2026 half top≈647). Because reconciliation sums each vintage's column
independently, each printed number is counted exactly once regardless of
adjacency, so the totals reconcile without needing a fragile line-join.

---

### Department of Administration – Information & Technology Management Division

- Pages: **40–42** (1-based) · `Department Of Administration`
- Canonical rows emitted: **152**
- Checks: **20/21 PASS**, **0 FAIL**, **1 NOT_RECONCILABLE**

| Anchor check | Vintage | Printed total | Extracted | Δ | Status |
|---|---|--:|--:|--:|:--:|
| positions_sum == Total Before Adjustments ($) | 2025 budget | 7,000,589 | 7,000,589 | 0 | ✅ |
| positions_sum == Total Before Adjustments (units) | 2025 budget | 101 | 101 | 0 | ✅ |
| Total Before Adj + adjustments == NET SALARIES (006000) | 2025 budget | 6,004,481 | 6,004,481 | 0 | ✅ |
| positions_sum == NET SALARIES units (006000) | 2025 budget | 101 | 101 | 0 | ✅ |
| operating items == 006300 | 2025 budget | 4,157,335 | 4,157,335 | 0 | ✅ |
| equipment items == 006800 | 2025 budget | 25,000 | 25,000 | 0 | ✅ |
| special items == SPECIAL FUNDS TOTAL | 2025 budget | 2,226,292 | 2,226,292 | 0 | ✅ |
| 006000+006100+006300+006800+special == unit total | 2025 budget | 15,115,124 | 15,115,124 | 0 | ✅ |
| positions_sum == Total Before Adjustments ($) | 2026 adopted | 7,004,725 | 7,004,725 | 0 | ✅ |
| positions_sum == Total Before Adjustments (units) | 2026 adopted | 101 | 101 | 0 | ✅ |
| Total Before Adj + adjustments == NET SALARIES (006000) | 2026 adopted | 5,624,964 | 5,624,964 | 0 | ✅ |
| positions_sum == NET SALARIES units (006000) | 2026 adopted | 101 | 101 | 0 | ✅ |
| operating items == 006300 | 2026 adopted | 4,914,221 | 4,914,221 | 0 | ✅ |
| equipment items == 006800 | 2026 adopted | 25,000 | 25,000 | 0 | ✅ |
| special items == SPECIAL FUNDS TOTAL | 2026 adopted | 2,226,292 | 2,226,292 | 0 | ✅ |
| 006000+006100+006300+006800+special == unit total | 2026 adopted | 15,321,711 | 15,321,711 | 0 | ✅ |
| positions_sum == NET SALARIES (006000) _(no per-position 2024 actuals printed)_ | 2024 actual | 1,700,211 | — | — | ➖ |
| operating items == 006300 | 2024 actual | 3,851,009 | 3,851,009 | 0 | ✅ |
| equipment items == 006800 | 2024 actual | 10,481 | 10,481 | 0 | ✅ |
| special items == SPECIAL FUNDS TOTAL | 2024 actual | 2,112,653 | 2,112,653 | 0 | ✅ |
| 006000+006100+006300+006800+special == unit total | 2024 actual | 8,422,665 | 8,422,665 | 0 | ✅ |

### City Attorney

- Pages: **47–49** (1-based) · `City Attorney`
- Canonical rows emitted: **103**
- Checks: **20/21 PASS**, **0 FAIL**, **1 NOT_RECONCILABLE**

| Anchor check | Vintage | Printed total | Extracted | Δ | Status |
|---|---|--:|--:|--:|:--:|
| positions_sum == Total Before Adjustments ($) | 2025 budget | 6,468,382 | 6,468,382 | 0 | ✅ |
| positions_sum == Total Before Adjustments (units) | 2025 budget | 64 | 64 | 0 | ✅ |
| Total Before Adj + adjustments == NET SALARIES (006000) | 2025 budget | 6,028,111 | 6,028,111 | 0 | ✅ |
| positions_sum == NET SALARIES units (006000) | 2025 budget | 64 | 64 | 0 | ✅ |
| operating items == 006300 | 2025 budget | 407,200 | 407,200 | 0 | ✅ |
| equipment items == 006800 | 2025 budget | 26,000 | 26,000 | 0 | ✅ |
| special items == SPECIAL FUNDS TOTAL | 2025 budget | 0 | 0 | 0 | ✅ |
| 006000+006100+006300+006800+special == unit total | 2025 budget | 9,173,961 | 9,173,961 | 0 | ✅ |
| positions_sum == Total Before Adjustments ($) | 2026 adopted | 6,286,485 | 6,286,485 | 0 | ✅ |
| positions_sum == Total Before Adjustments (units) | 2026 adopted | 63 | 63 | 0 | ✅ |
| Total Before Adj + adjustments == NET SALARIES (006000) | 2026 adopted | 6,130,247 | 6,130,247 | 0 | ✅ |
| positions_sum == NET SALARIES units (006000) | 2026 adopted | 63 | 63 | 0 | ✅ |
| operating items == 006300 | 2026 adopted | 446,105 | 446,105 | 0 | ✅ |
| equipment items == 006800 | 2026 adopted | 22,000 | 22,000 | 0 | ✅ |
| special items == SPECIAL FUNDS TOTAL | 2026 adopted | 0 | 0 | 0 | ✅ |
| 006000+006100+006300+006800+special == unit total | 2026 adopted | 9,356,963 | 9,356,963 | 0 | ✅ |
| positions_sum == NET SALARIES (006000) _(no per-position 2024 actuals printed)_ | 2024 actual | 2,225,681 | — | — | ➖ |
| operating items == 006300 | 2024 actual | 438,477 | 438,477 | 0 | ✅ |
| equipment items == 006800 | 2024 actual | 18,934 | 18,934 | 0 | ✅ |
| special items == SPECIAL FUNDS TOTAL | 2024 actual | 0 | 0 | 0 | ✅ |
| 006000+006100+006300+006800+special == unit total | 2024 actual | 3,684,648 | 3,684,648 | 0 | ✅ |
