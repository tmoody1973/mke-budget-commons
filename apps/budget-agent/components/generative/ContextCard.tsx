"use client";

import type { ExplainResult, ContextPassage } from "@mke/budget-tools";

// Short brief label from the id, e.g. "wpf-city-2026" → "City · 2026".
const GOV_LABEL: Record<string, string> = { city: "City", county: "County", mps: "MPS" };
function briefLabel(p: ContextPassage): string {
  const gov = p.gov ? GOV_LABEL[p.gov] ?? p.gov : "";
  return [gov, p.year].filter(Boolean).join(" · ");
}

// Keep the on-screen quote short + attributed (the model got the full passage;
// the card is a source snippet, not a reproduction of the brief).
function snippet(text: string, max = 300): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}

/** A WPF provenance chip — deliberately distinct from the budget CitationChip. */
function WpfChip({ p }: { p: ContextPassage }) {
  const label = `WPF · ${briefLabel(p)} · p.${p.page}`;
  const inner = (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-secondary-200 bg-secondary-50 px-1.5 py-0.5 text-[11px] font-medium text-secondary-700"
      data-wpf-citation
      title={p.brief_title}
    >
      <span aria-hidden>🏛️</span>
      {label}
    </span>
  );
  return p.source_url ? (
    <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
      {inner}
    </a>
  ) : (
    inner
  );
}

/**
 * Renders an `explain` result: Wisconsin Policy Forum commentary as short,
 * attributed quotes. SECONDARY source — framing to attribute, never figures.
 * The card carries no dollar amounts of its own by design.
 */
export function ContextCard({ data }: { data: ExplainResult }) {
  const passages = data?.passages ?? [];
  if (!passages.length) return null;

  return (
    <div
      className="my-2 w-full rounded-xl border border-secondary-200 bg-secondary-50/40 p-3 shadow-sm"
      data-testid="context-card"
    >
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Wisconsin Policy Forum — context</h3>
        <span className="rounded-full border border-secondary-200 bg-secondary-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-700">
          secondary commentary
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {passages.map((p, i) => (
          <li key={`${p.brief_id}-${p.page}-${i}`} className="border-l-2 border-secondary-300 pl-2.5">
            <p className="text-sm italic text-default-700">“{snippet(p.text)}”</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <WpfChip p={p} />
              {p.section && <span className="text-[11px] text-default-400">{p.section}</span>}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 text-[11px] text-default-500">
        Framing from independent WPF analysis — attributed, not a source of figures. Every dollar figure comes from the
        reconciled budget with its own page citation.
      </p>
    </div>
  );
}
