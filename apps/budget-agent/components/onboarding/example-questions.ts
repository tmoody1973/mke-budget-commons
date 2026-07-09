// Example questions for the "How to use the Budget Analyst" modal, grouped by who's
// asking. Every question is answerable by the analyst's read-only, cited tools
// (biggest_changes, get_department_budget, budget_breakdown, search_line_items,
// compare_years, per_pupil_ranking, reconciliation_status, glossary, cite, run_sql)
// over the three governments (City, County, MPS). The `hint` names the angle/tables
// so users see the analyst can join across the data, not just look one thing up.

export type ExampleQuestion = { q: string; hint?: string };

export type Persona = {
  id: string;
  emoji: string;
  label: string;
  blurb: string;
  questions: ExampleQuestion[];
};

export const PERSONAS: Persona[] = [
  {
    id: "residents",
    emoji: "🏠",
    label: "Residents",
    blurb: "Plain-English answers about where your tax dollars go — no jargon.",
    questions: [
      { q: "What does the City of Milwaukee spend the most money on?", hint: "citywide breakdown" },
      { q: "How much of the city budget goes to the Police and Fire departments?", hint: "two departments, cited" },
      { q: "Did the 2026 city budget raise property taxes, and why?", hint: "tax levy + plain-English context" },
      { q: "Explain Milwaukee County's transit budget like I'm new to all this.", hint: "ELI12" },
      { q: "How many people does the City of Milwaukee employ, and in which departments?", hint: "FTE counts" },
    ],
  },
  {
    id: "journalists",
    emoji: "📰",
    label: "Journalists",
    blurb: "Find the story: swings, discrepancies, and comparisons — all sourced to a page.",
    questions: [
      { q: "Which city departments had the biggest budget cuts from 2025 to 2026, and what's the story?", hint: "biggest_changes → angle" },
      { q: "Show me the reconciliation findings — where do the official documents not add up?", hint: "source_inconsistency = leads" },
      { q: "Compare the Milwaukee County Sheriff's budget across the last two years, with the $ and % change.", hint: "compare_years" },
      { q: "Which MPS schools spend the most per pupil, and which spend the least?", hint: "per_pupil_ranking" },
      { q: "What changed most in the MPS budget between the current and proposed years?", hint: "cross-year, spreadsheet-sourced" },
    ],
  },
  {
    id: "educators",
    emoji: "🎓",
    label: "Educators",
    blurb: "Teach how a public budget is structured, with real numbers to point at.",
    questions: [
      { q: "Break down where Milwaukee Public Schools' money goes — salaries vs. benefits vs. everything else.", hint: "MPS breakdown" },
      { q: "What's the difference between the tax levy and total expenditures? Use real county numbers.", hint: "glossary + county totals" },
      { q: "What do the reserved account codes (006000, 006100, 006300) mean in the city budget?", hint: "glossary + example dept" },
      { q: "Walk me through how the City of Milwaukee closed its budget gap for 2026.", hint: "multi-step, cited" },
      { q: "Show the Health Department's full budget with citations I can verify.", hint: "get_department_budget + cite" },
    ],
  },
  {
    id: "students",
    emoji: "🎒",
    label: "Students",
    blurb: "Start anywhere — the analyst explains terms and shows its sources as it goes.",
    questions: [
      { q: "What is a structural deficit, and does Milwaukee have one?", hint: "glossary + context" },
      { q: "Search the budget for anything about 'lead' or 'climate' and show me what turns up.", hint: "search_line_items" },
      { q: "Pick a city department and explain its entire budget to me, step by step.", hint: "guided, cited" },
      { q: "What's the biggest single line item in the whole MPS budget?", hint: "line-item search" },
      { q: "How is money split between the City, the County, and the schools?", hint: "three governments" },
    ],
  },
  {
    id: "deep-dives",
    emoji: "🔬",
    label: "Deep dives",
    blurb: "Complex questions that join tables and cross governments — the analyst writes read-only SQL when a typed tool isn't enough.",
    questions: [
      {
        q: "Across all three governments, which single department or school has the largest total budget? Cite the source page or row.",
        hint: "cross-gov join: fact_budget_line × dim_department × dim_document",
      },
      {
        q: "For the city, rank departments by the share of their budget that goes to salaries vs. operating, and flag the top three.",
        hint: "per-department breakdown + ranking",
      },
      {
        q: "Which MPS schools have both high per-pupil spending AND below-average enrollment?",
        hint: "fact_school join: per-pupil × enrollment",
      },
      {
        q: "Compare total personnel costs as a percentage of the budget between the City and the County.",
        hint: "cross-gov ratio",
      },
      {
        q: "Find every department whose 2026 budget fell more than 10% from 2025, across all governments.",
        hint: "cross-year threshold query",
      },
    ],
  },
];
