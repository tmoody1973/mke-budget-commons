// Plain-language glossary so citizens and journalists can read the budget without
// decoding jargon. Reference data (stable across docs), embedded rather than queried.
// Footnote meanings are largely defined per-chapter in the document's own legend —
// the standard ones are marked; the rest point back to the source page.

export type GlossaryEntry = { term: string; kind: string; plain: string };

export const GLOSSARY: GlossaryEntry[] = [
  // Reserved account codes (city Detailed Budget)
  { term: "006000", kind: "account code", plain: "NET SALARIES & WAGES — total pay for a unit after overtime, vacancy adjustments, and reimbursements/deductions." },
  { term: "006100", kind: "account code", plain: "ESTIMATED EMPLOYEE FRINGE BENEFITS — health insurance, pension, and other benefits, on top of salaries." },
  { term: "006300", kind: "account code", plain: "OPERATING EXPENDITURES — non-people costs: supplies, professional services, rent, utilities, IT." },
  { term: "006800", kind: "account code", plain: "EQUIPMENT PURCHASES — vehicles, computers, and other capital equipment bought that year." },
  { term: "630000-637999", kind: "account code", plain: "The individual operating-expense categories (general office, professional services, property services, etc.) that sum to 006300." },
  // Terms
  { term: "FTE", kind: "term", plain: "Full-Time Equivalent — one full-time position, or the sum of part-time fractions. The city's headcount measure." },
  { term: "O&M FTE", kind: "term", plain: "Operations & Maintenance FTE — positions paid for by the regular (tax-levy) operating budget." },
  { term: "NON-O&M FTE", kind: "term", plain: "Positions paid for by grants, capital projects, or reimbursements — not the tax-levy operating budget." },
  { term: "Tax Levy", kind: "term", plain: "The share of the budget funded by property taxes = total expenditures minus all other revenue (grants, fees, charges)." },
  { term: "BCU", kind: "term", plain: "Budgetary Control Unit — the level at which the Common Council controls spending; usually a department or major division." },
  { term: "DU", kind: "term", plain: "Decision Unit — a sub-division within a Budgetary Control Unit." },
  { term: "Pay Range", kind: "term", plain: "The salary-grade code for a position (e.g. 2TX). Sets the min/max salary for that title." },
  { term: "Personnel Cost Adjustment", kind: "term", plain: "An actuarial/vacancy adjustment that lowers budgeted salaries to reflect turnover and unfilled positions." },
  { term: "Reimbursable Services Deduction", kind: "term", plain: "Salary costs billed back to grants or other funds, removed from the tax-levy salary total." },
  // Vintages (amount_kind)
  { term: "actual", kind: "vintage", plain: "A completed, audited prior year — what was actually spent." },
  { term: "budget", kind: "vintage", plain: "The current year's adopted budget (the plan in force)." },
  { term: "adopted", kind: "vintage", plain: "The budget as enacted by the Common Council — the final, official number." },
  { term: "requested", kind: "vintage", plain: "What a department asked for — the starting point, before the Mayor and Council revise it." },
  { term: "proposed", kind: "vintage", plain: "The Mayor/executive's recommended version, between a department's request and final adoption." },
  // Footnote codes (city) — standard ones; most are defined per chapter's legend.
  { term: "Y", kind: "footnote", plain: "Position must file a statement of economic interests (Code of Ethics, Milwaukee Code Ch. 303)." },
  { term: "X", kind: "footnote", plain: "A private-auto allowance may be paid to this position (Milwaukee Code 350-183)." },
  { term: "CCR", kind: "footnote", plain: "The position must annually contact each Common Council member for feedback on its performance." },
  { term: "A", kind: "footnote", plain: "Commonly a bilingual designation — but the exact meaning is defined in each department's footnote legend." },
  { term: "grant-expiry", kind: "footnote", plain: "A family of footnotes (e.g. RST, VR, DOL, ERP) marking positions that END when a specific grant or award expires unless renewed — worth watching for 'what happens when the money runs out' stories. Exact terms are in the chapter's legend." },
  // County
  { term: "Agency No.", kind: "county", plain: "Milwaukee County's department identifier (e.g. 100 = County Board of Supervisors). The reliable anchor for county chapters." },
  { term: "Strategic Program Area", kind: "county", plain: "A county department's sub-program grouping; each has its own budget summary and performance measures." },
];

export function lookupGlossary(term?: string) {
  if (!term) {
    const byKind: Record<string, GlossaryEntry[]> = {};
    for (const e of GLOSSARY) (byKind[e.kind] ??= []).push(e);
    return { count: GLOSSARY.length, by_kind: byKind };
  }
  const q = term.trim().toLowerCase();
  const hits = GLOSSARY.filter(
    (e) => e.term.toLowerCase() === q || e.term.toLowerCase().includes(q) || e.plain.toLowerCase().includes(q),
  );
  return hits.length ? { term, matches: hits } : { term, matches: [], note: "No glossary entry — footnote meanings can be department-specific; check the source page." };
}
