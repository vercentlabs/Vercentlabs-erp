import type { ComponentProps } from "react";

import { Button } from "../primitives/Button";
import { useFormContext } from "./form-context";

// A form-level component (registered in useAppForm.ts) rather than a field
// component: it reads the whole form's canSubmit/isSubmitting/isDirty
// state, which no single field owns. Disabled while invalid or unchanged
// so it can never submit a no-op or a known-invalid form.
export function FormSubmitButton({ children, ...props }: Omit<ComponentProps<typeof Button>, "type" | "loading" | "disabled">) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting, state.isDirty] as const}>
      {([canSubmit, isSubmitting, isDirty]) => (
        <Button type="submit" loading={isSubmitting} disabled={!canSubmit || !isDirty} {...props}>
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}
