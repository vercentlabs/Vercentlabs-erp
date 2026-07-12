import { MessageCircle } from "lucide-react";

import { siteConfig } from "@/lib/site-config";

export default function MobileContactCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-2.5 shadow-[0_-10px_28px_rgba(15,23,42,0.1)] backdrop-blur md:hidden">
      <a
        href={
          "mailto:" +
          siteConfig.email +
          "?subject=Vercent ERP product discussion"
        }
        className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/20"
      >
        <MessageCircle aria-hidden="true" className="h-4 w-4" />
        Talk to VercentLabs
      </a>
    </div>
  );
}
