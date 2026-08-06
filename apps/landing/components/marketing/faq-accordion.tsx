import { cx } from "@/lib/utils";

interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Native <details>/<summary> — keyboard operable and screen-reader accessible
 * by default with zero custom JS, and every answer stays in the server-rendered
 * HTML (just visually collapsed), so crawlers and answer engines see the full
 * text regardless of open/closed state. The matching FAQPage JSON-LD is built
 * from this same `items` data in app/page.tsx, not duplicated here — see
 * docs/landing-redesign/phase-3/decision-log.md item 4.
 */
export function FaqAccordion({ items, className }: { items: FaqItem[]; className?: string }) {
  return (
    <div className={cx("flex flex-col divide-y divide-(--color-border-default) border-t border-(--color-border-default)", className)}>
      {items.map((item) => (
        <details key={item.question} className="group py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-(--color-text-primary) marker:content-none">
            {item.question}
            <svg
              viewBox="0 0 12 12"
              width="12"
              height="12"
              className="flex-none text-(--color-text-muted) transition-transform duration-(--duration-fast) group-open:rotate-180"
              aria-hidden="true"
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-(--color-text-secondary)">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
