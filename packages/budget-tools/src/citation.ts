export type Citation = { doc_id: string; source_page: number };

/** distinct {doc_id, source_page} across result rows */
export function citations(rows: any[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const r of rows) {
    if (r.doc_id == null || r.source_page == null) continue;
    const k = `${r.doc_id}:${r.source_page}`;
    if (!seen.has(k)) { seen.add(k); out.push({ doc_id: r.doc_id, source_page: r.source_page }); }
  }
  return out.slice(0, 25);
}

export const num = (v: any): number | null => (v == null ? null : Number(v));
