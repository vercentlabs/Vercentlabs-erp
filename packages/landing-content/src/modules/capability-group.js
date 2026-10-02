import { launchCapabilityNames } from "../capabilities/launch-capabilities.js";

/**
 * A module capability group. `capabilityIds` must be launch capability
 * register IDs; the displayed `capabilities` names are derived from the
 * register, never typed in module content.
 */
export function capabilityGroup(id, name, description, capabilityIds, workflowSlug) {
  return Object.freeze({
    id,
    name,
    description,
    capabilityIds: Object.freeze([...capabilityIds]),
    capabilities: Object.freeze(launchCapabilityNames(capabilityIds)),
    ...(workflowSlug ? { workflowSlug } : {}),
  });
}
