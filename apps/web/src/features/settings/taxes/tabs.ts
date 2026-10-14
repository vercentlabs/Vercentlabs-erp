// The tabs of Settings › Taxes (?tab=). Kept out of the screen ("use client") so the server page can read them: a client module's
// exports reach the server only as client references, never as values.
export const TAX_TABS = [
  { id: "categories", label: "Tax categories" }, { id: "registrations", label: "Company registrations" }, { id: "defaults", label: "Defaults" },
  { id: "check", label: "Setup check" }, { id: "history", label: "History" },
] as const;
export type TaxTab = (typeof TAX_TABS)[number]["id"];

export const taxTabOf = (tab: string | undefined): TaxTab => TAX_TABS.find((entry) => entry.id === tab)?.id ?? "categories";
