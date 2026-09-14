import { useStore } from "@tanstack/react-form";
import { useFormContext } from "./form-context.ts";
import { Button, type ButtonProps } from "../actions/Button.tsx";

export interface SubmitButtonProps extends Omit<ButtonProps, "type" | "isLoading" | "isDisabled"> {
  /** Disable while the form has no changes to submit — set false for a
   * "Create" form where every submit is meaningful even without edits. */
  disableWhenPristine?: boolean;
}

/** Submit button bound to the form's isSubmitting/canSubmit/isDirty state
 * — never render a bare `<Button type="submit">` for an ERP form, or you
 * lose the double-submit guard and the loading state for free. */
export function SubmitButton({ disableWhenPristine = true, children, ...props }: SubmitButtonProps) {
  const form = useFormContext();
  const [canSubmit, isSubmitting, isDirty] = useStore(form.store, (state) => [state.canSubmit, state.isSubmitting, state.isDirty]);
  return (
    <Button
      type="submit"
      isLoading={isSubmitting}
      isDisabled={!canSubmit || (disableWhenPristine && !isDirty)}
      {...props}
    >
      {children}
    </Button>
  );
}
