// Create where you are (Create-Where-You-Are plan): the kinds of record a form can ask for and create on the spot, and what a picker
// hands back. Every kind is searched on the server as the user types (no preloaded lists, no caps).
export type PickerKind = "contact" | "company" | "lead" | "customer" | "customerContact" | "supplier" | "item" | "uom" | "itemCategory" | "paymentTerm" | "department" | "designation" | "expenseCategory" | "assetLocation" | "ledger";

// A record as a picker shows it: its name, a second line (GSTIN, mobile, city, code…) and the record itself for the form to read.
export type PickedRecord = { id: string; label: string; description?: string; raw?: Record<string, unknown> };

// What a quick-create form gets: what was typed, defaults from the form it was opened from (the deal's company, a party kind…),
// and where to hand the new record (or an existing one the user chose from the duplicates instead).
export type QuickCreateProps = {
  initialText: string;
  prefill?: Record<string, unknown>;
  onCreated: (record: PickedRecord) => void;
  onCancel: () => void;
};
