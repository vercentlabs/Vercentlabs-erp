import { ArrowRight } from "lucide-react";
import Link from "next/link";

export default function MobileContactCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-2.5 shadow-[0_-10px_28px_rgba(15,23,42,0.1)] backdrop-blur md:hidden">
      <Link
        href="/signup"
        className="button-primary flex min-h-11 w-full justify-center"
      >
        Apply for design partnership
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Link>
    </div>
  );
}
