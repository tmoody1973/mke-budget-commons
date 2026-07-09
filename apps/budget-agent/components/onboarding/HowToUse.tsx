"use client";

import { useState } from "react";
import { Modal } from "./Modal";
import { PERSONAS } from "./example-questions";

/**
 * Fill the copilot input with a question and (best-effort) submit it. Uses the
 * same DOM path the E2E drives: open the sidebar if needed, set the textarea via
 * the native value setter (so React's controlled input picks it up), then submit
 * the enclosing form. Degrades gracefully: if submit doesn't fire, the question
 * is prefilled and focused for the user to send.
 */
function askCopilot(question: string) {
  const findInput = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Type a message..."]');

  const existing = findInput();
  if (!existing || existing.offsetParent === null) {
    document.querySelector<HTMLButtonElement>("button.copilotKitButton")?.click();
  }

  window.setTimeout(() => {
    const el = findInput();
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, question);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    const form = el.closest("form");
    if (form) form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, 200);
}

export function HowToUse() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(PERSONAS[0].id);
  const persona = PERSONAS.find((p) => p.id === tab) ?? PERSONAS[0];

  const ask = (q: string) => {
    setOpen(false);
    askCopilot(q);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-default-500 hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        data-testid="how-to-use-trigger"
      >
        <span
          aria-hidden
          className="border-default-300 text-default-500 flex size-4 items-center justify-center rounded-full border text-[10px] font-bold"
        >
          ?
        </span>
        <span className="hidden md:inline">How to use</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        testId="how-to-use-modal"
        title="How to use the Budget Analyst"
        subtitle="Ask in plain English. Every number comes from the reconciled budget and cites its source. Tap a question to ask it."
      >
        {/* Persona tabs — horizontal scroll on narrow screens */}
        <div className="border-default-200 flex gap-1 overflow-x-auto border-b px-3 py-2">
          {PERSONAS.map((p) => {
            const active = p.id === tab;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setTab(p.id)}
                aria-current={active ? "true" : undefined}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active ? "bg-primary/10 text-primary" : "text-default-600 hover:bg-default-100"
                }`}
              >
                <span aria-hidden>{p.emoji}</span>
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Questions for the active persona */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <p className="text-default-500 px-2 pb-2 text-sm">{persona.blurb}</p>
          <ul className="flex flex-col gap-1.5">
            {persona.questions.map((item) => (
              <li key={item.q}>
                <button
                  type="button"
                  onClick={() => ask(item.q)}
                  data-testid="example-question"
                  className="border-default-200 hover:border-primary/40 hover:bg-primary/5 group flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition"
                >
                  <span className="text-primary mt-0.5 shrink-0 text-sm" aria-hidden>
                    →
                  </span>
                  <span className="min-w-0">
                    <span className="text-foreground block text-sm">{item.q}</span>
                    {item.hint && <span className="text-default-400 mt-0.5 block text-xs">{item.hint}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="border-default-200 text-default-400 border-t px-5 py-3 text-xs">
          The analyst reads only the reconciled budget data — it never invents a number, and it will say so if
          something isn&apos;t in the data.
        </div>
      </Modal>
    </>
  );
}
