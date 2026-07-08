"use client";

import "@copilotkit/react-core/v2/styles.css";
import { Suspense } from "react";
import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core/v2";
import { ToolRenderers } from "@/components/copilot/tool-renderers";
import { TopNav } from "@/components/shell/top-nav";

/**
 * Client boundary: CopilotKit v2 provider + the Journalist copilot sidebar (right),
 * with a horizontal top nav above the full-width dashboard content.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <ToolRenderers />
      <div className="flex min-h-screen flex-col">
        <Suspense fallback={<div className="h-14" />}>
          <TopNav />
        </Suspense>
        {children}
      </div>
      <CopilotSidebar />
    </CopilotKit>
  );
}
