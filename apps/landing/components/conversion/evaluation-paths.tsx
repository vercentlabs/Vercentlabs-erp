import { CTAS, EVALUATION_SECTION } from "@vercentlabs/landing-content";
import { TrackedCtaLink } from "@/components/analytics/tracked-cta-link";

/**
 * The evaluation paths (explore, follow a workflow, guided walkthrough) as a
 * row of columns. auto-fit: adding a path in content adds a column, not a
 * layout change. Each action fires the existing evaluation_path_click event
 * with ctaLocation `${locationPrefix}_${path.key}`. `omitHref` drops a path that would
 * link to the page it is shown on.
 */
export function EvaluationPaths({ locationPrefix, omitHref }: { locationPrefix: string; omitHref?: string }) {
  return (
    <ol className="grid grid-cols-1 gap-px bg-(--color-border-strong) md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
      {EVALUATION_SECTION.paths.filter((path) => path.cta.href !== omitHref).map((path, index) => {
        const isPrimary = path.cta.href === CTAS.primary.href;
        return (
          <li key={path.key} className="flex flex-col bg-(--color-bg-page) p-6 sm:p-7">
            <div className="flex items-center gap-3">
              <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
              <span className="h-px flex-1 bg-(--color-border-default)" aria-hidden="true" />
            </div>
            <h3 className="mt-5 text-xl font-semibold tracking-[-0.035em] text-(--color-text-primary)">{path.title}</h3>
            <p className="mt-2 flex-1 text-sm leading-[1.65] text-(--color-text-secondary)">{path.description}</p>
            <div className="mt-6">
              <TrackedCtaLink
                href={path.cta.href}
                event={EVALUATION_SECTION.pathAnalyticsId}
                ctaLocation={`${locationPrefix}_${path.key}`}
                variant={isPrimary ? "primary" : "secondary"}
              >
                {path.cta.label}
              </TrackedCtaLink>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
