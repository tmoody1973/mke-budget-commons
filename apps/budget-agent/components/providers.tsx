"use client";

import "@copilotkit/react-core/v2/styles.css";
import { CopilotKit, CopilotSidebar } from "@copilotkit/react-core/v2";

/**
 * Client boundary: mounts the CopilotKit v2 provider (pointed at our runtime
 * route) and the Journalist copilot sidebar around the whole app.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      {children}
      <CopilotSidebar />
    </CopilotKit>
  );
}
