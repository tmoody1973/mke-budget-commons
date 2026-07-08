"""Wisconsin Policy Forum budget-brief parser (Layer 2 — CONTEXT, not fact).

A different species from every L1 fact parser: this reads the WPF briefs for
their *qualitative wisdom* — explanation, context, framing — and emits cited
prose CHUNKS for semantic retrieval. It is deliberately NOT reconciliation-grade
and never produces a budget number. The inviolable wall holds: WPF is a secondary
commentary corpus; every $/FTE/% the agent states still comes from a reconciled
budget tool. NO LLM reads anything here — this is deterministic pdfplumber text.

Verified against the real PDFs: the body prose extracts cleanly with pdfplumber
(no OCR); only decorative *letter-spaced* headings garble ("A bo ut th e W i sco
ns i n Po l i cy Fo rum") and the cover page is an image (0 chars). We keep the
clean body prose for retrieval and drop the garbled decorative titles.

Output: data/canonical/context/wpf/2026-2027/chunks.{csv,parquet}
        + docs/reconciliation-reports/wpf-briefs.md (a QA report, not a recon suite).
Provenance on every chunk: brief_id + page. Chunks are short — derived, attributed
context, never a reproduction of a whole brief.
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "canonical" / "context" / "wpf" / "2026-2027"
REPORT = ROOT / "docs" / "reconciliation-reports" / "wpf-briefs.md"

# Retrieval chunk sizing (words). Paragraph-aware packing within a single page so
# each chunk cites exactly one page.
MIN_WORDS = 40      # below this a "chunk" is almost certainly a footer/heading scrap
TARGET_WORDS = 300  # aim; flush once a chunk reaches this
MAX_WORDS = 400     # hard cap


@dataclass(frozen=True)
class Brief:
    file: str
    brief_id: str
    brief_title: str
    gov: str          # city | county | mps
    year: int
    source_url: str


# The 3 briefs (Layer 1 wisdom already distilled into prompts/base.md). Source
# PDFs are gitignored (copyrighted); only the derived, attributed chunks ship.
BRIEFS = [
    Brief("wi-policy-forum/2026CityBudgetBrief.pdf",
          "wpf-city-2026", "Wisconsin Policy Forum — 2026 Proposed City of Milwaukee Budget Brief",
          "city", 2026, "https://wisconsinpolicyforum.org/"),
    Brief("wi-policy-forum/BudgetBrief_2026MilwaukeeCounty.pdf",
          "wpf-county-2026", "Wisconsin Policy Forum — 2026 Milwaukee County Budget Brief",
          "county", 2026, "https://wisconsinpolicyforum.org/"),
    Brief("wi-policy-forum/BudgetBrief_2027MPSBudget-2.pdf",
          "wpf-mps-2027", "Wisconsin Policy Forum — 2026-27 Milwaukee Public Schools Budget Brief",
          "mps", 2027, "https://wisconsinpolicyforum.org/"),
]

# Lines to drop: footers, running headers ("2 City of Milwaukee Budget Brief |
# October 2025"), and table-of-contents entries (dot leaders). None carry wisdom.
_BOILERPLATE = re.compile(
    r"^(wisconsin policy forum|page \d+|\d+)$"      # footers / bare page numbers
    r"|budget brief\s*\|"                            # running header "... Budget Brief | Month Year"
    r"|\.{4,}",                                      # TOC dot-leaders
    re.I,
)

# Standard WPF "About" org boilerplate — identical across all three briefs, no
# budget wisdom. Drop any chunk carrying its signature.
_ABOUT_SIG = "by the merger of the milwaukee-based public policy forum"


def _is_garbled(line: str) -> bool:
    """A decorative letter-spaced title extracts as many 1–2 char fragments."""
    toks = line.split()
    if len(toks) < 4:
        return False
    short = sum(1 for t in toks if len(t) <= 2)
    return short / len(toks) > 0.5


_KEY_HEADING = re.compile(r"^(key #\d+\b|.*\bkeys? to (understanding|the)\b)", re.I)
_MONTH_YEAR = re.compile(
    r"^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}$",
    re.I,
)


def _is_heading(line: str) -> bool:
    """Short, punctuation-free, Title-Case / ALL-CAPS → a section label (metadata)."""
    s = line.strip()
    # The briefs' backbone: "N Keys to Understanding …" and "Key #N: …" titles.
    if _KEY_HEADING.match(s) and len(s.split()) <= 14 and not _is_garbled(s):
        return True
    if not s or len(s.split()) > 9 or _MONTH_YEAR.match(s):
        return False
    if s[-1] in ".:,;" or "," in s:   # commas ⇒ author credits / prose, not a section title
        return False
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return False
    caps = sum(1 for c in letters if c.isupper())
    # ALL CAPS, or Title Case (most words start uppercase), and not a garbled title.
    words = [w for w in re.split(r"\s+", s) if w[:1].isalpha()]
    titleish = words and sum(1 for w in words if w[0].isupper()) / len(words) >= 0.7
    return (caps / len(letters) > 0.8 or titleish) and not _is_garbled(s)


_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])")


def _pack(prose: str) -> list[str]:
    """Greedily pack sentences into MIN..MAX-word chunks."""
    sentences = [s.strip() for s in _SENT.split(prose) if s.strip()]
    chunks, cur, n = [], [], 0
    for sent in sentences:
        w = len(sent.split())
        if n and n + w > MAX_WORDS:
            chunks.append(" ".join(cur))
            cur, n = [], 0
        cur.append(sent)
        n += w
        if n >= TARGET_WORDS:
            chunks.append(" ".join(cur))
            cur, n = [], 0
    if cur:
        chunks.append(" ".join(cur))
    return [c for c in chunks if len(c.split()) >= MIN_WORDS]


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    brief_id: str
    brief_title: str
    gov: str
    year: int
    page: int
    section: str | None
    text: str
    source_url: str
    word_count: int


def parse_brief(brief: Brief) -> list[Chunk]:
    path = ROOT / brief.file
    if not path.exists():
        raise FileNotFoundError(f"{path} (WPF source PDFs are gitignored — place them in wi-policy-forum/)")
    out: list[Chunk] = []
    section: str | None = None
    with pdfplumber.open(path) as pdf:
        for pidx, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if not text.strip():
                continue
            body: list[str] = []
            for raw in text.split("\n"):
                s = raw.strip()
                if not s or _BOILERPLATE.search(s):
                    continue
                if _is_garbled(s):
                    continue  # decorative letter-spaced title
                if _is_heading(s):
                    section = s
                    continue
                body.append(s)
            prose = re.sub(r"\s+", " ", " ".join(body)).strip()
            if not prose:
                continue
            for seq, chunk_text in enumerate(_pack(prose)):
                if _ABOUT_SIG in chunk_text.lower():
                    continue  # WPF org boilerplate, not budget wisdom
                out.append(Chunk(
                    chunk_id=f"{brief.brief_id}-p{pidx}-{seq}",
                    brief_id=brief.brief_id,
                    brief_title=brief.brief_title,
                    gov=brief.gov,
                    year=brief.year,
                    page=pidx,
                    section=section,
                    text=chunk_text,
                    source_url=brief.source_url,
                    word_count=len(chunk_text.split()),
                ))
    return out


def build() -> pd.DataFrame:
    rows = [c for brief in BRIEFS for c in parse_brief(brief)]
    df = pd.DataFrame([c.__dict__ for c in rows])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_DIR / "chunks.csv", index=False)
    df.to_parquet(OUT_DIR / "chunks.parquet", index=False)
    # JSONL: what the TS embed-load (db/load-context.ts) reads — robust to the
    # commas/quotes in chunk text, no CSV parser needed in Node.
    df.to_json(OUT_DIR / "chunks.jsonl", orient="records", lines=True, force_ascii=False)
    _write_report(df)
    return df


def _write_report(df: pd.DataFrame) -> None:
    lines = [
        "# QA report — Wisconsin Policy Forum context corpus (Layer 2)",
        "",
        "Prose chunks for semantic retrieval — **not reconciliation-grade** (WPF is a",
        "secondary commentary corpus; no budget number originates here). Deterministic",
        "pdfplumber extraction, no LLM, no OCR. QA = page coverage + non-empty chunks.",
        "",
        f"**Total chunks:** {len(df)}  ·  **words:** min {df.word_count.min()} / "
        f"median {int(df.word_count.median())} / max {df.word_count.max()}",
        "",
        "| brief | gov | year | chunks | pages w/ chunks | word min/median/max |",
        "|---|---|---|---|---|---|",
    ]
    for bid, g in df.groupby("brief_id"):
        pages = sorted(g.page.unique())
        lines.append(
            f"| {bid} | {g.gov.iloc[0]} | {g.year.iloc[0]} | {len(g)} | "
            f"{len(pages)} (p{pages[0]}–{pages[-1]}) | "
            f"{g.word_count.min()}/{int(g.word_count.median())}/{g.word_count.max()} |"
        )
    lines += ["", "_All chunks carry `brief_id` + `page` provenance; retrieval labels them "
              "secondary WPF commentary to be attributed, never a fact source._", ""]
    REPORT.write_text("\n".join(lines))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--preview", type=int, default=0, help="print N sample chunks per brief")
    args = ap.parse_args()
    df = build()
    print(f"WPF context corpus: {len(df)} chunks → {OUT_DIR}")
    for bid, g in df.groupby("brief_id"):
        print(f"  {bid}: {len(g)} chunks over {g.page.nunique()} pages "
              f"(words {g.word_count.min()}–{g.word_count.max()})")
    print(f"  QA report → {REPORT.relative_to(ROOT)}")
    if args.preview:
        for bid, g in df.groupby("brief_id"):
            print(f"\n=== {bid} samples ===")
            for _, r in g.head(args.preview).iterrows():
                print(f"[p{r.page} · {r.section or '—'}] {r.text[:200]}…")


if __name__ == "__main__":
    main()
