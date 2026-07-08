"use client";

import type { CitationRef } from "@mke/budget-tools";

/**
 * A small provenance chip. Every figure the copilot shows carries one. The label
 * reflects how the source records location: PDF-sourced docs cite a **page**
 * ("📄 p.24"); spreadsheet-sourced docs (MPS's .xlsx ledger) cite a **row**
 * ("🔢 row 24") — it has no pages, so "p." would be wrong.
 */
export function CitationChip({ doc_id, source_page, locator }: CitationRef) {
  const isRow = locator === "row";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-default-200 bg-default-100 px-1.5 py-0.5 text-[11px] font-medium text-default-600"
      title={isRow ? `${doc_id} · spreadsheet row ${source_page}` : `${doc_id} · page ${source_page}`}
      data-citation
      data-locator={isRow ? "row" : "page"}
    >
      <span aria-hidden>{isRow ? "🔢" : "📄"}</span>
      {isRow ? `row ${source_page}` : `p.${source_page}`}
    </span>
  );
}

export function CitationRow({ citations, max = 8 }: { citations: CitationRef[]; max?: number }) {
  if (!citations?.length) return null;
  // De-dupe by doc+page, cap the visible set.
  const seen = new Set<string>();
  const unique = citations.filter((c) => {
    const k = `${c.doc_id}:${c.source_page}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const shown = unique.slice(0, max);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-default-400">Source:</span>
      {shown.map((c) => (
        <CitationChip key={`${c.doc_id}:${c.source_page}`} {...c} />
      ))}
      {unique.length > shown.length && (
        <span className="text-[11px] text-default-400">+{unique.length - shown.length} more</span>
      )}
    </div>
  );
}
