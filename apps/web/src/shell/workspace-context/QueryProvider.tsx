"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { installReadTimeout } from "./fetch-timeout";

installReadTimeout();

// The one QueryClient for the whole app shell — no module may
// create its own. Query-key scope safety convention every query in this
// app must follow: [organizationId, ...rest] (see queryKeys.ts).
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
