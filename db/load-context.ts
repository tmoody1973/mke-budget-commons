// Load the Layer-2 CONTEXT corpus (Wisconsin Policy Forum chunks) into Neon
// pgvector. Owns `context_chunk` end-to-end — the Python fact loader (db/load.py)
// never touches it, so facts=Python / context=TS stay cleanly separate.
//
// Idempotent + rebuildable: CREATE EXTENSION + CREATE TABLE IF NOT EXISTS →
// TRUNCATE → embed every chunk with the SHARED embedText (identical to the
// query path) → INSERT → GRANT SELECT to the read-only MCP role.
//
// Run: `make load-context` (needs owner DATABASE_URL + the chunks JSONL from
// `python -m parsers.wpf_briefs`). No LLM touches any budget number — this is a
// secondary prose corpus.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import dotenv from "dotenv";
import { embedText, toVectorLiteral, EMBED_DIM } from "@mke/budget-tools/embed";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
dotenv.config({ path: resolve(ROOT, ".env") });

const CHUNKS = resolve(ROOT, "data/canonical/context/wpf/2026-2027/chunks.jsonl");
const RO_ROLE = "mcp_ro"; // must match db/load.py's read-only role

type Chunk = {
  chunk_id: string;
  brief_id: string;
  brief_title: string;
  gov: string | null;
  year: number | null;
  page: number;
  section: string | null;
  text: string;
  source_url: string | null;
};

const DDL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS context_chunk (
  chunk_id    TEXT PRIMARY KEY,
  source      TEXT NOT NULL DEFAULT 'wpf',
  brief_id    TEXT NOT NULL,
  brief_title TEXT NOT NULL,
  gov         TEXT,
  year        INT,
  page        INT NOT NULL,
  section     TEXT,
  text        TEXT NOT NULL,
  source_url  TEXT,
  embedding   vector(${EMBED_DIM}),
  search      TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX IF NOT EXISTS idx_ctx_embed  ON context_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_ctx_search ON context_chunk USING GIN (search);
`;

function readChunks(): Chunk[] {
  const raw = readFileSync(CHUNKS, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Chunk);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set (owner role; see .env)");

  const chunks = readChunks();
  if (!chunks.length) throw new Error(`no chunks in ${CHUNKS} — run \`python -m parsers.wpf_briefs\` first`);

  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const client = await pool.connect();
  try {
    await client.query(DDL);
    await client.query("TRUNCATE context_chunk");

    let n = 0;
    for (const c of chunks) {
      const vec = toVectorLiteral(await embedText(c.text, "passage"));
      await client.query(
        `INSERT INTO context_chunk
           (chunk_id, source, brief_id, brief_title, gov, year, page, section, text, source_url, embedding)
         VALUES ($1,'wpf',$2,$3,$4,$5,$6,$7,$8,$9,$10::vector)`,
        [c.chunk_id, c.brief_id, c.brief_title, c.gov, c.year, c.page, c.section, c.text, c.source_url, vec],
      );
      if (++n % 25 === 0) process.stdout.write(`  embedded ${n}/${chunks.length}\r`);
    }

    // The read-only MCP role must be able to read the new table (default
    // privileges cover future tables, but grant explicitly to be safe).
    await client.query(`GRANT SELECT ON context_chunk TO ${RO_ROLE}`).catch(() => {
      /* role may not exist yet if load-neon hasn't run — that's fine */
    });

    const { rows } = await client.query<{ total: string; embedded: string }>(
      "SELECT count(*) AS total, count(embedding) AS embedded FROM context_chunk",
    );
    console.log(
      `\ncontext_chunk loaded: ${rows[0].total} chunks, ${rows[0].embedded} embedded ` +
        `(${EMBED_DIM}-dim) from ${chunks.length} source chunks.`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
