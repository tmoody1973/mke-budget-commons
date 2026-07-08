import { query } from "./db";

/** How a citation's number should be read: a PDF page, or a spreadsheet row. */
export type Locator = "page" | "row";

export type Citation = { doc_id: string; source_page: number; locator: Locator };

// Which documents are spreadsheets (provenance = sheet row, not page). Derived
// from the source doc's URL ending in .xlsx — no hardcoded doc list. Cached for
// the process lifetime (the set only changes on a pipeline reload).
let _xlsxDocs: Promise<Set<string>> | null = null;
function spreadsheetDocs(): Promise<Set<string>> {
  if (!_xlsxDocs) {
    _xlsxDocs = query<{ doc_id: string }>(
      "SELECT doc_id FROM dim_document WHERE source_url ILIKE '%.xlsx'",
    ).then((rows) => new Set(rows.map((r) => r.doc_id)));
  }
  return _xlsxDocs;
}

/**
 * Distinct {doc_id, source_page} across result rows, each tagged with how its
 * number reads: `page` for PDF-sourced docs, `row` for spreadsheet-sourced docs
 * (MPS's .xlsx ledger stores the 1-based sheet row in source_page — it has no
 * pages). The UI must label these differently ("p.24" vs "row 24").
 */
export async function citations(rows: any[]): Promise<Citation[]> {
  const xlsx = await spreadsheetDocs();
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const r of rows) {
    if (r.doc_id == null || r.source_page == null) continue;
    const k = `${r.doc_id}:${r.source_page}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({
        doc_id: r.doc_id,
        source_page: r.source_page,
        locator: xlsx.has(r.doc_id) ? "row" : "page",
      });
    }
  }
  return out.slice(0, 25);
}

export const num = (v: any): number | null => (v == null ? null : Number(v));
