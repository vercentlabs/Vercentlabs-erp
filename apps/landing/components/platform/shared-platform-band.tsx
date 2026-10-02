import Link from "next/link";
import { MODULE_ARCHITECTURE_SECTION } from "@vercentlabs/landing-content";
import { cx } from "@/lib/utils";

/** The Shared Platform as the dark band under the module groups: what every module inherits, and the link to /product/platform. */
export function SharedPlatformBand({ className }: { className?: string }) {
  const { platform } = MODULE_ARCHITECTURE_SECTION;
  return (
    <section className={cx("grid grid-cols-1 gap-6 bg-(--vl-ink) p-6 text-white sm:p-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.6fr)_auto] lg:items-center lg:gap-10", className)} aria-labelledby="module-group-platform">
      <div>
        <h3 id="module-group-platform" className="text-xl font-semibold tracking-[-0.035em]">{platform.label}</h3>
        <p className="mt-2 text-sm leading-[1.6] text-white/75">{platform.summary}</p>
      </div>
      <ul className="flex flex-wrap gap-x-2 gap-y-2" aria-label={`${platform.label} capabilities every module inherits`}>
        {platform.highlights.map((name) => (
          <li key={name} className="border border-white/25 px-2.5 py-1 text-[0.78rem] font-medium text-white/90">
            {name}
          </li>
        ))}
      </ul>
      <Link href={platform.href} prefetch={false} className="group inline-flex items-center gap-2 text-sm font-semibold text-white">
        <span className="vl-editorial-link">See the {platform.label}</span>
        <span className="vl-hover-arrow" aria-hidden="true">→</span>
      </Link>
    </section>
  );
}
