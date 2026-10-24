import { msmeYearEnd } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// The year-end figures at 31 March of ?year= (the April it starts): owed to micro and small suppliers, the part past its deadline
// (s.43B(h)) and the s.16 interest at three times ?bankRate=.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return procurementRead(request, async (client, context) =>
    msmeYearEnd(client, context, { year: params.get("year") ?? undefined, bankRate: params.get("bankRate") ?? undefined }), "procurement.bills.view");
}
