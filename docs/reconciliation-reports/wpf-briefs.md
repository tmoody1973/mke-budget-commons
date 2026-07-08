# QA report — Wisconsin Policy Forum context corpus (Layer 2)

Prose chunks for semantic retrieval — **not reconciliation-grade** (WPF is a
secondary commentary corpus; no budget number originates here). Deterministic
pdfplumber extraction, no LLM, no OCR. QA = page coverage + non-empty chunks.

**Total chunks:** 103  ·  **words:** min 46 / median 301 / max 358

| brief | gov | year | chunks | pages w/ chunks | word min/median/max |
|---|---|---|---|---|---|
| wpf-city-2026 | city | 2026 | 26 | 16 (p5–20) | 58/298/330 |
| wpf-county-2026 | county | 2026 | 36 | 20 (p5–24) | 47/304/358 |
| wpf-mps-2027 | mps | 2027 | 41 | 24 (p3–26) | 46/300/356 |

_All chunks carry `brief_id` + `page` provenance; retrieval labels them secondary WPF commentary to be attributed, never a fact source._
