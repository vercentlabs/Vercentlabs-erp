import { getStructuredFieldConfig } from "@vercentlabs/shared-types";
import type { CrmResourceKey } from "@vercentlabs/shared-types";
import { prospectAndRelationshipDefinitions } from "./resource-definitions/prospect-and-relationship";
import { leadLifecycleDefinitions } from "./resource-definitions/lead-lifecycle";
import { opportunityPipelineDefinitions } from "./resource-definitions/opportunity-pipeline";
import { sellerActivityDefinitions } from "./resource-definitions/seller-activity";
import { salesOrganizationDefinitions } from "./resource-definitions/sales-organization";
import { dataOperationsDefinitions } from "./resource-definitions/data-operations";
import { conversionHandoffDefinitions } from "./resource-definitions/conversion-handoff";
import { analyticsForecastingDefinitions } from "./resource-definitions/analytics-forecasting";
import type { CrmDefinition } from "./resource-definitions/core";

export type { CrmDefinition, CrmField, CrmColumn } from "./resource-definitions/core";

export const crmDefinitions = {
  ...prospectAndRelationshipDefinitions,
  ...leadLifecycleDefinitions,
  ...opportunityPipelineDefinitions,
  ...sellerActivityDefinitions,
  ...salesOrganizationDefinitions,
  ...dataOperationsDefinitions,
  ...conversionHandoffDefinitions,
  ...analyticsForecastingDefinitions,
} as Record<CrmResourceKey, CrmDefinition>;

function applyStructuredFieldMetadata() {
  for (const definition of Object.values(crmDefinitions)) {
    definition.fields = definition.fields.map((field) => {
      const structured = getStructuredFieldConfig(field.name, field.label);
      if (!structured) return field;
      return { ...field, label: structured.label, structuredKind: structured.kind, structuredOptionsKey: structured.optionsKey, helpText: structured.helpText };
    });
  }
}

applyStructuredFieldMetadata();

export function isCrmDefinition(value: string): value is CrmResourceKey { return value in crmDefinitions; }
