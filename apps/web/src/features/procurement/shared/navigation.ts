"use client";

// Procurement's list, tab and form navigation: the shell's shared hooks (shell/lists/list-state.ts), with lists remembered under
// "procurement:" as before.
import { useListState as useSharedListState } from "@/shell/lists/list-state";

export { useFormChangesWarning, useTabParam, useUnsavedChangesWarning } from "@/shell/lists/list-state";

export function useListState<F extends Record<string, string>>(listKey: string, defaults: { view: string; filters: F }) {
  return useSharedListState(listKey, defaults, "procurement");
}
