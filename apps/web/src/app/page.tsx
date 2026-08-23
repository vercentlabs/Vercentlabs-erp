import { redirect } from "next/navigation";
import { getSessionContext, nextPath } from "@/core/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSessionContext();
  redirect(session ? nextPath(session) : "/login");
}
