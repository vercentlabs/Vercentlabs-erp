"use client";

import { useEffect, useState } from "react";
import { Button, Skeleton } from "@vercentlabs/design-system";

// Skeleton rows while a request runs. After SLOW_AFTER_MS it says so and offers a retry, so a slow request is never
// an indefinite "Loading..." (the request itself is cut off by the 30 second read timeout).
const SLOW_AFTER_MS = 8_000;

export function LoadingState({ label = "Loading", rows = 5, onRetry }: { label?: string; rows?: number; onRetry?: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-3 px-4 py-6">
      <p className="text-sm text-text-secondary">{label}…</p>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
      {slow && (
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <span>This is taking longer than usual.</span>
          {onRetry && <Button variant="secondary" size="compact" onPress={onRetry}>Try again</Button>}
        </div>
      )}
    </div>
  );
}
