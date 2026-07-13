import Link from "next/link";
import { ArrowRight, Calculator } from "lucide-react";

export default function MobileContactCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-3 pt-2.5 shadow-[0_-10px_28px_rgba(15,23,42,0.1)] backdrop-blur md:hidden safe-bottom">
      <div className="mx-auto grid max-w-md grid-cols-[0.85fr_1.15fr] gap-2">
        <Link
          href="/pricing"
          className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-700"
        >
          <Calculator aria-hidden="true" className="h-4 w-4" />
          Pricing
        </Link>
        <Link
          href="/contact"
          className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-indigo-600 px-3 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/20"
        >
          Book a demo
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
