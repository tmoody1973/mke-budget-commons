"use client";

import { useRouter, useSearchParams } from "next/navigation";

export type Gov = "city" | "county" | "mps";

const GOVS: { key: Gov; label: string }[] = [
  { key: "city", label: "City" },
  { key: "county", label: "County" },
  { key: "mps", label: "MPS" },
];

/** Segmented government switcher. Updates the ?gov= URL param → the server page
 *  re-fetches, and the copilot's agent context follows (see AgentContextSync). */
export function GovYearSelectors({ gov }: { gov: Gov }) {
  const router = useRouter();
  const params = useSearchParams();

  const setGov = (g: Gov) => {
    const p = new URLSearchParams(params.toString());
    p.set("gov", g);
    router.push(`/?${p.toString()}`);
  };

  return (
    <div className="inline-flex rounded-lg border border-default-200 bg-content1 p-0.5" role="tablist" aria-label="Government">
      {GOVS.map(({ key, label }) => (
        <button
          key={key}
          role="tab"
          aria-selected={gov === key}
          onClick={() => setGov(key)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            gov === key ? "bg-primary text-primary-foreground shadow-sm" : "text-default-600 hover:bg-default-100"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
