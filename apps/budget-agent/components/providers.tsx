"use client";

import "@copilotkit/react-core/v2/styles.css";
import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core/v2";
import { ToolRenderers } from "@/components/copilot/tool-renderers";

/**
 * Client boundary: mounts the CopilotKit v2 provider (pointed at our runtime
 * route) and the Journalist copilot sidebar around the whole app.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <ToolRenderers />
      {children}
      <CopilotSidebar />
    </CopilotKit>
  );
}
