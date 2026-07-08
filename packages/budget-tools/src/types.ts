// Typed return surface for @mke/budget-tools query functions.
//
// Every interface here is transcribed from the object literal the corresponding
// function in src/queries/*.ts actually returns today — no invented fields.
// Gov-specific branches that return different shapes are modeled as unions.

import type { Gov } from "./helpers";
import type { GlossaryEntry } from "./glossary";

export type CitationRef = { doc_id: string; source_page: number };

export type Ambiguous = { ambiguous: true; candidates: { dept_id: string; canonical_name: string }[] };

export const isAmbiguous = (r: unknown): r is Ambiguous =>
  typeof r === "object" && r !== null && (r as any).ambiguous === true;

// --------------------------------------------------------------------------- //
// departments.ts
// --------------------------------------------------------------------------- //

export type DepartmentList = {
  government: Gov;
  total_label: string;
  departments: { dept_id: string; name: string; total: number | null }[];
};

export type CityDeptBudget = {
  department: string;
  dept_id: string;
  doc_type: string;
  totals: {
    net_salaries_006000: number | null;
    fringe_006100: number | null;
    operating_006300: number | null;
    equipment_006800: number | null;
    grand_total: number | null;
  };
  fte: { om: number | null; non_om: number | null };
  divisions: string[];
  top_expenditures: {
    description: string;
    account: string | null;
    amount: number | null;
    page: number;
  }[];
  citations: CitationRef[];
};

export type MpsSchoolBudget = {
  school_or_office: string;
  dept_id: string;
  gov: "mps";
  fiscal_year: number;
  vintage: "proposed" | "budget";
  total: number | null;
  total_fte: number | null;
  line_count: number;
  top_spending_by_object: {
    object: string;
    amount: number | null;
    fte: number | null;
    page: number;
  }[];
  by_fund: { fund: string; amount: number | null }[];
  citations: CitationRef[];
  note: string;
};

export type CountyDeptBudget = {
  department: string;
  dept_id: string;
  gov: "county";
  fiscal_year: number;
  totals: {
    personnel_costs: number | null;
    operations_costs: number | null;
    debt_and_depreciation: number | null;
    interdepartmental_charges: number | null;
    total_expenditures: number | null;
    total_revenues: number | null;
    tax_levy: number | null;
  };
  fte: { full_time: number | null };
  strategic_program_areas: string[];
  citations: CitationRef[];
  note: string;
};

export type DepartmentBudget = CityDeptBudget | CountyDeptBudget | MpsSchoolBudget;

// --------------------------------------------------------------------------- //
// breakdown.ts
// --------------------------------------------------------------------------- //

export type BreakdownPart = { amount: number; pct: number };

export type CityBreakdown = {
  scope: string;
  fiscal_year: number;
  total: number;
  breakdown: {
    salaries: BreakdownPart;
    fringe_benefits: BreakdownPart;
    operating: BreakdownPart;
    equipment: BreakdownPart;
    special_funds: BreakdownPart;
  };
  citations: CitationRef[];
  note: string;
};

export type CountyBreakdown = {
  scope: string;
  fiscal_year: number;
  total_expenditures: number;
  breakdown: {
    personnel: BreakdownPart;
    operations: BreakdownPart;
    debt_and_depreciation: BreakdownPart;
    interdepartmental_charges: BreakdownPart;
  };
  citations: CitationRef[];
  note: string;
};

export type MpsBreakdown = {
  scope: string;
  fiscal_year: number;
  total: number;
  people_costs: { salaries: BreakdownPart; benefits: BreakdownPart; other: BreakdownPart };
  top_objects: (BreakdownPart & { object: string })[];
  citations: CitationRef[];
  note: string;
};

export type BudgetBreakdown = CityBreakdown | CountyBreakdown | MpsBreakdown;

// --------------------------------------------------------------------------- //
// compare.ts
// --------------------------------------------------------------------------- //

// Built with a dynamic `fy${year}` key alongside `delta`/`delta_pct`, all of the
// same value type — a string index signature captures the actual shape exactly.
export type YearComparisonLine = Record<string, number | null>;

export type CompareYears = {
  department: string;
  grand_total: YearComparisonLine;
  net_salaries: YearComparisonLine;
  fringe: YearComparisonLine;
  operating: YearComparisonLine;
  equipment: YearComparisonLine;
  citations: CitationRef[];
};

export type TraceAdoption = {
  department: string;
  fiscal_year: number;
  stages: { stage: string; grand_total: number | null; change_from_prev: number | null }[];
  note?: string;
  citations: CitationRef[];
};

