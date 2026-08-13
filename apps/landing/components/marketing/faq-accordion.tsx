import { cx } from "@/lib/utils";
import { Reveal } from "@/components/motion/reveal";

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
 *
 * Self-wraps in its own <Reveal group>: entries carry data-reveal-item
 * unconditionally, so without a reveal-group ancestor they'd stay stuck at
 * opacity:0 forever. See card.tsx's FeatureList for the same fix and its
 * rationale — this is the same class of bug, found live on two pages during
 * the sitewide motion rollout.
 */
export function FaqAccordion({ items, className, reveal = true }: { items: FaqItem[]; className?: string; reveal?: boolean }) {
  const accordion = (
    <div className={cx("flex flex-col divide-y divide-(--color-border-default) border-t border-(--color-border-default)", className)}>
        {items.map((item, index) => (
          <details
            key={item.question}
            data-reveal-item={reveal ? "" : undefined}
            style={reveal ? { transitionDelay: `${Math.min(index, 4) * 60}ms` } : undefined}
            // "faq-item" drives the smooth open/close height transition in
            // globals.css (::details-content + @starting-style) — zero-JS,
            // progressive enhancement; unsupported browsers keep the native
            // instant snap, no regression either way.
            className="group faq-item py-4"
          >
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

  return reveal ? <Reveal group>{accordion}</Reveal> : accordion;
}
