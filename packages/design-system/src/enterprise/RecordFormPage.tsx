import type { ReactNode } from "react";
import { PageHeader, type PageHeaderProps } from "./PageHeader.tsx";
import { Stack } from "../layout/Stack.tsx";
import { Surface } from "../layout/Surface.tsx";

export interface RecordFormPageProps {
  header: Omit<PageHeaderProps, "primaryAction" | "secondaryActions">;
  /** Typically form.AppForm > SubmitButton + a Cancel Button — kept
   * generic rather than typed to a specific form library here. */
  formActions: ReactNode;
  /** Rendered above the form surface — ServerErrorSummary/ConflictBanner
   * go here so they're visible before scrolling into the fields. */
  banner?: ReactNode;
  children: ReactNode;
}

/**
 * Create/Edit form composition: header (no actions there — actions live
 * with the form, not the page chrome, since Cancel/Save must stay bound
 * to the actual form state), an optional banner slot for server/conflict
 * errors, and the form surface itself.
 */
export function RecordFormPage({ header, formActions, banner, children }: RecordFormPageProps) {
  return (
    <Stack gap={4}>
      <PageHeader {...header} />
      {banner}
      <Surface padding="lg">
        <Stack gap={4}>
          {children}
          <div className="flex justify-end gap-2 border-t border-border pt-4">{formActions}</div>
        </Stack>
      </Surface>
    </Stack>
  );
}
