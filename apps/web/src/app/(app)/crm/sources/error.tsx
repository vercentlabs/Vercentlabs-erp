"use client";

import { ActionButton, ErrorState } from "@/shared/design";

export default function LeadSourcesError({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      title="Lead sources could not be loaded"
      description="Retry the request. No configuration was changed."
      action={
        <ActionButton tone="primary" type="button" onClick={reset}>
          Try again
        </ActionButton>
      }
    />
  );
}
