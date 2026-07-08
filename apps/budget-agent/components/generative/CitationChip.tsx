"use client";

import type { CitationRef } from "@mke/budget-tools";

/** A small "p.N · doc" provenance chip. Every figure the copilot shows carries one. */
export function CitationChip({ doc_id, source_page }: CitationRef) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-default-200 bg-default-100 px-1.5 py-0.5 text-[11px] font-medium text-default-600"
      title={doc_id}
      data-citation
    >
      <span aria-hidden>📄</span>
      p.{source_page}
    </span>
  );
}

export function CitationRow({ citations }: { citations: CitationRef[] }) {
  if (!citations?.length) return null;
  // De-dupe by doc+page, cap the visible set.
  const seen = new Set<string>();
  const unique = citations.filter((c) => {
    const k = `${c.doc_id}:${c.source_page}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const shown = unique.slice(0, 8);
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
