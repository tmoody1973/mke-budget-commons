# Reconciliation Report — Milwaukee County 2026 Adopted Operating Budget

**doc_id:** `county-2026-adopted-operating`  
**Source:** `data/raw/county/2026-Adopted-Operating-Budget-.pdf`  
**Method:** deterministic pdfplumber `extract_tables()`; the book is segmented into department chapters at each `Agency No. NNN` running header, and every chapter's BUDGET SUMMARY table is reconciled against its own printed identities (components → Total Expenditures; revenues → Total Revenues; Total Expenditures − Total Revenues = Tax Levy; the printed Variance = 2026 adopted − 2025 budget; and each Strategic Program Area's Program Budget Summary rolls up to the department total). Exact match required for budget/adopted vintages. No LLM touches the numbers.

## Scope

Department operating chapters, **pp. 78–442** (37 chapters). The county Capital Budget is a separate, OCR-degraded document (Phase 5+, per CLAUDE.md) and is not in this report.

## Result

**Every printed dollar identity reconciles for 37 of 37 chapters (100%).**

- 🟢 **8 fully reconciled** — every check passes exactly across all four vintages, program rollups, and the Variance column.
- 📌 **29 reconciled with prior-year actual rounding** — every 2025 budget and 2026 adopted figure foots exactly; only the **2023/2024 actual** columns drift $1–$3 because the county reports actuals rounded independently (each component rounded to the dollar). The drift is bounded by `(N+1)/2` for an N-component sum and surfaced per check — never silently absorbed.
- 🧾 **2 non-departmental revenue ledgers** (Non-Departmental Revenues, Property Taxes) — item lines sum exactly to the printed Total Revenues (the $184.6M revenue ledger and the $309.0M property-tax levy), captured as facts with page citations rather than dropped.
- 🧩 **2 non-departmental program lists** (Cultural Contributions, Non-Departmental Expenditures) — no chapter total, but each program area's own Expenditures − Revenues = Tax Levy identity reconciles.
- ⚪ **0 still non-standard** · ❌ **0 open dollar findings.**

Checks: **842 PASS**, **66 ROUNDING** (prior-year actual, bounded), **0 FAIL**, **0 NOT_RECONCILABLE**.

## Prior-year actual rounding (findings, not bugs)

The county's *adopted budget* figures are constructed to foot exactly; its *prior-year actuals* are reported rounded, so independently-rounded components sum a few dollars off the printed total. This is the BetaNYC source-rounding pattern, confined here to the actual columns and bounded by the number of addends.

| Agency | Department | Rounding checks | Max Δ |
|---|---|--:|--:|
| 110 | County Executive - General Office | 1 | $1 |
| 327 | Office of the County Clerk | 3 | $1 |
| 340 | Office of the Register of Deeds | 3 | $1 |
| 370 | Office of the Comptroller | 2 | $1 |
| 109 | Office of Equity | 1 | $1 |
| 112 | Personnel Review Board, Civil Service Comm | 1 | $1 |
| 113 | Corporation Counsel | 1 | $1 |
| 114 | Department of Human Resources | 2 | $1 |
| 115 | Department of Administrative Services | 4 | $3 |
| 118 | Office of Strategy, Budget & Performance | 1 | $1 |
| 200 | Combined Court Related Operations | 4 | $2 |
| 400 | Office of the Sheriff | 4 | $2 |
| 450 | Office of the District Attorney | 1 | $1 |
| 480 | Office of Emergency Management | 3 | $1 |
| 490 | Medical Examiner | 1 | $1 |
| 504 | Airport | 4 | $1 |
| 509 | Transportation Services | 4 | $1 |
| 510 | Highway Maintenance | 2 | $1 |
| 530 | Fleet Management | 3 | $1 |
| 560 | Transit/Paratransit System | 1 | $1 |
| 580 | Director's Office | 2 | $1 |
| 630 | Mental Health Board - Behavioral Health Se | 2 | $1 |
| 800 | Department of Health & Human Services | 3 | $1 |
| 900 | Department of Parks, Recreation & Culture | 3 | $1 |
| 950 | Zoological Department | 2 | $1 |
| 991 | UW - Extension | 2 | $1 |
| 996 | General County Debt Service | 2 | $1 |
| 190 | Non - Departmental Revenues | 2 | $1 |
| 195 | Employee & Retiree Fringe Benefits | 2 | $1 |

## Open dollar findings

