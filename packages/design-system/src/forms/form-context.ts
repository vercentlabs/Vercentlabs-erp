import { createFormHookContexts } from "@tanstack/react-form";

// Single shared context pair, per TanStack Form's documented createFormHook
// pattern — every field/form component in this directory binds through
// these, so a form built with useAppForm (form-hook.ts) gets them for free.
export const { fieldContext, useFieldContext, formContext, useFormContext } = createFormHookContexts();
