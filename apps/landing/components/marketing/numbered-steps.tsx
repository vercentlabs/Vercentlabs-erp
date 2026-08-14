import { cx } from "@/lib/utils";
import { Reveal } from "@/components/motion/reveal";

interface NumberedStep {
  step: string;
  title: string;
  description: string;
}

export function NumberedSteps({ items, className }: { items: NumberedStep[]; className?: string }) {
  return (
    <Reveal group>
      <ol className={cx("border-t border-(--color-border-strong)", className)}>
        {items.map((item, index) => (
          <li
            key={item.step}
            data-reveal-item
            style={{ transitionDelay: `${Math.min(index, 4) * 60}ms` }}
            className="grid grid-cols-[48px_1fr] gap-4 border-b border-(--color-border-default) py-5 sm:grid-cols-[70px_220px_1fr] sm:items-start"
          >
            <span className="vl-index text-(--color-text-brand)">{item.step}</span>
            <p className="text-sm font-semibold text-(--color-text-primary)">{item.title}</p>
            <p className="col-start-2 text-sm leading-relaxed text-(--color-text-secondary) sm:col-start-3">{item.description}</p>
          </li>
        ))}
      </ol>
    </Reveal>
  );
}
