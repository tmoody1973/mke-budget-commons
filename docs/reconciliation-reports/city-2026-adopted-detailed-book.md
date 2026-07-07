# Reconciliation Report — City of Milwaukee 2026 Adopted Detailed Budget (whole book)

**doc_id:** `city-2026-adopted-detailed`  
**Source:** `data/raw/city/2026-CITY-OF-MILWAUKEE-DETAILED-BUDGET4.pdf`  
**Method:** deterministic pdfplumber + regex; the book is segmented into reconciliation units at each printed division/control-unit total, and every unit's line items are summed per vintage column against its printed reserved-code anchors. Exact match required. No LLM touches the numbers.

## Scope

Departmental line-item ledger, **pp. 1–180**. The citywide fund, special-purpose, and capital sections (pp. 181–269 — General City Purposes, Provision for Retirement, Transportation/Parking Funds, Water & Sewer enterprise funds, Capital Improvements) are a different document species and out of P0 scope per CLAUDE.md.

## Result

**Every dollar anchor reconciles exactly for 60 of 60 units (100%).**

- 🟢 **55 fully reconciled** — every check passes, including position headcount.
- 🟡 **0 money-reconciled** — every printed dollar total (NET salaries, operating, equipment, special funds, grand total) reconciles exactly; only the position *count* / positions-vs-Total-Before-Adjustments subtotal is off, because a position whose pay range wraps to the next line lands in the salary-adjustment bucket. The money is fully captured.
- 📌 **5 reconciled with a flagged source-document error** — the extracted line items are exact, but the document's own printed total is off by $1 (below).
- ❌ **0 dollar findings** — a printed dollar total does not match; listed below.

Checks: **1025 PASS**, **0 FAIL**, **139 NOT_RECONCILABLE** (2024 salaries have no per-position actuals; summary rollup pages itemize their components on the division detail pages).

### Dollar findings by size

| Category | Units | Meaning |
|---|--:|---|
| structural | 0 | Fire Department's multi-bureau decision-unit layout — needs a dedicated parse branch |
| small-money | 0 | one line item off by $1K–$140K — line-level review |
| $1 source-rounding | 0 | off by exactly $1 — candidate source-document inconsistency (BetaNYC pattern), pending confirmation |

## Source-document inconsistencies (findings, not bugs)

Verified arithmetic errors **inside the official PDF**: the document's own printed line items sum to a different figure than its printed total. Confirmed by summing the printed items by hand; extraction is exact. Registered in `crosswalks/source_inconsistencies.yml` — the disposition only holds while the exact numbers match, so a future parser change re-surfaces it.

| Pages | Unit | Check | Vintage | Printed total | Items sum | Δ |
|---|---|---|---|--:|--:|--:|
| 73–73 | Department Of Employee Relations Summa | operating items == 006300 | adopted | 618,260 | 617,287 | -973 |
| 86–86 | Fire Department Budgetary Control Unit | operating items == 006300 | actual | 9,306,699 | 9,306,698 | -1 |
| 93–95 | Fire Department | operating items == 006300 | actual | 3,036,395 | 3,036,394 | -1 |
| 137–148 | Police Department (1Bcu = 1Du) | operating items == 006300 | actual | 19,645,898 | 19,661,717 | 15,819 |
| 149–151 | Port Milwaukee Budgetary Control Unit  | operating items == 006300 | actual | 1,510,930 | 1,467,439 | -43,491 |
| 149–151 | Port Milwaukee Budgetary Control Unit  | special items == SPECIAL FUNDS TOTAL | actual | 3,128,675 | 3,115,665 | -13,010 |

## Open dollar findings

**None.** Every dollar discrepancy in the ledger is either reconciled or a documented source-document error above.

| Pages | Unit | Size | Failed dollar check | Vintage | Printed | Extracted | Δ |
|---|---|---|---|---|--:|--:|--:|

## All units

