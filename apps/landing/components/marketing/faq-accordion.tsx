
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
    <div className={cx("flex flex-col border-t border-(--color-border-strong)", className)}>
        {items.map((item, index) => (
          <details
            key={item.question}
            data-reveal-item={reveal ? "" : undefined}
            style={reveal ? { transitionDelay: `${Math.min(index, 4) * 60}ms` } : undefined}
            // "faq-item" drives the smooth open/close height transition in
            // globals.css (::details-content + @starting-style) — zero-JS,
            // progressive enhancement; unsupported browsers keep the native
            // instant snap, no regression either way.
            className="group faq-item border-b border-(--color-border-default) py-5 sm:py-6"
          >
            <summary className="grid cursor-pointer list-none grid-cols-[1fr_2rem] items-center gap-5 text-base font-semibold tracking-[-0.025em] text-(--color-text-primary) marker:content-none">
              {item.question}
              <svg
                viewBox="0 0 12 12"
                width="12"
                height="12"
                className="flex-none text-(--color-text-muted) transition-transform duration-(--duration-fast) group-open:rotate-45"
                aria-hidden="true"
              >
                <path d="M2 6h8M6 2v8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              </svg>
            </summary>
            <p className="mt-4 max-w-[72ch] border-l border-(--color-border-default) pl-4 text-sm leading-[1.75] text-(--color-text-secondary)">{item.answer}</p>
          </details>
        ))}
    </div>
  );

  return reveal ? <Reveal group>{accordion}</Reveal> : accordion;
}
