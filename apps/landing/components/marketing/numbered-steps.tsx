import { cx } from "@/lib/utils";

interface NumberedStep {
  step: string;
  title: string;
  description: string;
}

/** Vertical numbered sequence — for the Implementation section. Ordered <ol> so screen readers announce step order. */
export function NumberedSteps({ steps, className }: { steps: NumberedStep[]; className?: string }) {
  return (
    <ol className={cx("flex flex-col gap-0", className)}>
      {steps.map((item, index) => (
        <li key={item.step} className={cx("flex gap-4 border-(--color-border-default) py-5", index > 0 && "border-t")}>
          <span className="tabular-data flex h-9 w-9 flex-none items-center justify-center rounded-(--radius-control) bg-(--color-bg-brand) text-sm font-semibold text-(--color-text-inverse)">
            {item.step}
          </span>
          <div>
            <p className="text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-(--color-text-secondary)">{item.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
