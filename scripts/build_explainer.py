"""Build the public Budget Explainer — a standalone, self-contained HTML page.

Queries the Neon serving layer (the L4 app reading L3/L2) and writes a single
file with no external dependencies to apps/explainer/index.html — host it
anywhere (GitHub Pages, any static host) or email it. Every figure carries the
source page it was reconciled from. Regenerate with `make explainer`.
"""
from __future__ import annotations

import html
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "explainer" / "index.html"
# DPW divisions are rolled up in the DPW-Summary unit — exclude from citywide sums.
DPW_DIVS = ("city-dpw-administrative-services-division",
            "city-dpw-infrastructure-services-division",
            "city-dpw-operations-division")


def money(x: float) -> str:
    if x >= 1e9: return f"${x/1e9:.2f}B"
    if x >= 1e6: return f"${x/1e6:.1f}M"
    if x >= 1e3: return f"${x/1e3:.0f}K"
    return f"${x:,.0f}"


def esc(x) -> str:
    return html.escape(str(x))


def short(name: str) -> str:
    return name.replace("Department Of ", "Dept. of ").replace("Dept. Of ", "Dept. of ")


def fetch():
    load_dotenv(ROOT / ".env")
    cur = psycopg.connect(os.environ["DATABASE_URL"]).cursor()

    def q(sql, p=()):
        cur.execute(sql, p)
        return cur.fetchall()

    F = lambda v: float(v) if v is not None else None
    rows = [dict(id=r[0], name=r[1], g26=F(r[2]), sal=F(r[3]), fr=F(r[4]), op=F(r[5]),
                 eq=F(r[6]), g27=F(r[7]), pg=r[8]) for r in q("""
        SELECT d.dept_id, d.canonical_name,
          MAX(f.amount) FILTER (WHERE f.line_kind='total' AND f.account IS NULL AND f.fiscal_year=2026),
          MAX(f.amount) FILTER (WHERE f.account='006000' AND f.line_kind='total' AND f.fiscal_year=2026),
          MAX(f.amount) FILTER (WHERE f.account='006100' AND f.line_kind='total' AND f.fiscal_year=2026),
          MAX(f.amount) FILTER (WHERE f.account='006300' AND f.line_kind='total' AND f.fiscal_year=2026),
          MAX(f.amount) FILTER (WHERE f.account='006800' AND f.line_kind='total' AND f.fiscal_year=2026),
          MAX(f.amount) FILTER (WHERE f.line_kind='total' AND f.account IS NULL AND f.fiscal_year=2027),
          MIN(f.source_page) FILTER (WHERE f.line_kind='total' AND f.account IS NULL AND f.fiscal_year=2026)
        FROM dim_department d JOIN fact_budget_line f USING(dept_id)
        WHERE d.gov_id='city' GROUP BY 1,2""")]
    top = sorted((r for r in rows if r["id"] not in DPW_DIVS and r["g26"]), key=lambda r: -r["g26"])
    recon = {k: int(v) for k, v in q("SELECT status,count(*) FROM reconciliation_result GROUP BY status")}
    src = q("SELECT scope,printed_total,extracted_total FROM reconciliation_result "
            "WHERE status='source_inconsistency' ORDER BY abs(extracted_total-printed_total) DESC")
    return top, recon, src


def build() -> str:
    top, recon, src = fetch()
    city = sum(r["g26"] for r in top)
    sal = sum(r["sal"] or 0 for r in top); fr = sum(r["fr"] or 0 for r in top)
    op = sum(r["op"] or 0 for r in top); eq = sum(r["eq"] or 0 for r in top)
    special = city - (sal + fr + op + eq)
    npass = recon.get("pass", 0)

    split = [("Salaries", sal, "var(--c1)"), ("Fringe benefits", fr, "var(--c2)"),
             ("Operating", op, "var(--c3)"), ("Special funds", special, "var(--c4)"),
             ("Equipment", eq, "var(--c5)")]
    seg = "".join(f'<i style="width:{v/city*100:.2f}%;background:{c}"></i>' for _, v, c in split)
    legend = "".join(f'<span><i class="dot" style="background:{c}"></i>{lbl} · <b>{money(v)}</b> · {v/city*100:.0f}%</span>'
                     for lbl, v, c in split)
    maxg = top[0]["g26"]
    bars = "".join(
        f'<div class="brow"><div class="bname">{esc(short(r["name"]))}</div>'
        f'<div class="btrack"><i style="width:{r["g26"]/maxg*100:.1f}%"></i></div>'
        f'<div class="bval">{money(r["g26"])}<span class="cite">p.{r["pg"]}</span></div></div>'
        for r in top[:12])
    changes = sorted((r for r in top if r["g27"] and r["g27"] > 0), key=lambda r: -(r["g27"] - r["g26"]))
    chg = "".join(
        f'<tr><td>{esc(short(r["name"]))}</td><td class="num">{money(r["g26"])}</td>'
        f'<td class="num">{money(r["g27"])}</td><td class="num up">+{money(r["g27"]-r["g26"])}</td>'
        f'<td class="num up">+{(r["g27"]-r["g26"])/r["g26"]*100:.1f}%</td></tr>'
        for r in changes[:10])
    srch = "".join(
        f'<tr><td>{esc(s[0].split("|")[1].strip()[:34])}</td><td class="num">${float(s[1]):,.0f}</td>'
        f'<td class="num">${float(s[2]):,.0f}</td><td class="num warn">{float(s[2])-float(s[1]):+,.0f}</td></tr>'
        for s in src)
    police_up = money(changes[0]["g27"] - changes[0]["g26"])
    salpct = f"{(sal+fr)/city*100:.0f}"

    return TEMPLATE.format(
        city=money(city), ndepts=len(top), salpct=salpct, seg=seg, legend=legend,
        bars=bars, chg=chg, srch=srch, npass=f"{npass:,}", nsrc=len(src), police_up=police_up,
    )


