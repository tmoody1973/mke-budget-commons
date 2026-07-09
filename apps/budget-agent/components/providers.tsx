"use client";

import "@copilotkit/react-core/v2/styles.css";
import { Suspense, useEffect, useState } from "react";
import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core/v2";
import { ToolRenderers } from "@/components/copilot/tool-renderers";
import { TopNav } from "@/components/shell/top-nav";

/**
 * Client boundary: CopilotKit v2 provider + the Journalist copilot sidebar (right),
 * with a horizontal top nav above the full-width dashboard content.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // The sidebar docks beside the dashboard on desktop, but is a full-screen modal
  // on phones — so it must NOT auto-open there, or it buries the dashboard on load.
  // Mount it after measuring the viewport (defaultOpen is read once): open on
  // desktop, a tappable bubble on mobile.
  const [sidebar, setSidebar] = useState<{ open: boolean } | null>(null);
  useEffect(() => {
    setSidebar({ open: window.matchMedia("(min-width: 768px)").matches });
  }, []);

  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <ToolRenderers />
      <div className="flex min-h-screen flex-col">
        <Suspense fallback={<div className="h-14" />}>
          <TopNav />
        </Suspense>
        {children}
      </div>
      {sidebar && <CopilotSidebar defaultOpen={sidebar.open} labels={{ modalHeaderTitle: "Budget Analyst" }} />}
    </CopilotKit>
  );
}
