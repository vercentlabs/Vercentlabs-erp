"use client";

// A record's position in an ordered set of stages. Current stage is named in text and marked, so the state is never
// carried by colour alone.
export function StageProgress({ stages, currentId, label = "Stage progress" }: { stages: Array<{ id: string; name: string; isClosed?: boolean }>; currentId: string | null | undefined; label?: string }) {
  const index = stages.findIndex((s) => s.id === currentId);
  if (stages.length === 0) return null;
  return (
    <ol aria-label={label} className="flex flex-wrap items-stretch gap-1.5">
      {stages.map((stage, i) => {
        const done = index >= 0 && i < index;
        const current = i === index;
        return (
          <li
            key={stage.id}
            aria-current={current ? "step" : undefined}
            className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs ${current ? "border-brand bg-brand-soft font-semibold text-brand-active" : done ? "border-border bg-canvas-strong text-text-secondary" : "border-dashed border-border text-text-muted"}`}
          >
            <span aria-hidden="true">{done ? "✓" : current ? "●" : "○"}</span>
            {stage.name}
            <span className="sr-only">{current ? " (current stage)" : done ? " (completed)" : " (upcoming)"}</span>
          </li>
        );
      })}
    </ol>
  );
}
