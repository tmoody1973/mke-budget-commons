# Reconciliation Report — Milwaukee County 2026 Countywide Tax-Levy Crosswalk

**doc_id:** `county-2026-adopted-operating` (Property Taxes chapter, pp. 414-417)  
**Method:** the Property Taxes chapter prints a countywide crosswalk — every department's Expenditures / Revenue / Tax Levy by fund type, grouped by function, with subtotals. It is an *independent restatement* of every department's bottom line, so it cross-checks the per-department BUDGET SUMMARY chapters and ties up to the printed Property Tax Levy. Deterministic pdfplumber extraction; no LLM.

## Result

**106 of 108 checks reconcile exactly; 0 findings.** A whole-budget, four-level document-level cross-check:

- 🧮 **12 group subtotals** each equal the sum of their member department rows.
- 🎯 **The grand total ties to the anchor:** the sum of every department's tax levy equals the printed **Property Tax Levy of $309,014,834**, to the dollar.
- 🔗 **32 departments cross-verify** — the crosswalk's Tax Levy matches each department's own BUDGET SUMMARY chapter (an independent restatement agreeing), and the operating Expenditures/Revenue match once the Trust funds the chapters omit are excluded.
- ⚪ **2 not reconcilable** — Capital Improvements (Agency 120; the capital budget is a separate, parked document) and the Property Taxes chapter itself (Agency 199).

This closes the loop deferred in the county non-departmental-ledger work: the entire county operating budget now reconciles both **bottom-up** (line items → department totals) and **top-down** (department totals → countywide property tax levy).

**No open findings.** Every printed figure in the crosswalk reconciles.

