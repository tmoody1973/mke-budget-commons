"use client";

import type { Gov } from "./nav-items";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { NAV_ITEMS } from "./nav-items";
import { HowToUse } from "@/components/onboarding/HowToUse";
import { Methodology } from "@/components/onboarding/Methodology";

/** Horizontal top navigation — leaves the full width for the dashboard content. */
export function TopNav() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const govParam = params.get("gov");
  const hasGov = govParam === "city" || govParam === "county" || govParam === "mps";
  const gov: Gov = hasGov ? (govParam as Gov) : "city";

  const go = (href: string, external?: boolean) => {
    if (external) window.open(href, "_blank", "noopener,noreferrer");
    else router.push(href);
  };

  return (
    <header className="border-default-200 bg-content1/85 sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
      <div className="flex shrink-0 items-center gap-2.5">
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-xs font-bold">
          MKE
        </div>
        <span className="text-foreground hidden text-sm font-semibold sm:inline">Milwaukee Budget</span>
      </div>

      <nav className="ml-2 flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV_ITEMS.map((item) => {
          // Route-aware: gov items only ever match on "/", and a standalone route
          // (/spending, /grants) matches its own path. Without the pathname check,
          // Dashboard highlighted on every non-gov page — including the new routes.
          const itemPath = item.href.split("?")[0];
          const active =
            item.gov
              ? pathname === "/" && hasGov && item.gov === gov
              : itemPath === "/"
                ? pathname === "/" && !hasGov
                : pathname === itemPath;
          const Icon = item.icon;
          return (
            <button
              key={item.href}
              // shrink-0: nav scrolls as a whole rather than each label compressing
              // to an unreadable width.
              onClick={() => go(item.href)}
              // The label is hidden below sm, so the button would otherwise be an
              // icon with no accessible name.
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active ? "bg-primary/10 text-primary" : "text-default-600 hover:bg-default-100"
              }`}
            >
              <Icon className="size-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <Methodology />
        <HowToUse />
        <span className="text-default-400 hidden whitespace-nowrap text-sm 2xl:inline">Ask the copilot →</span>
      </div>
    </header>
  );
}
