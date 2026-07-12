import Link from "next/link";

export default function AnnouncementBar() {
  return (
    <aside
      aria-label="Design partner programme announcement"
      className="border-b border-indigo-500/30 bg-slate-950 px-4 py-2.5 text-center text-sm text-white"
    >
      <span className="mr-2 inline-flex rounded-full border border-indigo-300/30 bg-indigo-400/10 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-indigo-200">
        Private programme
      </span>
      <span className="text-slate-200">
        VercentLabs is selecting design partners for its connected ERP platform.
      </span>{" "}
      <Link
        href="/signup"
        className="font-extrabold text-white underline decoration-indigo-300 underline-offset-4 hover:text-indigo-200"
      >
        Apply to participate
      </Link>
    </aside>
  );
}
