import { z } from "zod";
import { captureScheduledForecastSnapshots } from "@vercentlabs/api";

export const JOB_TYPE = "crm.forecast.capture_snapshots";

export const payloadSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();

// F025 daily forecast snapshot: every open or frozen period covering today
// gets one immutable capture (organisation, team and owner rows plus the
// deals behind each owner). The capture key `scheduled:<date>` is unique per
// period, so a retried or duplicate tick is a no-op.
export async function captureForecastSnapshotsHandler(client, systemContext, payload) {
  return captureScheduledForecastSnapshots(client, systemContext.organizationId, payload.date ? { date: payload.date } : {});
}
