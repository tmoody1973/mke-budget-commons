# Plan — WPF Context Corpus (Layer 2): cited semantic retrieval of Wisconsin Policy Forum wisdom

Expands `docs/superpowers/specs/2026-07-08-wpf-context-corpus.md` into build tasks.

**Locked decisions (this session):**
- **Embedding = local transformers.js, no API key.** `@huggingface/transformers` (v3), model `Xenova/bge-small-en-v1.5` (384-dim). One shared `embedText(text, kind)` in `@mke/budget-tools` is used at BOTH index time and query time, so vectors always match. bge query prefix (`"Represent this sentence for searching relevant passages: "`) applied to `kind:'query'` only.
- **Store in Neon `pgvector`** (0.8.0 available, not yet installed → `CREATE EXTENSION vector`). 384-dim `vector`, HNSW cosine index.
- **`context_chunk` is a separate corpus**, owned entirely by a TS load step — the Python `db/load.py` fact rebuild never touches it (clean facts=Python / context=TS split).
- **No OCR.** WPF body prose extracts cleanly with pdfplumber; only decorative letter-spaced headings are garbled (metadata only) → light de-space heuristic.
- **Parity:** expose `explain` over both the MCP server and the app.

**The inviolable rule, unchanged:** WPF supplies *wisdom/framing only, always attributed*. Every `$`/FTE/`%` still comes from a reconciled budget tool and is cited to a budget page. No canonical number ever originates from WPF. `context_chunk` is prose, `source='wpf'`, never reconciled.

---

## Task 1 — L1 parser `parsers/wpf_briefs.py` (deterministic, no LLM)

**Files:** create `parsers/wpf_briefs.py`; output `data/canonical/context/wpf/2026-2027/chunks.{csv,parquet}` + `docs/reconciliation-reports/wpf-briefs.md` (QA, not reconciliation).

**Briefs (provenance identity):**
| file | brief_id | gov | year |
|---|---|---|---|
| `wi-policy-forum/2026CityBudgetBrief.pdf` | `wpf-city-2026` | city | 2026 |
| `wi-policy-forum/BudgetBrief_2026MilwaukeeCounty.pdf` | `wpf-county-2026` | county | 2026 |
| `wi-policy-forum/BudgetBrief_2027MPSBudget-2.pdf` | `wpf-mps-2027` | mps | 2027 |

**Steps:**
1. pdfplumber per-page `extract_text()`. Skip empty/near-empty pages (cover = 0 chars).
2. Light heading de-space: collapse runs of single-char tokens (`A bo ut` → `About`) for the *section label* only; body prose is left as-is (already clean).
3. Detect section headings (short lines, Title Case / ALL CAPS, the "N Keys to Understanding" structure) → carry as `section` metadata for following paragraphs.
4. Chunk body prose into ~150–400-word chunks, paragraph-aware, never splitting mid-sentence; each chunk keeps `brief_id, brief_title, gov, year, page, section, text`. `chunk_id = f"{brief_id}-p{page}-{seq}"`.
5. Emit CSV + Parquet (columns above) + a QA report: per-brief chunk count, page coverage (which pages produced chunks), min/median/max chunk word count. Assert: every brief produced chunks on the majority of its text pages, no empty `text`.
6. `brief_title` + `source_url`: hardcode the WPF brief titles; `source_url` = the WPF publication page (from `data/raw/sources.yml` if present, else the WPF site). Keep quotes short — this is derived, attributed context, not the whole brief.

**Verify:** `python -m parsers.wpf_briefs` prints the QA report; eyeball a few chunks per brief for clean prose. Commit the canonical CSV/Parquet + report. (Source PDFs stay gitignored.)

---

## Task 2 — L2 schema + TS embed-load (`db/load-context.ts`)

**Files:** add `context_chunk` DDL to `db/schema.sql` (documentation of record) **and** create `db/load-context.ts` that owns the table end-to-end; add `make load-context` + a `load-context` npm script.