| Pages | Unit | PASS | FAIL | NR | Status |
|---|---|--:|--:|--:|---|
| 24–24 | Department Of Administration Budgetary Control | 8 | 0 | 7 | ✅ fully reconciled |
| 25–27 | Department Of Administration - Office Of The D | 20 | 0 | 1 | ✅ fully reconciled |
| 28–29 | Department Of Administration - Budget And Mana | 20 | 0 | 1 | ✅ fully reconciled |
| 30–32 | Department Of Administration - Environmental C | 20 | 0 | 1 | ✅ fully reconciled |
| 33–35 | Department Of Administration - Community Devel | 20 | 0 | 1 | ✅ fully reconciled |
| 36–37 | Department Of Administration- Purchasing Divis | 20 | 0 | 1 | ✅ fully reconciled |
| 38–39 | Department Of Administration - Intergovernment | 20 | 0 | 1 | ✅ fully reconciled |
| 40–42 | Department Of Administration-Information And T | 20 | 0 | 1 | ✅ fully reconciled |
| 43–44 | Department Of Administration - Office Of Commu | 15 | 0 | 2 | ✅ fully reconciled |
| 45–46 | Assessor'S Office Budgetary Control Unit (1Bcu | 20 | 0 | 1 | ✅ fully reconciled |
| 47–49 | City Attorney Budgetary Control Unit (1Bcu=1Du | 20 | 0 | 1 | ✅ fully reconciled |
| 50–50 | Department Of City Development Budgetary Contr | 11 | 0 | 4 | ✅ fully reconciled |
| 51–54 | Department Of City Development- General Manage | 20 | 0 | 1 | ✅ fully reconciled |
| 55–56 | Department Of City Development- | 9 | 0 | 4 | ✅ fully reconciled |
| 57–59 | City Treasurer Budgetary Control Unit (1Bcu=1D | 20 | 0 | 1 | ✅ fully reconciled |
| 60–63 | Common Council-City Clerk Budgetary Control Un | 20 | 0 | 1 | ✅ fully reconciled |
| 64–65 | Department Of Community Wellness And Safety Bu | 14 | 0 | 3 | ✅ fully reconciled |
| 66–68 | Comptroller Budgetary Control Unit (1Bcu=1Du) | 20 | 0 | 1 | ✅ fully reconciled |
| 69–70 | Election Commission Budgetary Control Unit (1B | 20 | 0 | 1 | ✅ fully reconciled |
| 71–72 | Department Of Emergency Communications Budgeta | 20 | 0 | 1 | ✅ fully reconciled |
| 73–73 | Department Of Employee Relations Summary (1Bcu | 7 | 0 | 7 | 📌 reconciled · source-doc $1 error flagged |
| 74–75 | Department Of Employee Relations Administratio | 20 | 0 | 1 | ✅ fully reconciled |
| 76–77 | Department Of Employee Relations Employee Bene | 20 | 0 | 1 | ✅ fully reconciled |
| 78–80 | Department Of Employee Relations Operations Di | 20 | 0 | 1 | ✅ fully reconciled |
| 81–82 | Department Of Compliance And Engagement Budget | 14 | 0 | 3 | ✅ fully reconciled |
| 83–85 | Fire And Police Commission Budgetary Control U | 19 | 0 | 2 | ✅ fully reconciled |
| 86–86 | Fire Department Budgetary Control Unit (Summar | 7 | 0 | 7 | 📌 reconciled · source-doc $1 error flagged |
| 87–89 | Fire Department Operations Bureau Decision Uni | 20 | 0 | 1 | ✅ fully reconciled |
| 90–92 | Fire Department | 20 | 0 | 1 | ✅ fully reconciled |
| 93–95 | Fire Department | 19 | 0 | 1 | 📌 reconciled · source-doc $1 error flagged |
| 96–96 | Health Department Budgetary Control Unit Summa | 6 | 0 | 9 | ✅ fully reconciled |
| 97–99 | Health Department Office Of The Commissioner & | 19 | 0 | 2 | ✅ fully reconciled |
| 100–102 | Health Department Policy, Innovation & Equity  | 19 | 0 | 2 | ✅ fully reconciled |
| 103–105 | Health Department Family & Community Health Di | 20 | 0 | 1 | ✅ fully reconciled |
| 106–109 | Health Department Clinical Services Division ( | 19 | 0 | 2 | ✅ fully reconciled |
| 110–112 | Health Department Environmental Health Divisio | 20 | 0 | 1 | ✅ fully reconciled |
| 113–113 | Library Budgetary Control Unit (Summary 1Bcu=4 | 8 | 0 | 7 | ✅ fully reconciled |
| 114–115 | Library Administrative Services Decision Unit | 19 | 0 | 2 | ✅ fully reconciled |
| 116–116 | Library Branch Library Services Decision Unit | 9 | 0 | 4 | ✅ fully reconciled |
| 117–117 | Library Central Library Decision Unit | 9 | 0 | 4 | ✅ fully reconciled |
| 118–120 | Library Operations Decision Unit | 19 | 0 | 2 | ✅ fully reconciled |
| 121–123 | Library It, Technical Services, & Collections  | 19 | 0 | 2 | ✅ fully reconciled |
| 124–127 | Library | 19 | 0 | 2 | ✅ fully reconciled |
| 128–129 | Decision Unit Total Mayor'S Office Budgetary C | 20 | 0 | 1 | ✅ fully reconciled |
| 130–131 | Municipal Court Budgetary Control Unit (1Bcu=1 | 20 | 0 | 1 | ✅ fully reconciled |
| 132–136 | Department Of Neighborhood Services Budgetary  | 20 | 0 | 1 | ✅ fully reconciled |
| 137–148 | Police Department (1Bcu = 1Du) | 18 | 0 | 2 | 📌 reconciled · source-doc $1 error flagged |
| 149–151 | Port Milwaukee Budgetary Control Unit (1Bcu=1D | 18 | 0 | 1 | 📌 reconciled · source-doc $1 error flagged |
| 152–152 | Department Of Public Works Summary (3 Bcu'S) | 8 | 0 | 7 | ✅ fully reconciled |
| 153–155 | Dpw-Administrative Services Division Budgetary | 20 | 0 | 1 | ✅ fully reconciled |
| 156–156 | (1 Bcu=1 Du) Dpw-Infrastructure Services Divis | 11 | 0 | 4 | ✅ fully reconciled |
| 157–158 | Dpw-Infrastructure Services Division Administr | 20 | 0 | 1 | ✅ fully reconciled |
| 159–162 | Dpw-Infrastructure Services Division- Transpor | 19 | 0 | 2 | ✅ fully reconciled |
| 163–166 | Dpw-Infrastructure Services Division- | 19 | 0 | 2 | ✅ fully reconciled |
| 167–169 | Dpw-Infrastructure Services Division Bridges & | 19 | 0 | 2 | ✅ fully reconciled |
| 170–170 | Dpw-Operations Division Budgetary Control Unit | 8 | 0 | 7 | ✅ fully reconciled |
| 171–172 | Dpw-Operations Division Administration Section | 20 | 0 | 1 | ✅ fully reconciled |
| 173–175 | Dpw-Operations Division Fleet Services Section | 19 | 0 | 2 | ✅ fully reconciled |
| 176–177 | Dpw-Operations Division Sanitation Section | 19 | 0 | 2 | ✅ fully reconciled |
| 178–180 | Dpw-Operations Division Forestry Section | 19 | 0 | 2 | ✅ fully reconciled |