**None.** Every dollar identity in the departmental chapters reconciles exactly (budget/adopted) or within the bounded prior-year-actual rounding above.


## All chapters

| Pages | Agency | Department | Kind | PASS | ROUND | FAIL | NR | Programs | Status |
|---|---|---|---|--:|--:|--:|--:|--:|---|
| 78–81 | 100 | County Board of Supervisors | standard | 18 | 0 | 0 | 0 | 1 | ✅ fully reconciled |
| 82–84 | 110 | County Executive - General Office | standard | 16 | 1 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 85–88 | 103 | County Executive - Office of Governmen | standard | 24 | 0 | 0 | 0 | 1 | ✅ fully reconciled |
| 89–91 | 309 | Office of the County Treasurer | standard | 24 | 0 | 0 | 0 | 1 | ✅ fully reconciled |
| 92–96 | 327 | Office of the County Clerk | standard | 22 | 3 | 0 | 0 | 2 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 97–102 | 340 | Office of the Register of Deeds | standard | 21 | 3 | 0 | 0 | 4 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 103–115 | 370 | Office of the Comptroller | standard | 23 | 2 | 0 | 0 | 7 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 116–120 | 109 | Office of Equity | standard | 23 | 1 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 121–124 | 112 | Personnel Review Board, Civil Service  | standard | 17 | 1 | 0 | 0 | 3 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 125–130 | 113 | Corporation Counsel | standard | 23 | 1 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 131–147 | 114 | Department of Human Resources | standard | 23 | 2 | 0 | 0 | 6 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 148–200 | 115 | Department of Administrative Services | standard | 23 | 4 | 0 | 0 | 26 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 201–210 | 118 | Office of Strategy, Budget & Performan | standard | 25 | 1 | 0 | 0 | 3 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 211–224 | 200 | Combined Court Related Operations | standard | 22 | 4 | 0 | 0 | 9 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 225–232 | 290 | Courts - Pretrial Services | standard | 24 | 0 | 0 | 0 | 1 | ✅ fully reconciled |
| 233–251 | 400 | Office of the Sheriff | standard | 22 | 4 | 0 | 0 | 10 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 252–259 | 430 | Community Reintegration Center | standard | 26 | 0 | 0 | 0 | 4 | ✅ fully reconciled |
| 260–269 | 450 | Office of the District Attorney | standard | 25 | 1 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 270–281 | 480 | Office of Emergency Management | standard | 23 | 3 | 0 | 0 | 5 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 282–288 | 490 | Medical Examiner | standard | 25 | 1 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 289–296 | 504 | Airport | standard | 23 | 4 | 0 | 0 | 2 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 297–299 | 509 | Transportation Services | standard | 23 | 4 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 300–302 | 510 | Highway Maintenance | standard | 24 | 2 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 303–305 | 530 | Fleet Management | standard | 24 | 3 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 306–312 | 560 | Transit/Paratransit System | standard | 25 | 1 | 0 | 0 | 2 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 313–318 | 580 | Director's Office | standard | 24 | 2 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 319–334 | 630 | Mental Health Board - Behavioral Healt | standard | 23 | 2 | 0 | 0 | 5 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 335–358 | 800 | Department of Health & Human Services | standard | 23 | 3 | 0 | 0 | 5 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 359–368 | 900 | Department of Parks, Recreation & Cult | standard | 24 | 3 | 0 | 0 | 3 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 369–382 | 950 | Zoological Department | standard | 23 | 2 | 0 | 0 | 5 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 383–388 | 991 | UW - Extension | standard | 22 | 2 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 389–402 | 199 | Consolidated Non - Departmental Cultur | nondept_programs | 36 | 0 | 0 | 0 | 9 | ✅ fully reconciled |
| 403–409 | 996 | General County Debt Service | standard | 22 | 2 | 0 | 0 | 1 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 410–413 | 190 | Non - Departmental Revenues | revenue_ledger | 14 | 2 | 0 | 0 | 0 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 414–419 | 199 | Property Taxes | revenue_ledger | 6 | 0 | 0 | 0 | 0 | ✅ fully reconciled |
| 420–426 | 195 | Employee & Retiree Fringe Benefits | standard | 17 | 2 | 0 | 0 | 0 | 📌 reconciled · prior-year actual rounding (±$1–$3) |
| 427–442 | 194 | Non - Departmental Expenditures | nondept_programs | 40 | 0 | 0 | 0 | 10 | ✅ fully reconciled |
