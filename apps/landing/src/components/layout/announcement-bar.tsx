import Link from "next/link";

export default function AnnouncementBar() {
  return (
    <aside
      aria-label="Vercent ERP announcement"
      className="border-b border-indigo-500/30 bg-slate-950 px-4 py-2.5 text-center text-sm text-white"
    >
      <span className="mr-2 inline-flex rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-emerald-200">
        12 connected modules
      </span>
      <span className="text-slate-200">
        Accounting to payroll—run every core operation on one ERP platform.
      </span>{" "}
      <Link
        href="/contact"
        className="font-extrabold text-white underline decoration-indigo-300 underline-offset-4 hover:text-indigo-200"
      >
        Book a demo
      </Link>
    </aside>
  );
}
