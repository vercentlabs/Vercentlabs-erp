"use client";

// "Selling to: A business / A person" (Create-Where-You-Are plan): wherever a party is asked for, the first choice is whether it is a
// business or a person. A person needs no company: the form asks for the person instead and the server keeps them as an individual
// customer (B2C for GST). The form changes shape instead of showing a required star that is sometimes not required.
export type PartyMode = "business" | "person";

export function PartyModeField({ value, onChange, label = "Selling to", businessLabel = "A business", personLabel = "A person", isDisabled }: {
  value: PartyMode;
  onChange: (mode: PartyMode) => void;
  label?: string;
  businessLabel?: string;
  personLabel?: string;
  isDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <span className="text-sm font-medium text-text" id="party-mode-label">{label}</span>
      <div role="radiogroup" aria-labelledby="party-mode-label" className="grid w-full grid-cols-2 gap-2 sm:w-fit">
        {([["business", businessLabel], ["person", personLabel]] as const).map(([mode, text]) => (
          <button key={mode} type="button" role="radio" aria-checked={value === mode} disabled={isDisabled} onClick={() => onChange(mode)}
            className={`h-10 rounded-[var(--radius-control)] border px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60 sm:min-w-36 ${
              value === mode ? "border-brand bg-brand-soft text-brand" : "border-border text-text-secondary hover:border-border-strong hover:text-text"}`}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
