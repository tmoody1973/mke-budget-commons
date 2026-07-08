export type TableSchema = { table: string; purpose: string; columns: Record<string, string>; notes?: string };

/**
 * Curated schema for the SQL-writing model. Static (no DB round-trip) so it can
 * describe *semantics*, not just types. Never queries information_schema (which
 * guardSelect blocks). Column set verified against the live tool queries.
 */
export function describeSchema(): { tables: TableSchema[]; enums: Record<string, string[]> } {
  return {
    tables: [
      {
        table: "fact_budget_line",
        purpose: "The canonical ledger. One row per extracted budget line, across all three governments and all vintages. The main fact table.",
        columns: {
          line_id: "bigint PK — natural per-row id; the argument to the cite tool.",
          dept_id: "FK → dim_department.dept_id.",
          doc_id: "FK → dim_document.doc_id (provenance).",
          fiscal_year: "int — the fiscal year this row's amount belongs to.",
          amount_kind: "vintage of the amount (see enums.amount_kind).",
          line_kind: "row type (see enums.line_kind).",
          account: "reserved account code ('006000' salaries, '006100' fringe, '006300' operating, '006800' equipment) or NULL for grand-total/category rows.",
          line_description: "printed description / title / object / category name.",
          division: "sub-unit (city division / county strategic program area / MPS Sch-Dept).",
          amount: "numeric dollars (may be NULL for position/fte rows).",
          units: "FTE count (position/fte rows).",
          pay_range: "salary-grade code for position rows (e.g. 2TX).",
          flags: "text[] of footnote codes on a title.",
          fund: "fund letter (MPS = account segment 2; city/county fund).",
          source_page: "1-based page in source_doc (provenance).",
          search: "tsvector over line_description — use plainto_tsquery('english', …).",
        },
        notes: "City/county department grand totals are the row where line_kind='total' AND account IS NULL, OR (county) line_kind='category' AND line_description='Total Expenditures'. MPS has no printed per-unit total — SUM the line_kind='expenditure' rows.",
      },
      {
        table: "fact_school",
        purpose: "MPS per-school crosswalk: enrollment, school-controlled budget, FTE, and computed per-pupil.",
        columns: {
          school_name: "school name.",
          enrollment: "projected enrollment (denominator for per-pupil).",
          budget: "school-controlled budget dollars.",
          fte: "staffing FTE.",
          per_pupil: "budget ÷ enrollment (precomputed).",
          fiscal_year: "int fiscal year.",
          doc_id: "FK → dim_document (provenance).",
          source_page: "1-based page (provenance).",
        },
        notes: "School budgets exclude central/districtwide costs. Tiny specialty schools have small denominators — filter by enrollment for comprehensive-school comparisons.",
      },
      {
        table: "dim_department",
        purpose: "Department/school/office dimension.",
        columns: {
          dept_id: "PK (slug).",
          canonical_name: "display name.",
          gov_id: "government (see enums.gov_id).",
        },
      },
      {
        table: "dept_alias",
        purpose: "Alternate printed names for departments (for name resolution).",
        columns: { dept_id: "FK → dim_department.", printed_name: "an alias as printed in a document." },
      },
      {
        table: "dim_document",
        purpose: "Source-document dimension (provenance target).",
        columns: {
          doc_id: "PK.",
          source_url: "document URL.",
          fiscal_year: "int.",
          doc_type: "e.g. adopted / requested / operating / proposed.",
        },
      },
      {
        table: "dim_government",
        purpose: "Government dimension.",
        columns: { gov_id: "PK: 'city' | 'county' | 'mps'." },
      },
      {
        table: "reconciliation_result",
        purpose: "Trust report: how extracted totals reconcile to each document's printed totals, with dispositions.",
        columns: {
          doc_id: "FK → dim_document.",
          scope: "what was reconciled (department/section).",
          printed_total: "the document's own printed total.",
          extracted_total: "the sum of extracted line items.",
          status: "reconciled | source_inconsistency | open | not_reconcilable.",
          notes: "disposition narrative.",
        },
      },
    ],
    enums: {
      gov_id: ["city", "county", "mps"],
      amount_kind: ["actual", "budget", "adopted", "requested", "proposed", "recommended"],
      line_kind: ["total", "category", "program", "fte", "position", "expenditure", "revenue"],
      reserved_account: ["006000", "006100", "006300", "006800"],
    },
  };
}
