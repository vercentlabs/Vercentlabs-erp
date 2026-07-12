import { ArrowRight } from "lucide-react";

export default function AnnouncementBar() {
  return (
    <div className="relative overflow-hidden bg-slate-950 text-white">
      <div className="mx-auto flex min-h-9 max-w-7xl items-center justify-center gap-2 px-5 py-2 text-center text-xs font-semibold text-slate-300">
        <span className="hidden rounded-full bg-indigo-500/15 px-2 py-0.5 text-indigo-300 sm:inline">
          Building in public
        </span>

        <span>
          VercentLabs is building a connected enterprise ERP platform.
        </span>

        <ArrowRight
          aria-hidden="true"
          className="h-3.5 w-3.5 text-indigo-300"
        />
      </div>
    </div>
  );
}
