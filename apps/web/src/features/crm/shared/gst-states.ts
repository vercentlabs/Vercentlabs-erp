// The Indian states and union territories with their GST state codes — the one list in @vercentlabs/shared-types (the server checks
// addresses and leads against it), re-exported for the screens.
import { GST_STATES } from "@vercentlabs/shared-types";

export { GST_STATES, findIndianState } from "@vercentlabs/shared-types";
export const gstStateByName = (name: string) => GST_STATES.find((state) => state.name.toLowerCase() === name.trim().toLowerCase());
export const GST_STATES_BY_CODE = new Map(GST_STATES.map((state) => [state.code, state.name]));
