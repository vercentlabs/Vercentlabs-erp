import { cx } from "@/lib/utils";
import { Container, Section } from "@/components/layout/container";
import { Heading, Text } from "@/components/ui/text";

export type CollectionHeroVariant =
  | "modules"
  | "industries"
  | "solutions"
  | "workflows"
  | "resources"
  | "glossary"
  | "compare"
  | "implementation"
  | "generic";

interface CollectionHeroItem {
  label: string;
  meta?: string;
}

const VARIANT_FOLIO: Record<CollectionHeroVariant, string> = {
  modules: "MODULE ATLAS",
  industries: "FIELD NOTES",
  solutions: "DIAGNOSTIC",
  workflows: "RUNBOOK",
  resources: "REFERENCE LIBRARY",
  glossary: "LEXICON",
  compare: "DECISION DOCKET",
  implementation: "ROLLOUT PLAN",
  generic: "INDEX",
};

function HeroRegister({ items, label, variant }: { items: CollectionHeroItem[]; label: string; variant: CollectionHeroVariant }) {
  if (variant === "workflows") {
    return (
      <div className="mt-10 border-y border-(--color-border-strong) py-4">
        <div className="grid gap-4 lg:grid-cols-[150px_1fr] lg:gap-10">
          <span className="vl-index">{label}</span>
          <ol className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
            {items.slice(0, 6).map((item, index) => (
              <li key={item.label} className="relative border-t border-(--color-border-default) py-4 sm:border-l sm:px-5 sm:first:border-l-0">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-(--color-border-strong) bg-(--color-bg-elevated) font-mono text-[0.6rem] font-bold text-(--color-text-brand)">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm font-semibold text-(--color-text-primary)">{item.label}</span>
                </div>
                {item.meta ? <p className="mt-2 pl-10 text-[0.67rem] uppercase tracking-[0.09em] text-(--color-text-muted)">{item.meta}</p> : null}
                {index < Math.min(items.length, 6) - 1 ? <span className="absolute right-[-7px] top-[28px] z-10 hidden text-xs text-(--color-text-muted) lg:block" aria-hidden="true">→</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  if (variant === "implementation") {
    return (
      <div className="mt-10 border-y border-(--color-border-strong) py-5">
        <div className="flex items-center justify-between gap-5">
          <span className="vl-index">{label}</span>
          <span className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.12em] text-(--color-text-muted)">{items.length} phases</span>
        </div>
        <ol className="mt-5 grid grid-cols-2 gap-0 sm:grid-cols-4 lg:grid-cols-8">
          {items.slice(0, 8).map((item, index) => (
            <li key={item.label} className="border-l border-(--color-border-default) px-3 py-3 first:border-l-0">
              <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
              <p className="mt-2 text-xs font-semibold leading-snug text-(--color-text-primary)">{item.label}</p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (variant === "resources") {
    return (
      <div className="border-y border-(--color-border-strong) bg-(--color-bg-elevated)">
        <div className="grid md:grid-cols-[170px_1fr]">
          <div className="border-b border-(--color-border-default) p-5 md:border-b-0 md:border-r md:p-6">
            <span className="vl-index">{label}</span>
            <p className="mt-8 font-mono text-[3.4rem] font-semibold leading-none tracking-[-0.08em] text-(--color-text-primary)">{String(items.length).padStart(2, "0")}</p>
            <p className="mt-2 text-[0.66rem] font-bold uppercase tracking-[0.13em] text-(--color-text-muted)">published references</p>
          </div>
          <ol className="grid sm:grid-cols-2">
            {items.slice(0, 6).map((item, index) => (
              <li key={item.label} className="grid grid-cols-[2.2rem_1fr] gap-3 border-b border-(--color-border-default) p-5 sm:odd:border-r">
                <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <p className="text-sm font-semibold text-(--color-text-primary)">{item.label}</p>
                  {item.meta ? <p className="mt-1 text-[0.66rem] uppercase tracking-[0.09em] text-(--color-text-muted)">{item.meta}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  if (variant === "glossary") {
    return (
      <div className="border-t border-(--color-border-strong) pt-5">
        <div className="grid items-end gap-8 sm:grid-cols-[150px_1fr]">
          <div>
            <span className="vl-index">{label}</span>
            <p className="mt-4 font-mono text-[4.5rem] font-semibold leading-[0.8] tracking-[-0.09em] text-(--color-text-primary)">{String(items.length).padStart(2, "0")}</p>
          </div>
          <ol className="grid grid-cols-2 border-y border-(--color-border-default) sm:grid-cols-3">
            {items.slice(0, 6).map((item, index) => (
              <li key={item.label} className="border-r border-(--color-border-default) p-4 last:border-r-0">
                <span className="vl-index text-(--color-text-brand)">{String.fromCharCode(65 + index)}</span>
                <p className="mt-2 text-xs font-semibold leading-snug text-(--color-text-primary)">{item.label}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  if (variant === "compare") {
    return (
      <div className="border-y border-(--color-border-strong) py-5">
        <div className="grid items-center gap-8 sm:grid-cols-[1fr_auto_1fr]">
          <div>
            <span className="vl-index">Evidence standard</span>
            <p className="mt-2 text-sm font-semibold text-(--color-text-primary)">Sourced · dated · neutrally framed</p>
          </div>
          <div className="hidden h-12 w-px bg-(--color-border-strong) sm:block" aria-hidden="true" />
          <div className="sm:text-right">
            <span className="vl-index">{label}</span>
            <p className="mt-2 text-sm font-semibold text-(--color-text-primary)">{items[0]?.label ?? "Evidence-led comparison"}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <aside className={cx("border-t border-(--color-border-strong) pt-4", variant === "solutions" && "border-l-[3px] border-l-(--vl-signal) pl-5")}>
      <div className="mb-2 flex items-end justify-between gap-4">
        <Text variant="caption" className="font-bold uppercase tracking-[0.12em]">{label}</Text>
        <span className="tabular-data text-4xl font-semibold leading-none tracking-[-0.06em] text-(--color-text-primary)">{String(items.length).padStart(2, "0")}</span>
      </div>
      <ol>
        {items.slice(0, 6).map((item, index) => (
          <li key={item.label} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-(--color-border-default) py-3.5">
            <span className="vl-index text-(--color-text-brand)">{String(index + 1).padStart(2, "0")}</span>
            <span className="text-sm font-semibold text-(--color-text-primary)">{item.label}</span>
            {item.meta ? <span className="text-[0.66rem] uppercase tracking-[0.08em] text-(--color-text-muted)">{item.meta}</span> : null}
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function CollectionHero({
  eyebrow,
  heading,
  supportingText,
  items,
  listLabel,
  variant = "generic",
}: {
  eyebrow: string;
  heading: string;
  supportingText: string;
  items: CollectionHeroItem[];
  listLabel: string;
  variant?: CollectionHeroVariant;
}) {
  const isFullWidthRegister = ["workflows", "implementation"].includes(variant);
  const editorialResource = variant === "resources";

  return (
    <Section tone="page" paddingTop={{ base: 8, sm: 12 }} paddingBottom={{ base: 12, sm: 18 }}>
      <Container>
        <div className="reveal-on-load border-t border-(--color-border-strong) pt-5" data-page-family={variant}>
          <div className="flex items-center justify-between gap-4">
            <Text variant="eyebrow">{eyebrow}</Text>
            <span className="vl-folio hidden sm:flex">{VARIANT_FOLIO[variant]} / {String(items.length).padStart(2, "0")}</span>
          </div>

          {editorialResource ? (
            <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)] lg:items-end lg:gap-16">
              <div>
                <span className="vl-index">VERCENTLABS / REFERENCE EDITION</span>
                <Heading level="display" as="h1" className="mt-4 max-w-[10ch]">{heading}</Heading>
                <Text variant="lead" className="mt-6 max-w-[58ch]">{supportingText}</Text>
              </div>
              <HeroRegister items={items} label={listLabel} variant={variant} />
            </div>
          ) : isFullWidthRegister ? (
            <>
              <div className="mt-8 grid gap-7 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)] lg:items-end lg:gap-16">
                <Heading level="display" as="h1" className="max-w-[10ch]">{heading}</Heading>
                <Text variant="lead" className="max-w-[58ch] lg:pb-1">{supportingText}</Text>
              </div>
              <HeroRegister items={items} label={listLabel} variant={variant} />
            </>
          ) : (
            <div className={cx(
              "mt-8 grid gap-10 lg:gap-16",
              variant === "glossary" ? "lg:grid-cols-[minmax(0,1.25fr)_minmax(400px,.75fr)] lg:items-end" : "lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,.7fr)] lg:items-end",
            )}>
              <div>
                {variant === "solutions" ? <span className="mb-5 block h-[3px] w-16 bg-(--vl-signal)" aria-hidden="true" /> : null}
                <Heading level="display" as="h1" className={cx("max-w-[11ch]", variant === "industries" && "max-w-[9ch]")}>{heading}</Heading>
                <Text variant="lead" className="mt-7 max-w-[58ch]">{supportingText}</Text>
              </div>
              <HeroRegister items={items} label={listLabel} variant={variant} />
            </div>
          )}
        </div>
      </Container>
    </Section>
  );
}
