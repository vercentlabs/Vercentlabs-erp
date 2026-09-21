"use client";

// The stages of a guided flow, in order. The current one is marked with text and an icon as well as colour.
export function ImportStepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol aria-label="Import progress" className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${active ? "bg-brand text-text-inverse" : done ? "bg-success text-text-inverse" : "border border-border text-text-muted"}`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`text-sm ${active ? "font-semibold text-text" : done ? "text-text-secondary" : "text-text-muted"}`}>
              {label}
              <span className="sr-only">{active ? " (current step)" : done ? " (done)" : " (not started)"}</span>
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
