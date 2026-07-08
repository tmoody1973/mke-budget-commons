# Reconciliation Report — MPS FY2026-27 Revised Proposed Budget

**doc_id:** `mps-2027-proposed-lineitem`  
**Source:** `data/raw/mps/mps-2027-proposed-line-item.xlsx` (structured spreadsheet — the reconcilable core)  
**Method:** deterministic `pandas` read of the two sheets; each real line item (structured account code, ≥3 segments) is summed per vintage and checked against the spreadsheet's own printed grand-total rows (the null-account memo rows). Exact match required. No LLM touches the numbers.

## Result

**All 8 money checks reconcile exactly** across both vintages (FY2026 budget, FY2027 proposed): expenditure line items → printed grand total, FTE → printed total FTE, printed gross − eliminations = net, and revenue line items → printed revenue total.

- ✅ **8 PASS** · ❌ **0 FAIL** · ⚪ **2 documented exclusions** · ℹ️ **2 informational**.
- **29647 expenditure** + **253 revenue** line items (29900 canonical facts), each citing its spreadsheet row.

### Printed grand totals (verified against the extracted line items)

| Vintage | Expenditures (net) | = gross − eliminations | Total FTE | Revenue |
|---|--:|--:|--:|--:|
| FY2026 budget | $1,623,761,832 | $1,816,802,699 − $193,040,867 | 9,541.09 | $1,623,887,232.84 |
| FY2027 proposed | $1,600,555,548 | $1,756,026,067 − $155,470,519 | 10,115.32 | $1,618,211,277.92 |

The FY2027 net ($1,600,555,548) and its −$23.2M change from the FY2026 budget ($1,623,761,832) match the District's published "$1,600.6M, down $23.2M" headline.

### Revenue over expenditure (informational)

- **FY2026 budget:** revenue − expenditure = **$125,400.84** — a planned surplus / use-of-fund-balance reconciling item, not a discrepancy.
- **FY2027 proposed:** revenue − expenditure = **$17,655,729.92** — a planned surplus / use-of-fund-balance reconciling item, not a discrepancy.

### Documented exclusions (surfaced, never dropped)

Phrase-labeled rows that sit **outside** the spreadsheet's printed grand total (no structured account code) — captured here for transparency:

| Row | FY2026 | FY2027 |
|---|--:|--:|
| MKE Rec - Extension: NPR | $18,000,000 | $0 |
| MKE Rec - Extension: NPR | $3,000,000 | $0 |

### FY2027 expenditures by fund

| Fund (account segment 2) | FY2027 proposed |
|---|--:|
| I | $578,944,865 |
| 0 | $483,573,821 |
| V | $244,299,704 |
| S | $134,743,878 |
| A | $89,553,227 |
| B | $42,416,517 |
| U | $26,762,292 |
| P | $258,214 |
| 4 | $3,030 |
| **All funds** | **$1,600,555,548** |

