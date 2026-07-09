"use client";

import type { Gov } from "./nav-items";

import { useRouter, useSearchParams } from "next/navigation";

import { NAV_ITEMS } from "./nav-items";
import { HowToUse } from "@/components/onboarding/HowToUse";
import { Methodology } from "@/components/onboarding/Methodology";

/** Horizontal top navigation — leaves the full width for the dashboard content. */
export function TopNav() {
  const router = useRouter();
  const params = useSearchParams();

  const govParam = params.get("gov");
  const hasGov = govParam === "city" || govParam === "county" || govParam === "mps";
  const gov: Gov = hasGov ? (govParam as Gov) : "city";

  const go = (href: string, external?: boolean) => {
    if (external) window.open(href, "_blank", "noopener,noreferrer");
    else router.push(href);
  };

  return (
    <header className="border-default-200 bg-content1/85 sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-2.5">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-xs font-bold">
          MKE
        </div>
        <span className="text-foreground hidden text-sm font-semibold sm:inline">Milwaukee Budget</span>
      </div>

      <nav className="ml-2 flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.gov ? hasGov && item.gov === gov : item.href === "/" ? !hasGov : false;
          const Icon = item.icon;
          return (
            <button
              key={item.href}
              onClick={() => go(item.href)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active ? "bg-primary/10 text-primary" : "text-default-600 hover:bg-default-100"
              }`}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <Methodology />
        <HowToUse />
        <span className="text-default-400 hidden whitespace-nowrap text-sm xl:inline">Ask the copilot →</span>
      </div>
    </header>
  );
}
