import { renderPosRefundAcknowledgement } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string }> };

// GET ?width=58|80|210: the refund acknowledgement — each tender's refund as it stands now. Not a GST credit note; printing changes nothing.
export async function GET(request: Request, { params }: Params) {
  const { refundId } = await params;
  const width = Number(new URL(request.url).searchParams.get("width") ?? 80);
  return posRead(request, async (client, context) => {
    const result = await renderPosRefundAcknowledgement(client, context, refundId, { width });
    return { refundNumber: result.refund.refundNumber, html: result.html };
  }, "pos.view");
}
