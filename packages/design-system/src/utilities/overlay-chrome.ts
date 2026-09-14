/** Shared floating-surface chrome for Popover/Select/ComboBox/Menu/Dialog —
 * these are the "meaningful shadow" surfaces per the visual-restraint
 * principle (borders elsewhere, shadows only for floating layers). */
export const popoverChrome =
  "rounded-[var(--radius-panel)] border border-border bg-surface-raised shadow-panel outline-none";

export const listBoxItemChrome = [
  "flex cursor-default items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm text-text outline-none",
  "data-[focused]:bg-surface-muted data-[selected]:bg-brand-soft data-[selected]:text-text",
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
].join(" ");
