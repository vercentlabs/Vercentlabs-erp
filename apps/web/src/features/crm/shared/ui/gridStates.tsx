"use client";

import type { ReactNode } from "react";
import { EmptyState, ErrorState } from "@vercentlabs/design-system";

import { LoadingState } from "./LoadingState";

type QueryLike = { isLoading: boolean; isError: boolean; refetch: () => unknown };

// One rule for every settings list: a request that is running shows a loading state that can be retried, a request that
// failed shows a retryable error (never an empty list, never a skeleton that never ends), and only a request that
// succeeded with nothing in it shows the empty state, which explains the feature.
export function gridStates(query: QueryLike, count: number, noun: string, empty: { title: string; description: ReactNode; action?: { label: string; onPress: () => void } }) {
  return {
    state: (query.isLoading ? "loading" : query.isError ? "error" : count === 0 ? "empty" : "ready") as "loading" | "error" | "empty" | "ready",
    loadingContent: <LoadingState label={`Loading ${noun}`} rows={4} onRetry={() => query.refetch()} />,
    errorContent: <ErrorState title={`Could not load ${noun}`} description="Check your connection and try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />,
    emptyContent: <EmptyState title={empty.title} description={empty.description} action={empty.action} />,
  };
}
