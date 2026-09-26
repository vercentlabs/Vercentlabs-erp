// Who consumes a committed domain event. The worker's dispatcher runs each of
// these for every event, in one tenant transaction; every consumer is
// idempotent on the event id.
import { fanOutWebhookDeliveries } from "../../core/platform/integrations/webhooks/index.js";
import { fanOutWorkflowRuns } from "../../core/platform/workflows/index.js";

export const EVENT_FAN_OUT = Object.freeze([fanOutWebhookDeliveries, fanOutWorkflowRuns]);
