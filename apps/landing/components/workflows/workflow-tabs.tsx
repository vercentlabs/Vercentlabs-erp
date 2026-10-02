"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { track, type AnalyticsEventName } from "@/lib/analytics";
import { cx } from "@/lib/utils";

interface WorkflowTab {
  slug: string;
  label: string;
  meta: string;
}

/**
 * WAI-ARIA tabs (automatic activation) over server-rendered panels. Every
 * panel is in the HTML from the first response — inactive ones carry the
 * `hidden` attribute — so all workflow content stays crawlable and the first
 * workflow is readable without JavaScript. This island owns only the selected
 * index; the panels themselves are Server Components passed in as children.
 *
 * `interactionEvent` fires on a real selection by the visitor, never on view.
 */
export function WorkflowTabs({
  label,
  tabs,
  panels,
  interactionEvent,
}: {
  label: string;
  tabs: WorkflowTab[];
  panels: ReactNode[];
  interactionEvent: AnalyticsEventName;
}) {
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number, moveFocus: boolean) {
    if (index === active) return;
    setActive(index);
    track(interactionEvent, { workflow: tabs[index].slug });
    if (moveFocus) tabRefs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight" ? (active === last ? 0 : active + 1)
      : event.key === "ArrowLeft" ? (active === 0 ? last : active - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="-mx-5 flex snap-x gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {tabs.map((tab, index) => {
          const selected = index === active;
          return (
            <button
              key={tab.slug}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`workflow-tab-${tab.slug}`}
              aria-selected={selected}
              aria-controls={`workflow-panel-${tab.slug}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(index, false)}
              onKeyDown={onKeyDown}
              className={cx(
                "min-h-11 shrink-0 snap-start border px-4 py-2 text-left transition-colors duration-(--duration-fast)",
                selected
                  ? "border-(--vl-ink) bg-(--vl-ink) text-white"
                  : "border-(--color-border-strong) bg-transparent text-(--color-text-primary) hover:border-(--color-text-primary) hover:bg-(--color-bg-elevated)",
              )}
            >
              <span className="block text-sm font-semibold leading-tight">{tab.label}</span>
              <span className={cx("mt-0.5 block text-[0.72rem] leading-tight", selected ? "text-white/75" : "text-(--color-text-secondary)")}>{tab.meta}</span>
            </button>
          );
        })}
      </div>

      {panels.map((panel, index) => (
        <div
          key={tabs[index].slug}
          role="tabpanel"
          id={`workflow-panel-${tabs[index].slug}`}
          aria-labelledby={`workflow-tab-${tabs[index].slug}`}
          hidden={index !== active}
          data-active-panel={index === active}
          tabIndex={0}
          className="mt-8 focus-visible:outline-offset-4"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
