"use client";

import { useState } from "react";
import { CircleInfo } from "@gravity-ui/icons";
import { Modal } from "./Modal";

const REPO = "https://github.com/tmoody1973/mke-budget-commons";
const BETANYC = "https://github.com/BetaNYC/New-York-City-Budget";

// One step of the "how the numbers get here" pipeline.
const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "1",
    title: "Start from the official documents",
    body: "We begin with the governments' own published budget books — the City of Milwaukee's detailed budget and the County's operating budget as PDFs, and Milwaukee Public Schools' budget as a spreadsheet. Each source is recorded with its URL, the date we downloaded it, and a fingerprint (a checksum) so anyone can confirm we used the real thing.",
  },
  {
    n: "2",
    title: "Extract every number by machine, not by eye",
    body: "A deterministic program reads the numbers directly from the document — pdfplumber follows the exact column positions on the page, and plain rules pull out the account codes and dollar amounts (for MPS, we read the spreadsheet rows). No AI, no human retyping. The same document always produces the exact same result.",
  },
  {
    n: "3",
    title: "Reconcile against the document's own totals",
    body: "This is the heart of it. Every section we extract has to add up to the total the document itself prints — exactly. If our line items don't match the printed total, that's a finding, not something we quietly fix. Usually it means an arithmetic error inside the official PDF. We flag it, note it, and surface it — never hide it.",
  },
  {
    n: "4",
    title: "Keep the receipts (provenance)",
    body: "Every single number carries where it came from: the source document and the page it's printed on (or, for the MPS spreadsheet, the exact row). Nothing ships without a citation. That's what lets you — or a reporter — go verify any figure at its source.",
  },
  {
    n: "5",
    title: "Let the AI read the data, never the PDFs",
    body: "Only after all of that does the Budget Analyst get involved. It reads this reconciled, cited data — never the original PDFs — chooses which lookups to run, and explains the results in plain English. It never computes a total, estimates a gap, or invents a figure. Every number it shows is a number that already reconciled and already has a citation.",
  },
];

export function Methodology() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-default-500 hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        data-testid="methodology-trigger"
      >
        <CircleInfo className="size-4" />
        <span className="hidden md:inline">Methodology</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        testId="methodology-modal"
        title="How this works"
        subtitle="Why these numbers are trustworthy — and how they get here."
      >
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4 text-sm leading-relaxed">
          {/* Why */}
          <section>
            <h3 className="text-foreground mb-1.5 text-sm font-semibold">Why this exists</h3>
            <p className="text-default-600">
              Government budgets are technically public but practically unreadable — hundreds of pages of dense PDFs. A
              parent, a journalist, or a student can&apos;t easily ask a plain question and get a trustworthy answer.
              This project turns those documents into data where{" "}
              <span className="text-foreground font-medium">
                every number is traceable to a page and reconciles to the document&apos;s own totals
              </span>
              , then puts an AI analyst on top so you can just ask.
            </p>
          </section>

          {/* Inspiration */}
          <section>
            <h3 className="text-foreground mb-1.5 text-sm font-semibold">Inspired by BetaNYC</h3>
            <p className="text-default-600">
              The method mirrors{" "}
              <a
                href={BETANYC}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium hover:underline"
              >
                BetaNYC&apos;s New York City Budget
              </a>{" "}
              project: parse the official documents deterministically, reconcile every number against the
              document&apos;s printed totals, and never let a language model read or transcribe a figure. We brought that
              same discipline to Milwaukee&apos;s City, County, and school budgets.
            </p>
          </section>

          {/* Pipeline */}
          <section>
            <h3 className="text-foreground mb-2 text-sm font-semibold">How the numbers get here</h3>
            <ol className="space-y-3">
              {STEPS.map((s) => (
                <li key={s.n} className="flex gap-3">
                  <span
                    aria-hidden
                    className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                  >
                    {s.n}
                  </span>
                  <div>
                    <p className="text-foreground font-medium">{s.title}</p>
                    <p className="text-default-600 mt-0.5">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* The rule */}
          <section className="border-default-200 bg-default-50 rounded-xl border p-3.5">
            <h3 className="text-foreground mb-1.5 text-sm font-semibold">The one rule</h3>
            <p className="text-default-600">
              An AI never reads, transcribes, or computes a budget number — not once, anywhere in the pipeline. If a
              figure can&apos;t be extracted deterministically and reconciled, it doesn&apos;t ship. And a reconciliation
              mismatch is treated as a story lead, not an error to bury.
            </p>
          </section>

          {/* Coverage */}
          <section>
            <h3 className="text-foreground mb-1.5 text-sm font-semibold">What&apos;s covered</h3>
            <p className="text-default-600">
              The City of Milwaukee, Milwaukee County, and Milwaukee Public Schools. Alongside the hard numbers, the
              analyst can pull in <span className="text-foreground font-medium">Wisconsin Policy Forum</span> budget-brief
              commentary for context and framing — always attributed to a brief and page, and never treated as a source
              of figures. The county&apos;s scanned capital budget is intentionally left out until it can meet the same
              reconciliation bar.
            </p>
          </section>

          {/* Open source */}
          <section>
            <h3 className="text-foreground mb-1.5 text-sm font-semibold">See for yourself</h3>
            <p className="text-default-600">
              The parsers, the reconciliation tests, and the canonical data are all open. Read the code or check any
              number against its source:{" "}
              <a
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium hover:underline"
              >
                the project on GitHub
              </a>
              .
            </p>
          </section>
        </div>

        <div className="border-default-200 text-default-400 border-t px-5 py-3 text-xs">
          Reconciled, cited budget data for Milwaukee — City, County & Public Schools.
        </div>
      </Modal>
    </>
  );
}
