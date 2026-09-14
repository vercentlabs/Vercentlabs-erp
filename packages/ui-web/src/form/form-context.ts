import { createFormHookContexts } from "@tanstack/react-form";

// Shared once per app -- every field component in ./fields.tsx reads its
// TanStack Form field state through this context rather than each field
// re-deriving its own. See docs/ux/UI_REWRITE_TRACKER.md Phase 3 (TanStack
// Form + Zod architecture).
export const { fieldContext, useFieldContext, formContext, useFormContext } = createFormHookContexts();
