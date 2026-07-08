import type { ComponentType } from "react";

import { ChartColumn, CircleInfo, FileText, GraduationCap, House } from "@gravity-ui/icons";

export type Gov = "city" | "county" | "mps";

export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** For gov items: which government this selects (active-state matching). */
  readonly gov?: Gov;
  readonly external?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", icon: House, label: "Dashboard" },
  { href: "/?gov=city", icon: ChartColumn, label: "City", gov: "city" },
  { href: "/?gov=county", icon: FileText, label: "County", gov: "county" },
  { href: "/?gov=mps", icon: GraduationCap, label: "MPS", gov: "mps" },
] as const;

export const FOOTER_ITEMS: readonly NavItem[] = [
  {
    href: "https://github.com/tmoody1973/mke-budget-commons",
    icon: CircleInfo,
    label: "Methodology",
    external: true,
  },
] as const;