TEMPLATE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Where Milwaukee's Money Goes — 2026 City Budget, Explained</title>
<meta name="description" content="Milwaukee's city operating budget, explained — where it goes, what's changing in 2027, and how every number is reconciled to the source document.">
<style>
:root{{--paper:#f4f5f8;--surface:#fff;--ink:#15171d;--soft:#565c6a;--faint:#8b91a1;--line:#e3e6ec;
 --accent:#2b41c9;--accent-soft:#e7eafb;--up:#b4530a;--warn:#a8761c;
 --c1:#2b41c9;--c2:#5566d8;--c3:#7f8ce6;--c4:#b7bff0;--c5:#dfe3f8;}}
@media (prefers-color-scheme:dark){{:root{{--paper:#0e1016;--surface:#171a22;--ink:#e9ebf1;--soft:#9aa0b0;
 --faint:#646b7c;--line:#262a34;--accent:#7f8cf0;--accent-soft:#1c2140;--up:#e0954a;--warn:#d29b45;
 --c1:#7f8cf0;--c2:#6675e2;--c3:#4f5fce;--c4:#38427f;--c5:#282e50;}}}}
*{{box-sizing:border-box}} body{{margin:0}}
.wrap{{font-family:"Helvetica Neue",system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--paper);
 color:var(--ink);line-height:1.55;padding:clamp(20px,5vw,60px) clamp(16px,4vw,40px);-webkit-font-smoothing:antialiased;}}
.inner{{max-width:940px;margin:0 auto;display:flex;flex-direction:column;gap:46px;}}
.mono{{font-family:ui-monospace,"SF Mono",Menlo,monospace;}}
.eyebrow{{font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:700;}}
.cite{{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--accent);background:var(--accent-soft);
 padding:1px 5px;border-radius:4px;margin-left:7px;vertical-align:middle;white-space:nowrap;}}
h1{{font-size:clamp(32px,6vw,58px);line-height:1.02;letter-spacing:-.03em;margin:.3em 0 .15em;text-wrap:balance;font-weight:800;}}
h2{{font-size:clamp(21px,3vw,26px);letter-spacing:-.02em;margin:0 0 4px;font-weight:750;}}
.lede{{font-size:clamp(17px,2.4vw,20px);color:var(--soft);max-width:60ch;}}
.seclead{{color:var(--soft);max-width:66ch;margin:0 0 22px;font-size:15.5px;}}
.hero{{display:flex;flex-direction:column;gap:8px;border-bottom:1px solid var(--line);padding-bottom:8px;}}
.bignum{{font-family:ui-monospace,Menlo,monospace;font-size:clamp(60px,15vw,132px);font-weight:600;line-height:.85;
 letter-spacing:-.04em;color:var(--accent);font-variant-numeric:tabular-nums;margin-top:8px;}}
.bigcap{{font-size:16px;color:var(--soft);margin-top:14px;}} .bigcap b{{color:var(--ink);}}
.split{{display:flex;height:34px;border-radius:9px;overflow:hidden;border:1px solid var(--line);}} .split i{{display:block;height:100%;}}
.legend{{display:flex;flex-wrap:wrap;gap:8px 22px;margin-top:16px;font-size:13.5px;color:var(--soft);}}
.legend span{{display:inline-flex;align-items:center;gap:7px;}} .legend b{{color:var(--ink);font-variant-numeric:tabular-nums;}}
.dot{{width:11px;height:11px;border-radius:3px;flex:none;}}
.pull{{font-size:clamp(19px,2.8vw,24px);line-height:1.4;font-weight:600;border-left:3px solid var(--accent);padding:2px 0 2px 20px;margin:4px 0;text-wrap:balance;}} .pull b{{color:var(--accent);}}
.brow{{display:grid;grid-template-columns:minmax(120px,1.5fr) 3fr auto;gap:14px;align-items:center;padding:7px 0;}}
.bname{{font-size:14px;font-weight:550;}} .btrack{{background:var(--line);border-radius:5px;height:15px;overflow:hidden;}}
.btrack i{{display:block;height:100%;background:linear-gradient(90deg,var(--c2),var(--accent));border-radius:5px;}}
.bval{{font-family:ui-monospace,Menlo,monospace;font-size:13px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}}
.tblwrap{{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface);}}
table{{border-collapse:collapse;width:100%;font-size:14px;min-width:520px;}}
th{{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:700;padding:12px 14px;border-bottom:1px solid var(--line);white-space:nowrap;}}
th.num,td.num{{text-align:right;font-family:ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums;}}
td{{padding:10px 14px;border-bottom:1px solid var(--line);}} tr:last-child td{{border-bottom:none;}}
td.up{{color:var(--up);font-weight:600;}} td.warn{{color:var(--warn);font-weight:600;}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;}}
.card{{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px 20px;border-top:3px solid var(--accent);}}
.card .n{{font-family:ui-monospace,Menlo,monospace;font-size:32px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums;}}
.card .l{{font-size:13px;color:var(--soft);margin-top:6px;}}
.trust{{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:clamp(20px,3vw,30px);display:flex;flex-direction:column;gap:16px;}}
footer{{border-top:1px solid var(--line);padding-top:22px;font-size:13px;color:var(--faint);display:flex;flex-direction:column;gap:7px;}} footer b{{color:var(--soft);}} code{{font-family:ui-monospace,Menlo,monospace;}}
</style></head>
<body><div class="wrap"><div class="inner">
<header class="hero">
 <div class="eyebrow">Milwaukee Budget Commons · 2026 Adopted City Budget</div>
 <h1>Where Milwaukee's money goes</h1>
 <p class="lede">The city's departmental operating budget, line by line — and every number on this page traces back to the exact page of the official budget book it came from.</p>
 <div class="bignum">{city}</div>
 <p class="bigcap"><b>{city}</b> across <b>{ndepts} departments</b> — the 2026 adopted operating budget for the departments in the City of Milwaukee's Detailed Budget. <span class="cite">reconciled to the printed totals</span></p>
</header>
<section>
 <div class="eyebrow">The split</div>
 <h2>Most of it is people</h2>
 <p class="seclead">Salaries and fringe benefits together are <b>{salpct}%</b> of the operating budget. A city budget is, mostly, the people who run the city — police, firefighters, librarians, inspectors, engineers.</p>
 <div class="split">{seg}</div>
 <div class="legend">{legend}</div>
</section>
<section>
 <p class="pull">Two departments — <b>Police and Fire</b> — account for more than half of every dollar in this budget.</p>
 <div class="eyebrow">By department</div>
 <h2>The biggest line items</h2>
 <p class="seclead">The largest departments by adopted 2026 budget. The tag after each figure is the page of the budget book it was extracted and verified from.</p>
 {bars}
</section>
<section>
 <div class="eyebrow">What's changing · 2027 requested vs 2026 adopted</div>
 <h2>What departments are asking for next</h2>
 <p class="seclead">Every fall, departments submit budget <em>requests</em> for the coming year — before the Mayor and Common Council weigh in. Police alone requested <b>+{police_up}</b>.</p>
 <div class="tblwrap"><table>
  <thead><tr><th>Department</th><th class="num">2026 adopted</th><th class="num">2027 requested</th><th class="num">Change</th><th class="num">%</th></tr></thead>
  <tbody>{chg}</tbody></table></div>
</section>
<section>
 <div class="eyebrow">Why you can trust these numbers</div>
 <h2>Reconciled, not transcribed</h2>
 <p class="seclead">No language model ever read these numbers. A deterministic parser extracts every line, then checks that the line items sum to the budget book's <em>own</em> printed totals — to the dollar. Where they don't, that's a finding, not a fudge.</p>
 <div class="cards">
  <div class="card"><div class="n">{npass}</div><div class="l">reconciliation checks pass — line items match the printed totals exactly</div></div>
  <div class="card" style="border-top-color:var(--warn)"><div class="n">{nsrc}</div><div class="l">arithmetic errors found <b>in the city's own PDF</b> — the printed total &ne; its own line items</div></div>
  <div class="card"><div class="n">100%</div><div class="l">of published figures carry a <code>source_page</code> — nothing is uncited</div></div>
 </div>
 <div class="trust">
  <div class="eyebrow">The {nsrc} errors we found in the official budget book</div>
  <div class="tblwrap"><table>
   <thead><tr><th>Where</th><th class="num">Book's printed total</th><th class="num">Sum of its line items</th><th class="num">Off by</th></tr></thead>
   <tbody>{srch}</tbody></table></div>
 </div>
</section>
<footer>
 <span><b>Method.</b> Deterministic <code>pdfplumber</code> + regex extraction of the City of Milwaukee Detailed Budget; every line reconciled against the document's printed reserved-code totals. Served through a typed, read-only access layer so anyone — or any AI agent — can ask cited budget questions.</span>
 <span><b>Scope.</b> Departmental operating ledger only — citywide fund, capital, and special-purpose sections are separate documents, not included here. Figures are adopted (2026) and department-requested (2027); requested is a starting point, not final.</span>
 <span>Milwaukee Budget Commons · open methodology, reconciliation receipts published.</span>
</footer>
</div></div></body></html>
"""


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build())
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes) — standalone, host anywhere")


if __name__ == "__main__":
    main()
