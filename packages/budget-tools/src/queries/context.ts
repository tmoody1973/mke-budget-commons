import { query } from "../db";
import { embedText, toVectorLiteral } from "../embed";
import { type Gov } from "../helpers";
import type { ContextPassage, ExplainResult } from "../types";

// The standing label on every result: WPF is qualitative, secondary, and must be
// attributed — it is NEVER a source of figures. Reaffirmed here so the model
// carries it even if the prompt drifts.
const NOTE =
  "Wisconsin Policy Forum commentary — a secondary, qualitative source. " +
  "Attribute it (brief + page); every dollar, FTE, or percentage must still come " +
  "from a reconciled budget tool, not from these passages.";

/**
 * Semantic retrieval over the WPF context corpus. Embeds the question with the
 * SAME model used at load time, then read-only pgvector cosine top-k (optionally
 * filtered by government). Returns cited passages — wisdom/framing to attribute,
 * never numbers.
 */
export async function explain(a: { question: string; gov?: Gov; k?: number }): Promise<ExplainResult> {
  const k = a.k ?? 4;
  const vec = toVectorLiteral(await embedText(a.question, "query"));
  const params: unknown[] = [vec];
  let govPred = "";
  if (a.gov) {
    params.push(a.gov);
    govPred = `WHERE gov = $${params.length}`;
  }
  params.push(k);
  const rows = await query(
    `SELECT brief_id, brief_title, gov, year, page, section, text, source_url,
            1 - (embedding <=> $1::vector) AS score
       FROM context_chunk
       ${govPred}
      ORDER BY embedding <=> $1::vector
      LIMIT $${params.length}`,
    params,
  );
  return {
    question: a.question,
    passages: rows.map(
      (r): ContextPassage => ({
        text: r.text,
        brief_id: r.brief_id,
        brief_title: r.brief_title,
        gov: r.gov,
        year: r.year == null ? null : Number(r.year),
        page: Number(r.page),
        section: r.section,
        source_url: r.source_url,
        score: Math.round(Number(r.score) * 1000) / 1000,
      }),
    ),
    note: NOTE,
  };
}