**Schema (`context_chunk`):**
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS context_chunk (
  chunk_id    TEXT PRIMARY KEY,
  source      TEXT NOT NULL DEFAULT 'wpf',
  brief_id    TEXT NOT NULL,
  brief_title TEXT NOT NULL,
  gov         TEXT,            -- city|county|mps
  year        INT,
  page        INT NOT NULL,    -- provenance (WPF brief page)
  section     TEXT,
  text        TEXT NOT NULL,
  source_url  TEXT,
  embedding   vector(384),
  search      TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX IF NOT EXISTS idx_ctx_embed ON context_chunk USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_ctx_search ON context_chunk USING GIN (search);
```
`db/load.py` DATA_TABLES is **unchanged** — it must NOT drop `context_chunk`. The TS step is the sole owner.

**`db/load-context.ts` (Node, owner `DATABASE_URL`):** read chunks CSV/Parquet → `CREATE EXTENSION` + `CREATE TABLE IF NOT EXISTS` → `TRUNCATE context_chunk` → for each chunk `embedText(text,'passage')` → batch `INSERT` (embedding as pgvector literal) → `GRANT SELECT ON context_chunk TO mcp_ro`. Idempotent, rebuildable. Reads CSV (no parquet-in-node dep). Uses the shared `embedText` from `@mke/budget-tools` (Task 3) so index vectors == query vectors.

**Verify:** run it; `SELECT count(*), count(embedding) FROM context_chunk` = full corpus, all embedded. Re-run → same counts (idempotent).

---

## Task 3 — L3 `explain` in `@mke/budget-tools` (+ shared `embedText`) + MCP

**Files:** create `packages/budget-tools/src/embed.ts`, `packages/budget-tools/src/queries/context.ts`; extend `schemas.ts`, `types.ts`, `index.ts`; register `explain` in `mcp/src/index.ts`; a unit test.

- `embed.ts`: cached singleton `feature-extraction` pipeline (`Xenova/bge-small-en-v1.5`); `embedText(text, kind: 'query'|'passage'): Promise<number[]>` — prepend the bge query instruction for `'query'`, `{ pooling:'mean', normalize:true }`, return 384 floats. Model download happens once, cached.
- `queries/context.ts`: `explain({ question, gov?, k=4 })` → `embedText(question,'query')` → read-only pgvector top-k:
  `SELECT chunk_id, brief_id, brief_title, gov, year, page, section, text, source_url, 1-(embedding <=> $1::vector) AS score FROM context_chunk WHERE ($2::text IS NULL OR gov=$2) ORDER BY embedding <=> $1::vector LIMIT $3`
  → return `{ passages: [{ text, brief_id, brief_title, gov, year, page, source_url, score }], note: "Wisconsin Policy Forum commentary — secondary source; figures must still come from budget tools." }`. Read-only via existing `query()` (MCP_DATABASE_URL).
- `explainShape` (Zod) + `ExplainResult`/`ContextPassage` types. Export from `index.ts`.
- MCP: register `explain` (thin) with the shared description.
- **Unit test:** a known question (e.g. "why is the city facing a structural deficit?") returns ≥1 passage from `wpf-city-2026` with `page` + non-empty `text`; every passage carries brief+page provenance.

**Verify:** `npm run -w @mke/budget-tools test` green; `make mcp-test` still green (contract intact).

---

## Task 4 — L4 app wiring: `explain` tool + ContextCard + prompt

**Files:** add `explain` defineTool to `apps/budget-agent/lib/tools/server-tools.ts` (wrapped in `safe()`); create `apps/budget-agent/components/generative/ContextCard.tsx`; register in `components/copilot/tool-renderers.tsx`; tighten `apps/budget-agent/prompts/base.md` + `journalist.md`.

- `ContextCard`: renders the WPF passages as short attributed quotes, each with a **WPF brief·page chip** (distinct from the budget CitationChip — labeled "Wisconsin Policy Forum") + a link to `source_url`. A visible "secondary commentary" label. `data-testid="context-card"`, `data-wpf-citation` on each chip.
- Renderer: `useRenderTool({ name:'explain' })` → parse result → `ContextCard`; error/empty → friendly note (reuse `ToolError`/chip). Add `explain` to `TOOL_LABELS`.
- Prompt: instruct the agent to call `explain` for "why / what does this mean / explain / give me context" questions; **reaffirm the strict rule** — WPF passages are framing to attribute ("the Wisconsin Policy Forum's 2026 City Budget Brief (p.N) frames this as…"), never a source of figures; if WPF and a tool differ on a number, the tool wins.

**Verify:** production build green (TS gate); dev server — ask "explain like I'm 12 why the city budget is tight" → a ContextCard renders WPF framing (attributed + linked) while any dollar figures come from budget tools with their own citations.

---

## Task 5 — Verify + finish

- Live end-to-end (Playwright MCP or manual): a why/explain question yields attributed WPF context AND tool-cited numbers; a pure-number question still uses only budget tools (no fabricated WPF figure).
- Extend the E2E if cheap: assert a `context-card` carries a WPF citation and that no `$` figure appears inside the context card (WPF ≠ numbers).
- Update `README.md` / `CLAUDE.md` with the new layer + `make load-context` in the rebuild order (facts: `make load-neon`, then context: `make load-context`).
- Whole-branch review → PR.

## Rebuild order (document it)
```
make parse-* && make reconcile   # facts (Python)
make load-neon                   # facts → Neon (Python; drops+rebuilds fact tables)
python -m parsers.wpf_briefs     # WPF chunks (Python, no LLM)
make load-context                # WPF chunks → Neon pgvector (TS, embeds)
```
`load-neon` never drops `context_chunk`; `load-context` is independently re-runnable.