// Built with dynamic `fy${year}` keys (number) alongside `department` (string) —
// a string|number index signature captures the actual shape exactly.
export type BiggestChangeItem = Record<string, string | number>;

export type BiggestChanges = {
  gov: Gov;
  comparing: string;
  measure: "dollars" | "percent";
  direction: "up" | "down" | "both";
  results: BiggestChangeItem[];
  citations: CitationRef[];
};

// --------------------------------------------------------------------------- //
// positions.ts
// --------------------------------------------------------------------------- //

export type Positions = {
  department: string;
  position_rows: number;
  total_units: number;
  positions: {
    title: string;
    pay_range: string | null;
    units: number | null;
    salary: number | null;
    division: string | null;
    flags: string[] | null;
    page: number;
  }[];
  citations: CitationRef[];
};

export type FindPositions = {
  fiscal_year: number;
  matched: number;
  positions: {
    line_id: number;
    title: string;
    department: string;
    division: string | null;
    pay_range: string | null;
    salary_per_position: number | null;
    count: number | null;
    budgeted_total: number | null;
    flags: string[] | null;
    page: number;
  }[];
  citations: CitationRef[];
};

// --------------------------------------------------------------------------- //
// schools.ts
// --------------------------------------------------------------------------- //

export type CompareSchoolSide =
  | { query: string; error: string }
  | { query: string; ambiguous: string[] }
  | {
      name: string;
      total: number | null;
      fte: number | null;
      line_count: number;
      top_objects: { object: string; amount: number | null }[];
    };

export type CompareSchools = {
  fiscal_year: number;
  a: CompareSchoolSide;
  b: CompareSchoolSide;
  delta: { total: number; pct: number | null } | null;
  note: string;
};

export type MpsFundSummary = {
  government: "mps";
  fiscal_year: number;
  vintage: "proposed" | "budget";
  total_expenditures: number | null;
  total_revenue: number | null;
  total_fte: number | null;
  surplus_or_fund_balance_use: number | null;
  by_fund: { fund: string; amount: number | null }[];
  note: string;
};

export type PerPupilSchoolResult = {
  school: string;
  enrollment: number | null;
  budget: number | null;
  fte: number | null;
  per_pupil: number | null;
};

export type PerPupilRanking = {
  fiscal_year: number;
  order: "highest" | "lowest";
  min_enrollment: number;
  schools_ranked: number;
  district_median_per_pupil: number | null;
  results: PerPupilSchoolResult[];
  citations: CitationRef[];
  note: string;
};

// --------------------------------------------------------------------------- //
// search.ts
// --------------------------------------------------------------------------- //

export type RunSqlResult = { sql: string; row_count: number; rows: Record<string, unknown>[] };

export type SearchResults = {
  query: string;
  hits: number;
  results: {
    line_id: number;
    department: string;
    division: string | null;
    description: string;
    kind: string;
    pay_range: string | null;
    amount: number | null;
    account: string | null;
    page: number;
  }[];
  citations: CitationRef[];
};

export type Cite = {
  line_id: number;
  department: string;
  division: string | null;
  description: string;
  account: string | null;
  amount: number | null;
  amount_kind: string;
  units: number | null;
  pay_range: string | null;
  flags: string[] | null;
  citation: {
    doc_id: string;
    fiscal_year: number;
    doc_type: string;
    source_page: number;
    source_url: string;
  };
};

export type ReconciliationStatus = {
  doc_id: string;
  summary: Record<string, number>;
  findings: {
    scope: string;
    status: string;
    printed_total: number | null;
    extracted_total: number | null;
    delta: number | null;
    note: string | null;
  }[];
};

export type GlossaryByKind = { count: number; by_kind: Record<string, GlossaryEntry[]> };
export type GlossarySearch = { term: string; matches: GlossaryEntry[]; note?: string };
export type GlossaryResult = GlossaryByKind | GlossarySearch;

// --------------------------------------------------------------------------- //
// context.ts — Layer-2 WPF context retrieval (SECONDARY commentary, not fact)
// --------------------------------------------------------------------------- //

/** One retrieved Wisconsin Policy Forum passage. Carries brief + page provenance;
 *  it is qualitative wisdom to be attributed, NEVER a source of figures. */
export type ContextPassage = {
  text: string;
  brief_id: string;
  brief_title: string;
  gov: Gov | null;
  year: number | null;
  page: number;
  section: string | null;
  source_url: string | null;
  score: number;
};

export type ExplainResult = {
  question: string;
  passages: ContextPassage[];
  note: string;
};
