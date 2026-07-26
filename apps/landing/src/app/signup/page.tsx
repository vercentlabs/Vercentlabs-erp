import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: "Create your Vercentlabs ERP account",
  description: "Continue to the secure Vercentlabs ERP account registration.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SignupPage() {
  redirect(siteConfig.appUrl ? siteConfig.appUrl + "/signup" : "/book-demo");
}
