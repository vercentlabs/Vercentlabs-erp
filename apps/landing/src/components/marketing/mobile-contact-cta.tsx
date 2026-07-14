import Link from "next/link";
import { ArrowRight, Calculator } from "lucide-react";

export default function MobileContactCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-2.5 pt-2 shadow-[0_-10px_28px_rgba(15,23,42,0.1)] backdrop-blur sm:px-3 sm:pt-2.5 md:hidden safe-bottom">
      <div className="mx-auto grid max-w-md grid-cols-[0.85fr_1.15fr] gap-1.5 sm:gap-2">
        <Link
          href="/pricing"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-slate-300 bg-white px-2.5 text-xs font-extrabold text-slate-700 sm:min-h-12 sm:gap-2 sm:px-3 sm:text-sm"
        >
          <Calculator
            aria-hidden="true"
            className="h-3.5 w-3.5 sm:h-4 sm:w-4"
          />
          Pricing
        </Link>
        <Link
          href="/contact"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-indigo-600 px-2.5 text-xs font-extrabold text-white shadow-lg shadow-indigo-600/20 sm:min-h-12 sm:gap-2 sm:px-3 sm:text-sm"
        >
          Book a demo
          <ArrowRight
            aria-hidden="true"
            className="h-3.5 w-3.5 sm:h-4 sm:w-4"
          />
        </Link>
      </div>
    </div>
  );
}
