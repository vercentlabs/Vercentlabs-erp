"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { installReadTimeout } from "./fetch-timeout";

installReadTimeout();

// The one QueryClient for the whole app shell (Phase 21) — no module may
// create its own. Query-key scope safety convention every query in this
// app must follow: [organizationId, companyId, ...rest]. On a company/
// branch switch, AppShell's context-switch handler calls
// queryClient.removeQueries() for the previous scope before the new
// WorkspaceContextProvider value commits, so no cross-company response
// can still be read from cache after the switch (see
// shell/workspace-context/ContextSwitcher.tsx).
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
