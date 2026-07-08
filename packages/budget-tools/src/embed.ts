// Local text embeddings (transformers.js) — the ONE embedding path, used at BOTH
// index time (db/load-context.ts) and query time (queries/context.ts) so the
// vectors always match. No API key, no cloud dependency. Server-only (like pg):
// never import this from client code.
//
// Model: BAAI bge-small-en-v1.5 (ONNX, 384-dim). bge retrieval wants an
// instruction prefix on the QUERY only; passages are embedded bare.
//
// transformers.js (+ the onnxruntime-node native addon) is imported LAZILY, inside
// getExtractor() — so merely importing this module (e.g. via the @mke/budget-tools
// barrel) does NOT load the native stack. It loads only when we actually embed.
// This keeps the heavy/native dependency dormant wherever `explain` isn't used
// (e.g. a serverless deploy with WPF retrieval feature-flagged off).
const MODEL = "Xenova/bge-small-en-v1.5";
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

/** Vector width — must match `vector(384)` in the context_chunk schema. */
export const EMBED_DIM = 384;

// Lazily built once, then reused (the model download + init is the expensive part).
let _extractor: Promise<unknown> | null = null;
function getExtractor(): Promise<unknown> {
  if (!_extractor) {
    _extractor = import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", MODEL),
    );
  }
  return _extractor;
}

/**
 * Embed a single string. `kind` distinguishes a search query (gets the bge
 * instruction prefix) from a stored passage (embedded bare). Mean-pooled +
 * L2-normalized → cosine similarity is a dot product.
 */
export async function embedText(text: string, kind: "query" | "passage"): Promise<number[]> {
  const input = kind === "query" ? QUERY_PREFIX + text : text;
  const extractor = (await getExtractor()) as (
    t: string,
    opts: { pooling: "mean"; normalize: boolean },
  ) => Promise<{ data: Float32Array }>;
  const output = await extractor(input, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/** Format a vector as a pgvector literal, e.g. "[0.12,-0.03,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
