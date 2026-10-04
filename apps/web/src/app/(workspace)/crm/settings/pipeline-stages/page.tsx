import { redirect } from "next/navigation";

// The pipeline's stages are the sales stages; this address keeps old links working.
export default function Page() {
  redirect("/crm/settings/opportunities/stages");
}
