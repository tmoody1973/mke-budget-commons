// Text embeddings via the OpenAI API — the ONE embedding path, used at BOTH index
// time (db/load-context.ts) and query time (queries/context.ts) so the stored and
// queried vectors always live in the same space. Server-only (like pg): never
// import this from client code.
//
// Model: text-embedding-3-small, pinned to 512 dims via the `dimensions` param
// (the model is natively 1536-dim and supports Matryoshka truncation, so 512 keeps
// the pgvector column small at negligible retrieval cost).
//
// WHY THIS IS AN HTTP CALL AND NOT A LOCAL MODEL: this used to run
// bge-small-en-v1.5 locally through transformers.js + the onnxruntime-node NATIVE
// addon. That addon cannot run inside a Vercel serverless function, which is why
// WPF retrieval was feature-flagged off in production — and the model, still told
// by its prompt to call `explain`, hung the whole conversation. An HTTP call has no
// native dependency, so `explain` now works in every deployment.
//
// The reconciliation wall is unchanged: embeddings exist only in the TS serving
// layer over a prose corpus. No LLM and no embedding ever touches a budget number.
const MODEL = "text-embedding-3-small";
const ENDPOINT = "https://api.openai.com/v1/embeddings";

/** Vector width — must match `vector(512)` in the context_chunk schema. */
export const EMBED_DIM = 512;

/**
 * Embed a single string.
 *
 * `kind` is retained in the signature because the index/query distinction is part
 * of this module's contract (bge needed an instruction prefix on queries, and a
 * future provider may too). text-embedding-3-small embeds queries and passages in
 * the same space with no prefix, so today it does not branch.
 */
export async function embedText(text: string, kind: "query" | "passage"): Promise<number[]> {
  void kind;

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set — it is required to embed the WPF context corpus (both at load time and at query time).",
    );
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, input: text, dimensions: EMBED_DIM }),
  });

  if (!res.ok) {
    // Surface status + a short body slice; never echo the key.
    const detail = await res.text().catch(() => "");
    throw new Error(`Embedding request failed (${res.status} ${res.statusText}): ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { data?: { embedding?: number[] }[] };
  const vec = json.data?.[0]?.embedding;

  // A wrong-width vector must never reach pgvector: it would either error on insert
  // or, worse, silently retrieve nonsense. Fail loudly instead.
  if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
    throw new Error(
      `Embedding response malformed: expected ${EMBED_DIM} dimensions, got ${Array.isArray(vec) ? vec.length : "none"}.`,
    );
  }
  return vec;
}

/** Format a vector as a pgvector literal, e.g. "[0.12,-0.03,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
